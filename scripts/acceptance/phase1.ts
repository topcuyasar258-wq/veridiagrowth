import { randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"
import {
  encryptCredentialSecret,
  fingerprintCredentialSecret,
  generateCredentialSecret,
  serializeEncryptedSecret,
  signLeadRequest,
} from "@veridia/security"
import {
  fixture,
  guardEnvironment,
  readEnv,
  type AcceptanceEnv,
  type Fixture,
} from "./config"

type AdminClient = SupabaseClient<Database>

const command = process.argv[2] ?? "preflight"

async function main() {
  const env = readEnv()
  guardEnvironment(env)

  const admin = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )

  if (command === "preflight") {
    await preflight(admin, env)
    return
  }

  if (command === "seed") {
    await seed(admin, env)
    return
  }

  if (command === "submit-happy") {
    const loaded = await loadFixture(admin)
    const credential = await requireActiveCredential(admin, loaded.siteId)
    await submitHappyPath(env, credential)
    return
  }

  if (command === "submit-security") {
    const loaded = await loadFixture(admin)
    const credential = await requireActiveCredential(admin, loaded.siteId)
    await submitSecurityChecks(env, credential)
    return
  }

  if (command === "worker") {
    await runWorker(env)
    return
  }

  if (command === "verify-db") {
    await verifyDatabase(admin)
    return
  }

  if (command === "cleanup") {
    await cleanup(admin)
    return
  }

  if (command === "all") {
    await preflight(admin, env)
    const seeded = await seed(admin, env)
    if (!seeded.secret || !seeded.keyId) {
      throw new Error("Seed did not create a one-time credential secret.")
    }
    await submitHappyPath(env, {
      keyId: seeded.keyId,
      secret: seeded.secret,
    })
    await submitSecurityChecks(env, {
      keyId: seeded.keyId,
      secret: seeded.secret,
    })
    await runWorker(env)
    await verifyDatabase(admin)
    return
  }

  printUsage()
  process.exitCode = 1
}

async function preflight(admin: AdminClient, env: AcceptanceEnv) {
  const { error } = await admin.from("organizations").select("id").limit(1)

  if (error) {
    throw new Error(`Supabase preflight failed: ${error.message}`)
  }

  const response = await fetch(
    `${env.VERIDIA_ACCEPTANCE_APP_URL.replace(/\/+$/, "")}/api/internal/workers/outbox`,
    { method: "POST" },
  )

  if (response.status !== 401) {
    throw new Error(`Expected worker unauthorized 401, got ${response.status}.`)
  }

  console.log("preflight ok")
}

async function seed(admin: AdminClient, env: AcceptanceEnv): Promise<Fixture> {
  const ownerId = await upsertAuthUser(
    admin,
    fixture.ownerEmail,
    env.ACCEPTANCE_USER_PASSWORD,
  )
  const agentId = await upsertAuthUser(
    admin,
    fixture.agentEmail,
    env.ACCEPTANCE_USER_PASSWORD,
  )
  const viewerId = await upsertAuthUser(
    admin,
    fixture.viewerEmail,
    env.ACCEPTANCE_USER_PASSWORD,
  )
  const orgBUserId = await upsertAuthUser(
    admin,
    fixture.orgBEmail,
    env.ACCEPTANCE_USER_PASSWORD,
  )
  const organizationId = await upsertOrganization(
    admin,
    fixture.orgSlug,
    fixture.orgName,
  )
  const orgBId = await upsertOrganization(
    admin,
    fixture.orgBSlug,
    fixture.orgBName,
  )
  const siteId = await upsertSite(admin, organizationId, fixture.siteName)

  await upsertMembership(admin, organizationId, ownerId, "organization_owner")
  await upsertMembership(admin, organizationId, agentId, "agent")
  await upsertMembership(admin, organizationId, viewerId, "viewer")
  await upsertMembership(admin, orgBId, orgBUserId, "organization_owner")
  await upsertNotificationSetting(admin, {
    organizationId,
    siteId,
    recipientEmail: env.VERIDIA_ACCEPTANCE_RECIPIENT_EMAIL.toLowerCase(),
  })

  const active = await findActiveCredential(admin, siteId)

  if (active) {
    console.log("seed ok; active credential already exists")
    console.log(
      "Run cleanup or rotate manually if a new one-time secret is required.",
    )
    return {
      ownerId,
      agentId,
      viewerId,
      orgBUserId,
      organizationId,
      orgBId,
      siteId,
    }
  }

  const created = await createAcceptanceCredential(admin, {
    siteId,
    organizationId,
    actorUserId: ownerId,
  })

  console.log("seed ok")
  console.log(`ACCEPTANCE_SITE_KEY_ID=${created.credential.keyId}`)
  console.log(`ACCEPTANCE_SITE_SECRET=${created.secret}`)
  console.log("Store these only in the demo website server environment.")

  return {
    ownerId,
    agentId,
    viewerId,
    orgBUserId,
    organizationId,
    orgBId,
    siteId,
    keyId: created.credential.keyId,
    secret: created.secret,
  }
}

async function submitHappyPath(
  env: AcceptanceEnv,
  credential: { keyId: string; secret: string },
) {
  const body = JSON.stringify(
    happyPayload(env.ACCEPTANCE_TURNSTILE_SUCCESS_TOKEN),
  )
  const response = await signedFetch(env, credential, body, randomUUID())

  if (response.status !== 201) {
    throw new Error(`Expected happy path 201, got ${response.status}.`)
  }

  const parsed = (await response.json()) as {
    leadId?: string
    duplicate?: boolean
  }

  if (!parsed.leadId || typeof parsed.duplicate !== "boolean") {
    throw new Error("Happy path response is missing leadId or duplicate.")
  }

  console.log(
    `submit-happy ok leadId=${parsed.leadId} duplicate=${parsed.duplicate}`,
  )
}

async function submitSecurityChecks(
  env: AcceptanceEnv,
  credential: { keyId: string; secret: string },
) {
  const validBody = JSON.stringify(
    happyPayload(env.ACCEPTANCE_TURNSTILE_SUCCESS_TOKEN),
  )
  const invalidTurnstileBody = JSON.stringify(
    happyPayload(env.ACCEPTANCE_TURNSTILE_FAILURE_TOKEN),
  )
  const expiredTimestamp = Math.floor(Date.now() / 1000) - 10 * 60

  const invalidSignature = await signedFetch(
    env,
    { ...credential, secret: `${credential.secret}-wrong` },
    validBody,
    randomUUID(),
  )
  expectStatus("invalid HMAC", invalidSignature.status, [401])

  const expired = await signedFetch(env, credential, validBody, randomUUID(), {
    timestamp: expiredTimestamp,
  })
  expectStatus("expired timestamp", expired.status, [401])

  const nonce = randomUUID()
  const first = await signedFetch(env, credential, validBody, randomUUID(), {
    nonce,
  })
  expectStatus("nonce first request", first.status, [201])
  const replay = await signedFetch(env, credential, validBody, randomUUID(), {
    nonce,
  })
  expectStatus("nonce replay", replay.status, [401])

  const invalidTurnstile = await signedFetch(
    env,
    credential,
    invalidTurnstileBody,
    randomUUID(),
  )
  expectStatus("invalid Turnstile", invalidTurnstile.status, [403])

  const honeypot = await signedFetch(
    env,
    credential,
    JSON.stringify(
      happyPayload(env.ACCEPTANCE_TURNSTILE_SUCCESS_TOKEN, {
        honeypot: "filled",
      }),
    ),
    randomUUID(),
  )
  expectStatus("honeypot", honeypot.status, [400])

  console.log("submit-security ok")
}

async function runWorker(env: AcceptanceEnv) {
  const response = await fetch(
    `${env.VERIDIA_ACCEPTANCE_APP_URL.replace(/\/+$/, "")}/api/internal/workers/outbox`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.VERIDIA_WORKER_SECRET}`,
      },
    },
  )

  if (!response.ok) {
    throw new Error(`Worker failed with HTTP ${response.status}.`)
  }

  console.log(`worker ok ${await response.text()}`)
}

async function verifyDatabase(admin: AdminClient) {
  const org = await requireOrganization(admin, fixture.orgSlug)
  const { data: leads, error: leadsError } = await admin
    .from("leads")
    .select("id, status, is_duplicate, duplicate_of, source_category")
    .eq("organization_id", org.id)
    .is("deleted_at", null)

  if (leadsError) {
    throw new Error(`Lead verification failed: ${leadsError.message}`)
  }

  const leadIds = (leads ?? []).map((lead) => lead.id)
  const [attributionCount, historyCount, outboxCount, deliveryCount] =
    await Promise.all([
      count(admin, "lead_attributions", "lead_id", leadIds),
      count(admin, "lead_status_history", "lead_id", leadIds),
      count(admin, "outbox_events", "aggregate_id", leadIds),
      count(admin, "delivery_operations", "lead_id", leadIds),
    ])

  console.log(
    JSON.stringify(
      {
        leads: leads?.length ?? 0,
        attributionCount,
        historyCount,
        outboxCount,
        deliveryCount,
      },
      null,
      2,
    ),
  )
}

async function cleanup(admin: AdminClient) {
  const org = await findOrganization(admin, fixture.orgSlug)
  const orgB = await findOrganization(admin, fixture.orgBSlug)

  for (const organizationId of [org?.id, orgB?.id].filter(Boolean)) {
    const { error } = await admin
      .from("organizations")
      .delete()
      .eq("id", organizationId as string)

    if (error) {
      throw new Error(`Cleanup failed: ${error.message}`)
    }
  }

  for (const email of [
    fixture.ownerEmail,
    fixture.agentEmail,
    fixture.viewerEmail,
    fixture.orgBEmail,
  ]) {
    const userId = await findAuthUserId(admin, email)
    if (userId) {
      await admin.auth.admin.deleteUser(userId)
    }
  }

  console.log("cleanup ok")
}

function happyPayload(
  turnstileToken: string,
  overrides?: { honeypot?: string; startedAt?: Date; submittedAt?: Date },
) {
  const submittedAt = overrides?.submittedAt ?? new Date()
  const startedAt =
    overrides?.startedAt ?? new Date(submittedAt.getTime() - 5000)

  return {
    schemaVersion: "1.0",
    form: {
      formId: "phase1_acceptance",
      startedAt: startedAt.toISOString(),
      submittedAt: submittedAt.toISOString(),
      honeypot: overrides?.honeypot ?? "",
    },
    contact: {
      firstName: "Ahmet",
      lastName: "Test",
      phone: "+905551112233",
      email: "ahmet.test@example.com",
    },
    lead: {
      service: "Statik Proje",
      city: "İstanbul",
      message: "Phase 1 acceptance test",
    },
    attribution: {
      landingPage:
        "https://acceptance.example.test/?utm_source=google&utm_medium=cpc&utm_campaign=phase1_acceptance",
      conversionPage: "https://acceptance.example.test/thank-you",
      referrer: "https://www.google.com/",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "phase1_acceptance",
      utmContent: null,
      utmTerm: null,
      firstTouch: {
        source: "google",
        medium: "cpc",
        campaign: "phase1_acceptance",
        referrer: "https://www.google.com/",
        occurredAt: new Date(submittedAt.getTime() - 60_000).toISOString(),
      },
      lastTouch: {
        source: "google",
        medium: "cpc",
        campaign: "phase1_acceptance",
        referrer: "https://www.google.com/",
        occurredAt: submittedAt.toISOString(),
      },
    },
    security: {
      turnstileToken,
    },
  }
}

async function signedFetch(
  env: AcceptanceEnv,
  credential: { keyId: string; secret: string },
  rawBody: string,
  idempotencyKey: string,
  overrides?: { timestamp?: number; nonce?: string },
) {
  const appUrl = env.VERIDIA_ACCEPTANCE_APP_URL.replace(/\/+$/, "")
  const headers = signLeadRequest({
    method: "POST",
    path: "/api/v1/leads",
    rawBody,
    keyId: credential.keyId,
    secret: credential.secret,
    idempotencyKey,
    timestamp: overrides?.timestamp,
    nonce: overrides?.nonce,
  })

  return fetch(`${appUrl}/api/v1/leads`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: rawBody,
  })
}

function expectStatus(label: string, actual: number, expected: number[]) {
  if (!expected.includes(actual)) {
    throw new Error(`${label}: expected ${expected.join("/")} got ${actual}.`)
  }
}

async function upsertAuthUser(
  admin: AdminClient,
  email: string,
  password: string,
) {
  const existing = await findAuthUserId(admin, email)

  if (existing) {
    return existing
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !data.user) {
    throw new Error(`Auth user create failed for ${email}: ${error?.message}`)
  }

  return data.user.id
}

async function findAuthUserId(admin: AdminClient, email: string) {
  const { data, error } = await admin.auth.admin.listUsers()

  if (error) {
    throw new Error(`Auth user lookup failed: ${error.message}`)
  }

  return data.users.find((user) => user.email === email)?.id ?? null
}

async function upsertOrganization(
  admin: AdminClient,
  slug: string,
  name: string,
) {
  const existing = await findOrganization(admin, slug)

  if (existing) {
    return existing.id
  }

  const { data, error } = await admin
    .from("organizations")
    .insert({ name, slug, status: "active" })
    .select("id")
    .single()

  if (error) {
    throw new Error(`Organization seed failed: ${error.message}`)
  }

  return data.id
}

async function findOrganization(admin: AdminClient, slug: string) {
  const { data, error } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle()

  if (error) {
    throw new Error(`Organization lookup failed: ${error.message}`)
  }

  return data
}

async function requireOrganization(admin: AdminClient, slug: string) {
  const organization = await findOrganization(admin, slug)

  if (!organization) {
    throw new Error(`Missing acceptance organization ${slug}.`)
  }

  return organization
}

async function upsertSite(
  admin: AdminClient,
  organizationId: string,
  name: string,
) {
  const { data: existing, error: existingError } = await admin
    .from("sites")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", name)
    .maybeSingle()

  if (existingError) {
    throw new Error(`Site lookup failed: ${existingError.message}`)
  }

  if (existing) {
    return existing.id
  }

  const { data, error } = await admin
    .from("sites")
    .insert({ organization_id: organizationId, name, status: "active" })
    .select("id")
    .single()

  if (error) {
    throw new Error(`Site seed failed: ${error.message}`)
  }

  return data.id
}

async function upsertMembership(
  admin: AdminClient,
  organizationId: string,
  userId: string,
  role: "organization_owner" | "agent" | "viewer",
) {
  const { error } = await admin.from("organization_members").upsert(
    {
      organization_id: organizationId,
      user_id: userId,
      role,
    },
    { onConflict: "organization_id,user_id" },
  )

  if (error) {
    throw new Error(`Membership seed failed: ${error.message}`)
  }
}

async function upsertNotificationSetting(
  admin: AdminClient,
  input: { organizationId: string; siteId: string; recipientEmail: string },
) {
  const { data: existing, error: existingError } = await admin
    .from("notification_settings")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("site_id", input.siteId)
    .eq("channel", "email")
    .maybeSingle()

  if (existingError) {
    throw new Error(
      `Notification setting lookup failed: ${existingError.message}`,
    )
  }

  if (existing) {
    const { error } = await admin
      .from("notification_settings")
      .update({ recipient_email: input.recipientEmail, enabled: true })
      .eq("id", existing.id)

    if (error) {
      throw new Error(`Notification setting update failed: ${error.message}`)
    }

    return
  }

  const { error } = await admin.from("notification_settings").insert({
    organization_id: input.organizationId,
    site_id: input.siteId,
    channel: "email",
    recipient_email: input.recipientEmail,
    enabled: true,
  })

  if (error) {
    throw new Error(`Notification setting seed failed: ${error.message}`)
  }
}

async function findActiveCredential(admin: AdminClient, siteId: string) {
  const { data, error } = await admin
    .from("site_credentials")
    .select("id, key_id")
    .eq("site_id", siteId)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    throw new Error(`Credential lookup failed: ${error.message}`)
  }

  return data
}

async function requireActiveCredential(admin: AdminClient, siteId: string) {
  const credential = await findActiveCredential(admin, siteId)

  if (!credential) {
    throw new Error(
      "No active credential. Run seed and capture one-time secret.",
    )
  }

  const secret = process.env.ACCEPTANCE_SITE_SECRET

  if (!secret) {
    throw new Error("Missing ACCEPTANCE_SITE_SECRET for active credential.")
  }

  return { keyId: credential.key_id, secret }
}

async function createAcceptanceCredential(
  admin: AdminClient,
  input: { siteId: string; organizationId: string; actorUserId: string },
) {
  const secret = generateCredentialSecret()
  const encrypted = encryptCredentialSecret(secret)
  const fingerprint = fingerprintCredentialSecret(secret)
  const keyId = `site_${randomUUID().replaceAll("-", "")}`
  const { data, error } = await admin
    .from("site_credentials")
    .insert({
      site_id: input.siteId,
      organization_id: input.organizationId,
      key_id: keyId,
      secret_ciphertext: serializeEncryptedSecret(encrypted),
      secret_fingerprint: fingerprint,
      status: "active",
      valid_until: null,
      rotation_group_id: null,
      created_by: input.actorUserId,
    })
    .select("id, key_id")
    .single()

  if (error) {
    throw new Error(`Credential create failed: ${error.message}`)
  }

  const { error: auditError } = await admin.from("audit_logs").insert({
    organization_id: input.organizationId,
    actor_user_id: input.actorUserId,
    action: "credential.created",
    entity_type: "site_credential",
    entity_id: data.id,
    metadata: {
      siteId: input.siteId,
      credentialId: data.id,
      keyId: data.key_id,
      fingerprint,
    },
  })

  if (auditError) {
    throw new Error(`Credential audit failed: ${auditError.message}`)
  }

  return {
    credential: {
      id: data.id,
      keyId: data.key_id,
      fingerprint,
    },
    secret,
  }
}

async function count(
  admin: AdminClient,
  table:
    | "lead_attributions"
    | "lead_status_history"
    | "outbox_events"
    | "delivery_operations",
  column: "lead_id" | "aggregate_id",
  values: string[],
) {
  if (values.length === 0) {
    return 0
  }

  const { count: value, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .in(column, values)

  if (error) {
    throw new Error(`Count failed for ${table}: ${error.message}`)
  }

  return value ?? 0
}

async function loadFixture(admin: AdminClient) {
  const org = await requireOrganization(admin, fixture.orgSlug)
  const { data: site, error } = await admin
    .from("sites")
    .select("id")
    .eq("organization_id", org.id)
    .eq("name", fixture.siteName)
    .maybeSingle()

  if (error || !site) {
    throw new Error("Missing acceptance site. Run seed first.")
  }

  return { organizationId: org.id, siteId: site.id }
}

function printUsage() {
  console.log(`Usage: npm run acceptance:phase1 -- <command>

Commands:
  preflight        Validate staging guards and worker unauthorized response
  seed             Create synthetic acceptance org/site/users/settings/credential
  submit-happy     Submit one signed happy-path lead
  submit-security  Exercise invalid HMAC, expired timestamp, nonce replay, Turnstile, honeypot
  worker           Call the real staging worker endpoint
  verify-db        Print DB acceptance counters
  cleanup          Delete acceptance-prefixed fixture organizations and users
  all              preflight + seed + submit-happy + submit-security + worker + verify-db`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
