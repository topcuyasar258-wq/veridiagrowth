/**
 * 20260808120000_fix_owner_guard_on_organization_delete dogrulamasi.
 *
 * Migration, organizasyon silinirken cascade ile gelen uye silmelerini muaf
 * tutuyor. Bu scriptin amaci muafiyetin KORUMAYI ZAYIFLATMADIGINI kanitlamak:
 *
 *   1. Canli organizasyonda son sahibi silmek HALA reddedilmeli.
 *   2. Ikinci bir sahip varken sahip silmek serbest olmali.
 *   3. Organizasyonun tamami silinebilmeli.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"

import { fixture, guardEnvironment, readEnv } from "./config"

type AdminClient = SupabaseClient<Database>

const results: { step: string; ok: boolean; detail: string }[] = []

function check(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}  ${detail}`)
}

async function main() {
  const env = readEnv()
  guardEnvironment(env)

  const admin = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, slug")
    .eq("slug", fixture.orgSlug)
    .maybeSingle()

  if (orgError) throw new Error(`org lookup failed: ${orgError.message}`)
  if (!org) throw new Error("fixture org yok - once 'seed' calistir")

  const { data: owners } = await admin
    .from("organization_members")
    .select("id, user_id, role")
    .eq("organization_id", org.id)
    .eq("role", "organization_owner")

  const ownerRows = owners ?? []
  if (ownerRows.length !== 1) {
    throw new Error(`beklenen tek sahip, bulunan ${ownerRows.length}`)
  }

  // 1) Son sahibi silmek reddedilmeli.
  const { error: lastOwnerError } = await admin
    .from("organization_members")
    .delete()
    .eq("id", ownerRows[0].id)

  check(
    "1. canli org'da son sahip silinemez",
    !!lastOwnerError &&
      lastOwnerError.message.includes(
        "organization must retain at least one owner",
      ),
    lastOwnerError ? "reddedildi" : "IZIN VERILDI - KORUMA KIRILMIS",
  )

  const { count: stillThere } = await admin
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("id", ownerRows[0].id)
  check("1b. sahip kaydi duruyor", stillThere === 1, `adet=${stillThere}`)

  // 2) Ikinci sahip eklendiginde silme serbest olmali.
  const { data: agentRow } = await admin
    .from("organization_members")
    .select("id, user_id")
    .eq("organization_id", org.id)
    .eq("role", "agent")
    .maybeSingle()

  if (agentRow) {
    await admin
      .from("organization_members")
      .update({ role: "organization_owner" })
      .eq("id", agentRow.id)

    const { error: secondOwnerError } = await admin
      .from("organization_members")
      .delete()
      .eq("id", ownerRows[0].id)

    check(
      "2. ikinci sahip varken silme serbest",
      !secondOwnerError,
      secondOwnerError ? `HATA: ${secondOwnerError.message}` : "silindi",
    )
  }

  // 3) Organizasyonun tamami silinebilmeli (migration'in asil amaci).
  const { error: orgDeleteError } = await admin
    .from("organizations")
    .delete()
    .eq("id", org.id)

  check(
    "3. organizasyon tamamen silinebilir",
    !orgDeleteError,
    orgDeleteError ? `HATA: ${orgDeleteError.message}` : "silindi",
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
