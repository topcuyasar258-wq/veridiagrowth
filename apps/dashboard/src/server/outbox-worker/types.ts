import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Json } from "@veridia/database"
import type { EmailProvider } from "../email/provider"

export type AdminClient = SupabaseClient<Database>

export type ClaimedOutboxEvent = {
  id: string
  organization_id: string
  site_id: string | null
  event_type: string
  aggregate_type: string
  aggregate_id: string
  job_key: string
  payload: Json
  status: string
  available_at: string
  attempt_count: number
  locked_at: string | null
  locked_by: string | null
  created_at: string
}

export type JobResult =
  | { ok: true }
  | {
      ok: false
      retryable: boolean
      code: string
      category:
        "provider" | "configuration" | "validation" | "database" | "unknown"
      messageSafe?: string
    }

export type OutboxHandlerContext = {
  client: AdminClient
  emailProvider: EmailProvider
  leadPanelBaseUrl: string
}

export type OutboxHandler = {
  eventType: string
  execute(
    event: ClaimedOutboxEvent,
    context: OutboxHandlerContext,
  ): Promise<JobResult>
}
