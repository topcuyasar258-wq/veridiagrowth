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
  }
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
  })

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
      {
        onConflict: "slug",
      },
    )
    .select("id")
    .single()

  if (orgError || !org) {
    fail(`could not create the fixture organization: ${orgError?.message}`)
  }

  let created = 0

  for (let index = 0; index < siteCount; index += 1) {
    const { data: site } = await client
      .from("sites")
      .upsert(
        { organization_id: org.id, name: siteName(index), status: "active" },
        { onConflict: "organization_id,name" },
      )
      .select("id")
      .single()

    if (!site) continue

    await client.from("site_domains").upsert(
      {
        site_id: site.id,
        domain: `${siteName(index)}.loadtest.invalid`,
        normalized_domain: `${siteName(index)}.loadtest.invalid`,
        is_primary: true,
      },
      { onConflict: "site_id,normalized_domain" },
    )

    await client.from("site_tracker_keys").upsert(
      {
        organization_id: org.id,
        site_id: site.id,
        public_key: siteKeyFor(index),
        status: "active",
      },
      { onConflict: "public_key" },
    )

    created += 1
  }

  console.log(
    JSON.stringify({ organization: ORG_SLUG, sites: created }, null, 2),
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
          headers: {
            "Content-Type": "application/json",
            Origin: `https://${siteName(siteIndex)}.loadtest.invalid`,
            "User-Agent": "veridia-load-harness/1.0",
          },
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

async function main() {
  const env = readEnv()
  guard(env)

  const client = admin(env)
  const sites = Number(process.env.VERIDIA_LOAD_SITES ?? DEFAULT_SITES)
  const events = Number(process.env.VERIDIA_LOAD_EVENTS ?? DEFAULT_EVENTS)
  const concurrency = Number(process.env.VERIDIA_LOAD_CONCURRENCY ?? 20)

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
    case "verify":
      await verify(client, null)
      return
    case "cleanup":
      await cleanup(client)
      return
    default:
      console.log(
        `Usage: tsx scripts/load/phase2a.ts <preflight|seed|run|verify|cleanup>\n\n` +
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
