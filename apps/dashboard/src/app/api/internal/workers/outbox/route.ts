import { createClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"
import { serverEnv } from "@/env/server"
import {
  isOutboxWorkerProductionReady,
  outboxWorkerConfig,
} from "@/server/outbox-worker/config"
import {
  runOutboxWorker,
  verifyWorkerAuthorization,
} from "@/server/outbox-worker/worker"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!verifyWorkerAuthorization(request, outboxWorkerConfig.workerSecret)) {
    return Response.json({ error: "invalid_request" }, { status: 401 })
  }

  // Checked after authorization so an unauthenticated caller cannot probe how
  // the deployment is configured.
  if (!isOutboxWorkerProductionReady()) {
    return Response.json({ error: "unavailable" }, { status: 503 })
  }

  const summary = await runOutboxWorker({
    client: createClient<Database>(
      serverEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    ),
  })

  return Response.json(summary)
}
