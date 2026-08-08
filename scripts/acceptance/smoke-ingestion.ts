import { createHash, randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"
import { signLeadRequest } from "@veridia/security"

import { fixture, guardEnvironment, readEnv } from "./config"

type AdminClient = SupabaseClient<Database>

const results: { step: string; ok: boolean; detail: string }[] = []

function check(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}  ${detail}`)
}

function payload(overrides?: { phone?: string; email?: string }) {
  const submittedAt = new Date()
  const startedAt = new Date(submittedAt.getTime() - 5000)
  return {
    schemaVersion: "1.0",
    form: {
      formId: "phase1_smoke",
      startedAt: startedAt.toISOString(),
      submittedAt: submittedAt.toISOString(),
      honeypot: "",
    },
    contact: {
      firstName: "Ahmet",
      lastName: "Smoke",
      phone: overrides?.phone ?? "+905551112233",
      email: overrides?.email ?? "ahmet.smoke@example.com",
    },
    lead: { service: "Statik Proje", city: "İstanbul", message: "smoke" },
    attribution: {
      landingPage: "https://acceptance.example.test/?utm_source=google",
      conversionPage: "https://acceptance.example.test/thank-you",
      referrer: "https://www.google.com/",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "smoke",
      utmContent: null,
      utmTerm: null,
      firstTouch: {
        source: "google",
        medium: "cpc",
        campaign: "smoke",
        referrer: "https://www.google.com/",
        occurredAt: new Date(submittedAt.getTime() - 60_000).toISOString(),
      },
      lastTouch: {
        source: "google",
        medium: "cpc",
        campaign: "smoke",
        referrer: "https://www.google.com/",
        occurredAt: submittedAt.toISOString(),
      },
    },
    security: { turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" },
  }
}

async function send(
  appUrl: string,
  keyId: string,
  secret: string,
  rawBody: string,
  idempotencyKey: string,
) {
  const headers = signLeadRequest({
    method: "POST",
    path: "/api/v1/leads",
    rawBody,
    keyId,
    secret,
    idempotencyKey,
  })
  return fetch(`${appUrl}/api/v1/leads`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: rawBody,
  })
}

async function resetOrg(admin: AdminClient, organizationId: string) {
  await admin
    .from("outbox_events")
    .delete()
    .eq("organization_id", organizationId)
  await admin
    .from("domain_events")
    .delete()
    .eq("organization_id", organizationId)
  await admin.from("leads").delete().eq("organization_id", organizationId)
  const { data: sites } = await admin
    .from("sites")
    .select("id")
    .eq("organization_id", organizationId)
  for (const site of sites ?? []) {
    await admin.from("idempotency_records").delete().eq("site_id", site.id)
    await admin.from("used_nonces").delete().eq("site_id", site.id)
  }
}

async function main() {
  const env = readEnv()
  guardEnvironment(env)

  const admin = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const keyId = process.env.ACCEPTANCE_SITE_KEY_ID ?? ""
  const secret = process.env.ACCEPTANCE_SITE_SECRET ?? ""
  if (!keyId || !secret) throw new Error("ACCEPTANCE_SITE_KEY_ID/SECRET yok")

  const appUrl = env.VERIDIA_ACCEPTANCE_APP_URL.replace(/\/+$/, "")

  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", fixture.orgSlug)
    .maybeSingle()
  if (!org) throw new Error("fixture organization yok")

  await resetOrg(admin, org.id)

  // --- ADIM 4-6: imzali istek -> 201 ---
  const bodyA = JSON.stringify(payload())
  const idemA = randomUUID()
  const r1 = await send(appUrl, keyId, secret, bodyA, idemA)
  const j1 = (await r1.json()) as { leadId?: string; duplicate?: boolean }
  check("6. HTTP 201", r1.status === 201, `status=${r1.status}`)

  const leadId = j1.leadId ?? ""

  // --- ADIM 7: DB dogrulamasi ---
  const { data: leads } = await admin
    .from("leads")
    .select("id, status, is_duplicate, version")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
  check(
    "7a. tam 1 lead",
    (leads ?? []).length === 1,
    `adet=${(leads ?? []).length}`,
  )
  check(
    "7c. baslangic status=new",
    leads?.[0]?.status === "new",
    `status=${leads?.[0]?.status}`,
  )

  const { count: attrCount } = await admin
    .from("lead_attributions")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
  check("7b. tam 1 attribution", attrCount === 1, `adet=${attrCount}`)

  const { count: histCount } = await admin
    .from("lead_status_history")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
  check("7d. status history var", (histCount ?? 0) >= 1, `adet=${histCount}`)

  const { count: domainCount } = await admin
    .from("domain_events")
    .select("id", { count: "exact", head: true })
    .eq("aggregate_id", leadId)
    .eq("event_type", "lead_created")
  check("7e. domain lead_created", domainCount === 1, `adet=${domainCount}`)

  const { data: outbox } = await admin
    .from("outbox_events")
    .select("event_type, status, job_key")
    .eq("aggregate_id", leadId)
  const notify = (outbox ?? []).filter(
    (o) => o.event_type === "notify_business",
  )
  const metrics = (outbox ?? []).filter(
    (o) => o.event_type === "update_metrics",
  )
  check(
    "7f. notify_business outbox",
    notify.length === 1,
    `adet=${notify.length}`,
  )
  check(
    "7g. update_metrics outbox",
    metrics.length === 1,
    `adet=${metrics.length}`,
  )

  const { data: idem } = await admin
    .from("idempotency_records")
    .select("status, response_status")
    .eq("resource_id", leadId)
  check(
    "7h. idempotency completed",
    idem?.[0]?.status === "completed",
    `status=${idem?.[0]?.status} http=${idem?.[0]?.response_status}`,
  )

  // --- ADIM 8: ayni idempotency key + ayni body ---
  const r2 = await send(appUrl, keyId, secret, bodyA, idemA)
  const { count: leadsAfterReplay } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)
    .is("deleted_at", null)
  const { count: outboxAfterReplay } = await admin
    .from("outbox_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)
  check(
    "8a. replay ikinci lead yok",
    leadsAfterReplay === 1,
    `lead=${leadsAfterReplay} http=${r2.status}`,
  )
  check(
    "8b. replay ikinci outbox yok",
    outboxAfterReplay === 2,
    `outbox=${outboxAfterReplay}`,
  )

  // --- ADIM 9: ayni kisi, farkli idempotency key ---
  const r3 = await send(
    appUrl,
    keyId,
    secret,
    JSON.stringify(payload()),
    randomUUID(),
  )
  const j3 = (await r3.json()) as { leadId?: string; duplicate?: boolean }
  const { data: dupLead } = await admin
    .from("leads")
    .select("id, is_duplicate, duplicate_of")
    .eq("id", j3.leadId ?? "")
    .maybeSingle()
  check(
    "9a. ikinci lead olustu",
    r3.status === 201 && !!dupLead,
    `http=${r3.status}`,
  )
  check(
    "9b. is_duplicate=true",
    dupLead?.is_duplicate === true,
    `is_duplicate=${dupLead?.is_duplicate}`,
  )

  // --- ADIM 10: gecersiz HMAC ---
  const beforeInvalid = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)
  const r4 = await send(
    appUrl,
    keyId,
    `${secret}-bozuk`,
    JSON.stringify(payload()),
    randomUUID(),
  )
  const afterInvalid = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)
  check("10a. gecersiz HMAC reddedildi", r4.status === 401, `http=${r4.status}`)
  check(
    "10b. lead olusmadi",
    beforeInvalid.count === afterInvalid.count,
    `once=${beforeInvalid.count} sonra=${afterInvalid.count}`,
  )

  // --- ADIM 17: kuyruk sagligi ---
  const { data: queue } = await admin
    .from("outbox_events")
    .select("status")
    .eq("organization_id", org.id)
  const byStatus: Record<string, number> = {}
  for (const row of queue ?? [])
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
  const { count: deadLetters } = await admin
    .from("dead_letter_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)
  check(
    "17. kuyruk sagligi",
    (deadLetters ?? 0) === 0,
    `${JSON.stringify(byStatus)} dead_letter=${deadLetters}`,
  )

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\n=== ${results.length - failed.length}/${results.length} PASS ===`,
  )
  if (failed.length > 0) process.exitCode = 1
}

void main().catch((error) => {
  console.error("HATA:", error instanceof Error ? error.message : error)
  process.exitCode = 1
})
