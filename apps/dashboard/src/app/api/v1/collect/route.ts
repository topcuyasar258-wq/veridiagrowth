import { createClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"

import { serverEnv } from "@/env/server"
import {
  collectorConfig,
  isCollectorProductionReady,
} from "@/server/interaction-collector/config"
import { handleCollectRequest } from "@/server/interaction-collector/service"
import { readLimitedRawBody } from "@/server/lead-ingestion/raw-body"

export const runtime = "nodejs"

/**
 * Public interaction collector.
 *
 * Unlike `/api/v1/leads` this endpoint is called directly from customer pages
 * and carries no HMAC signature: a browser cannot hold a signing secret. Nothing
 * it receives is verified, which is why every write here lands in the anonymous
 * interaction tables and never in `public.leads`.
 *
 * The service role client is constructed per request and never leaves the
 * server; the client bundle secret scan covers this file.
 */

function baseHeaders(allowedOrigin: string | null) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Vary: "Origin",
  })

  // Only a configured origin is echoed, and credentials are never allowed. A
  // wildcard would let any page read collector responses.
  if (allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", allowedOrigin)
  }

  return headers
}

export async function POST(request: Request) {
  // Fail closed on a misconfigured deployment rather than serving traffic with
  // the per-IP rate limit quietly missing.
  if (!isCollectorProductionReady()) {
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: baseHeaders(null) },
    )
  }

  const rawBody = await readLimitedRawBody(
    request,
    collectorConfig.bodyLimitBytes,
  )

  if (!rawBody.ok) {
    return Response.json(
      { error: "invalid_request" },
      {
        status: rawBody.code === "body_too_large" ? 413 : 400,
        headers: baseHeaders(null),
      },
    )
  }

  const client = createClient<Database>(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const outcome = await handleCollectRequest({
    client,
    request,
    rawBodyText: rawBody.text,
  })

  if (outcome.status !== 202) {
    return Response.json(
      { error: outcome.error },
      { status: outcome.status, headers: baseHeaders(null) },
    )
  }

  // Counts only. Per-event risk reasons stay internal: telling a caller which
  // signal caught it is a tuning guide for evading the filter.
  return Response.json(outcome.summary, {
    status: 202,
    headers: baseHeaders(outcome.allowedOrigin),
  })
}

/**
 * Preflight is answered without resolving the site key.
 *
 * A preflight carries no body, so there is no key to resolve, and answering
 * differently per site would leak which sites exist. The real origin check
 * happens on the POST.
 */
export function OPTIONS(request: Request) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  })

  const origin = request.headers.get("origin")
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin)
  }

  return new Response(null, { status: 204, headers })
}

/**
 * Event payloads are never accepted through a query string: URLs are logged by
 * proxies and browser history, and this endpoint handles page context.
 */
export function GET() {
  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: "POST, OPTIONS" } },
  )
}

export const PUT = GET
export const PATCH = GET
export const DELETE = GET
