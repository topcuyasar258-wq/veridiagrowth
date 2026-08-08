import { createClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"
import { serverEnv } from "@/env/server"
import { leadIngestionConfig } from "@/server/lead-ingestion/config"
import { handleLeadIngestion } from "@/server/lead-ingestion/service"
import { CloudflareTurnstileProvider } from "@/server/lead-ingestion/turnstile"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!leadIngestionConfig.turnstileSecretKey) {
    return Response.json({ error: "invalid_request" }, { status: 503 })
  }

  return handleLeadIngestion(request, {
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
    botChallengeProvider: new CloudflareTurnstileProvider({
      secretKey: leadIngestionConfig.turnstileSecretKey,
      timeoutMs: leadIngestionConfig.turnstileTimeoutMs,
    }),
  })
}
