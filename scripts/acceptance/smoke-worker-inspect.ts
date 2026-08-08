import { createClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"

import { fixture, guardEnvironment, readEnv } from "./config"

async function main() {
  const env = readEnv()
  guardEnvironment(env)

  const admin = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", fixture.orgSlug)
    .maybeSingle()
  if (!org) throw new Error("org yok")

  async function dump(table: string, columns: string) {
    const { data, error } = await admin
      .from(table as "outbox_events")
      .select(columns)
      .eq("organization_id", org!.id)
    if (error) {
      console.log(`${table}: SORGU HATASI -> ${error.message}`)
      return
    }
    console.log(
      `${table} (${(data ?? []).length} satir):`,
      JSON.stringify(data, null, 2),
    )
  }

  await dump(
    "outbox_events",
    "event_type, status, attempt_count, last_error_code",
  )
  await dump(
    "dead_letter_events",
    "event_type, failure_code, failure_category, failure_message_safe, final_attempt_count",
  )
  await dump(
    "delivery_operations",
    "channel, template_key, status, logical_delivery_key",
  )
  await dump(
    "delivery_attempts",
    "channel, provider, status, attempt_number, error_code, error_message_safe",
  )
  await dump("job_executions", "job_key, status")
}

void main().catch((e) => {
  console.error("HATA:", e instanceof Error ? e.message : e)
  process.exitCode = 1
})
