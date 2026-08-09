import { createClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"

import { serverEnv } from "@/env/server"
import { outboxWorkerConfig } from "@/server/outbox-worker/config"
import { verifyWorkerAuthorization } from "@/server/outbox-worker/worker"
import { runMaintenance } from "@/server/tracker-operations/maintenance"

export const runtime = "nodejs"

/**
 * Internal maintenance worker: retention sweep and anomaly detection.
 *
 * Behind the same worker secret as the outbox worker rather than a public RPC.
 * Retention deletes data and anomaly detection reads across every tenant, so
 * neither may ever be reachable from a customer session.
 *
 * Intended to be called on a schedule. Each invocation is bounded and repeated
 * invocation is idempotent, so a missed run costs nothing but a delay.
 */
export async function POST(request: Request) {
  if (!verifyWorkerAuthorization(request, outboxWorkerConfig.workerSecret)) {
    return Response.json({ error: "invalid_request" }, { status: 401 })
  }

  const summary = await runMaintenance(
    createClient<Database>(
      serverEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    ),
  )

  // Counts and timings only: no event payload, no identifier, no tenant detail.
  return Response.json(summary)
}
