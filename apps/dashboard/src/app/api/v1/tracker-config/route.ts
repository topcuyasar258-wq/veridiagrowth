import { createClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"

import { serverEnv } from "@/env/server"
import { resolveSiteKey } from "@/server/interaction-collector/site-resolution"

export const runtime = "nodejs"

/**
 * Public tracker configuration resolution.
 *
 * Answers one question for a loader: which tracker artifact should this site
 * load. That is the mechanism behind pinning and rollback — a site changes
 * version without anyone editing the snippet in its HTML.
 *
 * Cached for five minutes. The number is a deliberate trade: an incident
 * rollback must reach every visitor quickly, while a per-page-view query
 * against the database would make this endpoint a bottleneck on exactly the
 * traffic it serves. Five minutes is a tolerable worst case for a rollback to
 * propagate. The versioned artifact itself is immutable and cached for a year.
 */
const CACHE_SECONDS = 300

export async function GET(request: Request) {
  const siteKey = new URL(request.url).searchParams.get("siteKey")

  const client = createClient<Database>(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const resolution = await resolveSiteKey(client, siteKey)

  if (!resolution.ok) {
    // Same answer for unknown, malformed, revoked and paused, so site existence
    // cannot be probed.
    return Response.json(
      { error: "invalid_request" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    )
  }

  const { data } = await client.rpc("resolve_site_tracker_release", {
    target_site_id: resolution.site.siteId,
  })

  const row = Array.isArray(data) ? data[0] : data

  // Deliberately minimal. No organization id, no site id, no risk configuration,
  // no domain list: everything here is readable by anyone who views the page
  // source of a customer site.
  return Response.json(
    {
      trackerVersion: row?.version ?? null,
      artifactSha256: row?.artifact_sha256 ?? null,
      pinned: row?.pinned ?? false,
    },
    {
      headers: {
        "Cache-Control": `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=60`,
        "Access-Control-Allow-Origin": "*",
        Vary: "Origin",
      },
    },
  )
}

/**
 * The config response carries no tenant data and no credentials, so a wildcard
 * origin is safe here in a way it would not be on the collector. A loader on any
 * customer domain must be able to read it.
 */
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Max-Age": "600",
    },
  })
}
