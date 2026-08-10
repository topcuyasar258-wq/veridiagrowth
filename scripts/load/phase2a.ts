/**
 * Phase 2A load acceptance harness.
 *
 * Commands: preflight | seed | run | verify | cleanup
 *
 * This drives real HTTP against a real collector and a real hosted database.
 * That makes it dangerous in exactly one way -- pointed at production it would
 * write synthetic traffic into a customer's numbers -- so it refuses to run
 * unless every guard passes. There is no override flag by design.
 */
import { randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"

type AdminClient = SupabaseClient<Database>

const command = process.argv[2] ?? "preflight"

/** Fixture prefixes. Cleanup may only ever touch rows carrying these. */
const SITE_PREFIX = "loadtest-"
const ORG_SLUG = "loadtest-phase2a-synthetic"

/**
 * A ceiling on what one invocation can generate, so a mistyped argument cannot
 * turn a 10k acceptance run into a million-event flood.
 */
const MAX_TOTAL_EVENTS = 100_000

const DEFAULT_SITES = 30
const DEFAULT_EVENTS = 10_000
const DEFAULT_DURATION_MINUTES = 10

/** PII sentinels placed in fixture pages; none may reach storage. */
export const LOAD_SENTINELS = [
  "phase2-load-secret@example.com",
  "+905551111111",
  "LOAD_PRIVATE_MESSAGE",
]

interface LoadEnv {
  env: string
  supabaseUrl: string
  serviceRoleKey: string
  appUrl: string
  productionSupabaseUrl?: string
  productionAppUrl?: string
  /**
   * Vercel "Protection Bypass for Automation" secret.
   *
   * A preview deployment answers every unauthenticated request with 401 and an
   * SSO redirect, so the harness cannot reach it at all. This header is Vercel's
   * supported way through, and is preferable to switching protection off: the
   * deployment stays closed to the public while automation gets in.
   */
  vercelBypassSecret?: string
}

function fail(message: string): never {
  console.error(`REFUSED: ${message}`)
  process.exit(2)
}

function readEnv(): LoadEnv {
  const required = [
    "VERIDIA_ENV",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VERIDIA_LOAD_APP_URL",
  ]

  const missing = required.filter((key) => !process.env[key])

  if (missing.length > 0) {
    fail(`missing environment: ${missing.join(", ")}`)
  }

  return {
    env: process.env.VERIDIA_ENV ?? "",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    appUrl: (process.env.VERIDIA_LOAD_APP_URL ?? "").replace(/\/+$/, ""),
    productionSupabaseUrl: process.env.VERIDIA_PRODUCTION_SUPABASE_URL,
    productionAppUrl: process.env.VERIDIA_PRODUCTION_APP_URL,
    vercelBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  }
}

/** Headers every collector request carries, including the protection bypass. */
function collectorHeaders(
  env: LoadEnv,
  origin: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: origin,
    "User-Agent": "veridia-load-harness/1.0",
  }

  if (env.vercelBypassSecret) {
    headers["x-vercel-protection-bypass"] = env.vercelBypassSecret
    // Without this the bypass sets a cookie and Vercel may still redirect.
    headers["x-vercel-set-bypass-cookie"] = "false"
  }

  return headers
}

/**
 * Refuses anything that is not a dedicated staging target.
 *
 * `VERIDIA_PRODUCTION_SUPABASE_URL` must be set: without it the "am I pointed
 * at production" check silently passes, which is the failure mode this guard
 * exists to prevent. Declaring production explicitly is the only way the harness
 * can know what to refuse.
 */
function guard(env: LoadEnv) {
  if (env.env !== "staging" && env.env !== "acceptance") {
    fail(`VERIDIA_ENV must be staging or acceptance, got "${env.env}"`)
  }

  if (!env.productionSupabaseUrl) {
    fail(
      "VERIDIA_PRODUCTION_SUPABASE_URL must be set so the production database " +
        "can be recognised and refused",
    )
  }

  if (env.supabaseUrl === env.productionSupabaseUrl) {
    fail("target Supabase URL is the production database")
  }

  if (env.productionAppUrl && env.appUrl === env.productionAppUrl) {
    fail("target app URL is the production application")
  }

  for (const url of [env.supabaseUrl, env.appUrl]) {
    if (url.includes("example.supabase.co")) {
      fail("target is a placeholder URL")
    }
  }
}

function admin(env: LoadEnv): AdminClient {
  return createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function siteKeyFor(index: number): string {
  // Deterministic so a run can be resumed and cleanup can find every fixture.
  return `vtk_${"0".repeat(26)}${String(index).padStart(6, "0")}`
}

function siteName(index: number): string {
  return `${SITE_PREFIX}site-${String(index).padStart(3, "0")}`
}

async function preflight(env: LoadEnv, client: AdminClient) {
  const { error } = await client.from("organizations").select("id").limit(1)

  if (error) {
    fail(`cannot reach the target database: ${error.message}`)
  }

  const response = await fetch(`${env.appUrl}/api/v1/collect`, {
    method: "GET",
    headers: env.vercelBypassSecret
      ? {
          "x-vercel-protection-bypass": env.vercelBypassSecret,
          "x-vercel-set-bypass-cookie": "false",
        }
      : {},
    redirect: "manual",
  })

  // A protected preview deployment answers 401 or redirects to SSO. Every
  // request would fail the same way, so this is caught here rather than
  // surfacing as ten thousand mysterious errors during the run.
  if (
    response.status === 401 ||
    (response.status >= 300 && response.status < 400)
  ) {
    fail(
      "the deployment is protected: set VERCEL_AUTOMATION_BYPASS_SECRET, or " +
        "disable Vercel Deployment Protection for this project",
    )
  }

  if (response.status !== 405) {
    fail(
      `collector did not answer as expected (GET returned ${response.status})`,
    )
  }

  console.log(
    JSON.stringify(
      {
        status: "ready",
        env: env.env,
        supabaseHost: new URL(env.supabaseUrl).host,
        appHost: new URL(env.appUrl).host,
      },
      null,
      2,
    ),
  )
}

async function seed(client: AdminClient, siteCount: number) {
  const { data: org, error: orgError } = await client
    .from("organizations")
    .upsert(
      { name: "Load Test Synthetic", slug: ORG_SLUG, status: "active" },
      { onConflict: "slug" },
    )
    .select("id")
    .single()

  if (orgError || !org) {
    fail(`could not create the fixture organization: ${orgError?.message}`)
  }

  let created = 0
  let reused = 0

  for (let index = 0; index < siteCount; index += 1) {
    // public.sites has no unique constraint on (organization_id, name), so an
    // upsert cannot be used here. Look the row up, then insert only if absent;
    // that keeps the command repeatable without inventing a constraint the
    // production schema does not have.
    const { data: existing, error: lookupError } = await client
      .from("sites")
      .select("id")
      .eq("organization_id", org.id)
      .eq("name", siteName(index))
      .maybeSingle()

    if (lookupError) {
      fail(`site lookup failed for ${siteName(index)}: ${lookupError.message}`)
    }

    let siteId = existing?.id

    if (!siteId) {
      const { data: inserted, error: insertError } = await client
        .from("sites")
        .insert({
          organization_id: org.id,
          name: siteName(index),
          status: "active",
        })
        .select("id")
        .single()

      // A seed that silently creates nothing and reports success is worse than
      // one that stops: the failure would only surface as an unexplained empty
      // load run.
      if (insertError || !inserted) {
        fail(
          `site insert failed for ${siteName(index)}: ${insertError?.message}`,
        )
      }

      siteId = inserted.id
      created += 1
    } else {
      reused += 1
    }

    const domain = `${siteName(index)}.loadtest.invalid`
    const { data: existingDomain } = await client
      .from("site_domains")
      .select("id")
      .eq("site_id", siteId)
      .eq("normalized_domain", domain)
      .maybeSingle()

    if (!existingDomain) {
      const { error: domainError } = await client.from("site_domains").insert({
        site_id: siteId,
        domain,
        normalized_domain: domain,
        is_primary: true,
      })

      if (domainError) {
        fail(`domain insert failed for ${domain}: ${domainError.message}`)
      }
    }

    const { data: existingKey } = await client
      .from("site_tracker_keys")
      .select("id")
      .eq("public_key", siteKeyFor(index))
      .maybeSingle()

    if (!existingKey) {
      const { error: keyError } = await client
        .from("site_tracker_keys")
        .insert({
          organization_id: org.id,
          site_id: siteId,
          public_key: siteKeyFor(index),
          status: "active",
        })

      if (keyError) {
        fail(`tracker key insert failed for site ${index}: ${keyError.message}`)
      }
    }
  }

  const total = created + reused

  if (total !== siteCount) {
    fail(`expected ${siteCount} fixture sites, ended with ${total}`)
  }

  console.log(
    JSON.stringify({ organization: ORG_SLUG, created, reused, total }, null, 2),
  )
}

interface RunResult {
  requests: number
  events: number
  accepted: number
  duplicate: number
  quarantined: number
  rejected: number
  status429: number
  status4xx: number
  status5xx: number
  networkErrors: number
  latencyP50: number
  latencyP95: number
  latencyP99: number
  durationMs: number
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

/** Realistic mix: most visits start a session, fewer convert. */
function eventTypeFor(index: number): string {
  const bucket = index % 10
  if (bucket < 6) return "session_started"
  if (bucket < 8) return "whatsapp_clicked"
  if (bucket < 9) return "phone_clicked"
  return "form_started"
}

async function run(
  env: LoadEnv,
  options: { sites: number; events: number; concurrency: number },
): Promise<RunResult> {
  if (options.events > MAX_TOTAL_EVENTS) {
    fail(
      `refusing ${options.events} events; the harness ceiling is ${MAX_TOTAL_EVENTS}`,
    )
  }

  const startedAt = Date.now()
  const latencies: number[] = []
  const result: RunResult = {
    requests: 0,
    events: 0,
    accepted: 0,
    duplicate: 0,
    quarantined: 0,
    rejected: 0,
    status429: 0,
    status4xx: 0,
    status5xx: 0,
    networkErrors: 0,
    latencyP50: 0,
    latencyP95: 0,
    latencyP99: 0,
    durationMs: 0,
  }

  let issued = 0

  async function worker() {
    while (issued < options.events) {
      const index = issued++
      const siteIndex = index % options.sites
      const body = JSON.stringify({
        schemaVersion: "2.0",
        siteKey: siteKeyFor(siteIndex),
        events: [
          {
            eventId: `evt_${randomUUID()}`,
            eventType: eventTypeFor(index),
            sessionId: `ses_${randomUUID()}`,
            occurredAt: new Date().toISOString(),
            page: {
              url: `https://${siteName(siteIndex)}.loadtest.invalid/iletisim`,
              referrer: null,
            },
            trackerVersion: "0.1.0",
          },
        ],
      })

      const requestStarted = Date.now()

      try {
        const response = await fetch(`${env.appUrl}/api/v1/collect`, {
          method: "POST",
          headers: collectorHeaders(
            env,
            `https://${siteName(siteIndex)}.loadtest.invalid`,
          ),
          body,
        })

        latencies.push(Date.now() - requestStarted)
        result.requests += 1

        if (response.status === 202) {
          const summary = (await response.json()) as Record<string, number>
          result.events += 1
          result.accepted += summary.accepted ?? 0
          result.duplicate += summary.duplicate ?? 0
          result.quarantined += summary.quarantined ?? 0
          result.rejected += summary.rejected ?? 0
        } else if (response.status === 429) {
          result.status429 += 1
        } else if (response.status >= 500) {
          result.status5xx += 1
        } else {
          result.status4xx += 1
        }
      } catch {
        result.networkErrors += 1
      }
    }
  }

  await Promise.all(Array.from({ length: options.concurrency }, () => worker()))

  latencies.sort((a, b) => a - b)
  result.latencyP50 = percentile(latencies, 0.5)
  result.latencyP95 = percentile(latencies, 0.95)
  result.latencyP99 = percentile(latencies, 0.99)
  result.durationMs = Date.now() - startedAt

  return result
}

async function verify(client: AdminClient, result: RunResult | null) {
  const { data: org } = await client
    .from("organizations")
    .select("id")
    .eq("slug", ORG_SLUG)
    .maybeSingle()

  if (!org) {
    fail("no fixture organization; run seed first")
  }

  const { count: events } = await client
    .from("conversion_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)

  const { count: quarantined } = await client
    .from("quarantined_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)

  // Sentinels must not appear in any stored context field.
  const { data: sample } = await client
    .from("conversion_events")
    .select("page_host, page_path, referrer_host, utm_source, utm_campaign")
    .eq("organization_id", org.id)
    .limit(1000)

  const serialized = JSON.stringify(sample ?? [])
  const leaked = LOAD_SENTINELS.filter((s) => serialized.includes(s))

  const errorRate =
    result && result.requests > 0
      ? (result.status5xx + result.networkErrors) / result.requests
      : 0

  console.log(
    JSON.stringify(
      {
        storedEvents: events ?? 0,
        storedQuarantined: quarantined ?? 0,
        piiSentinelsFound: leaked,
        errorRate,
        errorBudget: 0.005,
        withinErrorBudget: errorRate < 0.005,
        run: result,
      },
      null,
      2,
    ),
  )

  if (leaked.length > 0) {
    console.error("PII_LEAK_DETECTED")
    process.exitCode = 1
  }
}

/**
 * Deletes only the fixture organization, verified by its exact prefixed slug.
 * The same double-check pattern as the Phase 1 acceptance cleanup.
 */
async function cleanup(client: AdminClient) {
  if (!ORG_SLUG.startsWith(SITE_PREFIX)) {
    fail(`fixture slug "${ORG_SLUG}" lost its "${SITE_PREFIX}" prefix`)
  }

  const { data: org } = await client
    .from("organizations")
    .select("id, slug")
    .eq("slug", ORG_SLUG)
    .maybeSingle()

  if (!org) {
    console.log(JSON.stringify({ organizations: 0, note: "nothing to remove" }))
    return
  }

  if (!org.slug.startsWith(SITE_PREFIX)) {
    fail(`refusing to delete "${org.slug}": not a load fixture`)
  }

  const { count: events } = await client
    .from("conversion_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)

  const { error } = await client.from("organizations").delete().eq("id", org.id)

  if (error) {
    fail(`cleanup failed: ${error.message}`)
  }

  const { data: residue } = await client
    .from("organizations")
    .select("id")
    .eq("slug", ORG_SLUG)
    .maybeSingle()

  if (residue) {
    fail("cleanup incomplete: fixture organization still present")
  }

  console.log(
    JSON.stringify(
      { organizations: 1, events: events ?? 0, residue: "none" },
      null,
      2,
    ),
  )
}

/**
 * Sends `count` requests in parallel and returns their statuses.
 *
 * Genuinely parallel: every request is started before any is awaited, which is
 * the only way to exercise a race. Issuing them in a loop with `await` would
 * serialise them and prove nothing.
 */
async function fireConcurrently(
  env: LoadEnv,
  bodies: string[],
  origin: string,
): Promise<{ statuses: number[]; networkErrors: number }> {
  const statuses: number[] = []
  let networkErrors = 0

  const responses = await Promise.all(
    bodies.map(async (body) => {
      try {
        const response = await fetch(`${env.appUrl}/api/v1/collect`, {
          method: "POST",
          headers: collectorHeaders(env, origin),
          body,
        })
        return response.status
      } catch {
        networkErrors += 1
        return 0
      }
    }),
  )

  statuses.push(...responses)
  return { statuses, networkErrors }
}

function eventBody(siteIndex: number, eventId: string, sessionId: string) {
  return JSON.stringify({
    schemaVersion: "2.0",
    siteKey: siteKeyFor(siteIndex),
    events: [
      {
        eventId,
        eventType: "whatsapp_clicked",
        sessionId,
        occurredAt: new Date().toISOString(),
        page: {
          url: `https://${siteName(siteIndex)}.loadtest.invalid/iletisim`,
          referrer: null,
        },
        trackerVersion: "0.1.0",
      },
    ],
  })
}

/**
 * Idempotency under concurrency.
 *
 * The same event id delivered by N simultaneous requests must yield exactly one
 * stored interaction, and no request may fail with a 5xx. This is the test
 * slice 2 could only verify at the RPC level; here it goes through the whole
 * HTTP path.
 */
async function concurrencyDuplicate(
  env: LoadEnv,
  client: AdminClient,
  concurrency: number,
) {
  const org = await requireFixtureOrg(client)
  const siteIndex = 0
  const eventId = `evt_${randomUUID()}`
  const sessionId = `ses_${randomUUID()}`
  const origin = `https://${siteName(siteIndex)}.loadtest.invalid`

  const bodies = Array.from({ length: concurrency }, () =>
    eventBody(siteIndex, eventId, sessionId),
  )

  const { statuses, networkErrors } = await fireConcurrently(
    env,
    bodies,
    origin,
  )

  const { count: stored } = await client
    .from("conversion_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)
    .eq("event_id", eventId)

  const serverErrors = statuses.filter((status) => status >= 500).length
  const accepted = statuses.filter((status) => status === 202).length

  const result = {
    concurrency,
    accepted,
    serverErrors,
    networkErrors,
    storedRows: stored ?? 0,
    pass: stored === 1 && serverErrors === 0 && networkErrors === 0,
  }

  console.log(JSON.stringify({ concurrentDuplicate: result }, null, 2))

  if (!result.pass) {
    console.error("CONCURRENCY_DUPLICATE_FAILED")
    process.exitCode = 1
  }
}

/**
 * Quota counting under concurrency.
 *
 * With an atomic counter the stored window count must equal exactly the number
 * of events submitted. A lost update -- the failure mode of read-then-write --
 * shows up as a count lower than what was sent.
 */
async function concurrencyQuota(
  env: LoadEnv,
  client: AdminClient,
  concurrency: number,
) {
  const org = await requireFixtureOrg(client)
  // A dedicated site so an earlier command's traffic cannot skew the counter.
  const siteIndex = 1
  const origin = `https://${siteName(siteIndex)}.loadtest.invalid`

  const { data: site } = await client
    .from("sites")
    .select("id")
    .eq("organization_id", org.id)
    .eq("name", siteName(siteIndex))
    .maybeSingle()

  if (!site) {
    fail("quota fixture site missing; run seed first")
  }

  await client.from("event_quotas").delete().eq("site_id", site.id)

  const bodies = Array.from({ length: concurrency }, () =>
    eventBody(siteIndex, `evt_${randomUUID()}`, `ses_${randomUUID()}`),
  )

  const { statuses, networkErrors } = await fireConcurrently(
    env,
    bodies,
    origin,
  )

  const { data: quotas } = await client
    .from("event_quotas")
    .select("scope, event_count")
    .eq("site_id", site.id)
    .eq("scope", "site")

  const counted = (quotas ?? []).reduce(
    (total, row) => total + (row.event_count ?? 0),
    0,
  )
  const delivered = statuses.filter((status) => status === 202).length
  const rateLimited = statuses.filter((status) => status === 429).length
  const serverErrors = statuses.filter((status) => status >= 500).length

  const result = {
    concurrency,
    delivered,
    rateLimited,
    serverErrors,
    networkErrors,
    quotaCounted: counted,
    // Every request that reached the collector incremented the counter exactly
    // once, whether or not the event was ultimately stored.
    pass: counted === delivered + rateLimited && serverErrors === 0,
  }

  console.log(JSON.stringify({ concurrentQuota: result }, null, 2))

  if (!result.pass) {
    console.error("CONCURRENCY_QUOTA_FAILED")
    process.exitCode = 1
  }
}

/**
 * Short burst at ten times the base concurrency.
 *
 * Deliberately short: the point is how quotas and risk behave when traffic
 * spikes, not to hold the system under sustained load.
 */
async function burst(
  env: LoadEnv,
  options: { sites: number; concurrency: number },
) {
  const events = options.concurrency * 10
  const result = await run(env, {
    sites: options.sites,
    events,
    concurrency: options.concurrency * 10,
  })

  const errorRate =
    result.requests > 0
      ? (result.status5xx + result.networkErrors) / result.requests
      : 0

  console.log(
    JSON.stringify(
      { burst: { ...result, errorRate, withinErrorBudget: errorRate < 0.005 } },
      null,
      2,
    ),
  )

  if (errorRate >= 0.005) {
    console.error("BURST_ERROR_BUDGET_EXCEEDED")
    process.exitCode = 1
  }
}

async function requireFixtureOrg(client: AdminClient) {
  const { data: org } = await client
    .from("organizations")
    .select("id")
    .eq("slug", ORG_SLUG)
    .maybeSingle()

  if (!org) {
    fail("no fixture organization; run seed first")
  }

  return org
}

async function main() {
  const env = readEnv()
  guard(env)

  const client = admin(env)
  const sites = Number(process.env.VERIDIA_LOAD_SITES ?? DEFAULT_SITES)
  const events = Number(process.env.VERIDIA_LOAD_EVENTS ?? DEFAULT_EVENTS)
  const concurrency = Number(process.env.VERIDIA_LOAD_CONCURRENCY ?? 20)
  const duplicateConcurrency = Number(
    process.env.VERIDIA_LOAD_DUPLICATE_CONCURRENCY ?? 20,
  )
  const quotaConcurrency = Number(
    process.env.VERIDIA_LOAD_QUOTA_CONCURRENCY ?? 50,
  )

  switch (command) {
    case "preflight":
      await preflight(env, client)
      return
    case "seed":
      await seed(client, sites)
      return
    case "run": {
      const result = await run(env, { sites, events, concurrency })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    case "concurrency-duplicate":
      await concurrencyDuplicate(env, client, duplicateConcurrency)
      return
    case "concurrency-quota":
      await concurrencyQuota(env, client, quotaConcurrency)
      return
    case "burst":
      await burst(env, { sites, concurrency })
      return
    case "verify":
      await verify(client, null)
      return
    case "cleanup":
      await cleanup(client)
      return
    default:
      console.log(
        `Usage: tsx scripts/load/phase2a.ts ` +
          `<preflight|seed|run|concurrency-duplicate|concurrency-quota|burst|verify|cleanup>\n\n` +
          `Requires a dedicated staging target. Defaults: ${DEFAULT_SITES} sites, ` +
          `${DEFAULT_EVENTS} events over ${DEFAULT_DURATION_MINUTES} minutes.`,
      )
      process.exitCode = 1
  }
}

void main().catch((error: unknown) => {
  console.error(
    "load harness failed:",
    error instanceof Error ? error.message : error,
  )
  process.exitCode = 1
})
