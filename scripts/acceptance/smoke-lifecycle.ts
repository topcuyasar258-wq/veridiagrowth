import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"

import { fixture, guardEnvironment, readEnv } from "./config"

type Client = SupabaseClient<Database>

const results: { step: string; ok: boolean; detail: string }[] = []

function check(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}  ${detail}`)
}

async function signIn(
  url: string,
  anonKey: string,
  email: string,
  password: string,
) {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`${email} girisi basarisiz: ${error.message}`)
  return client
}

async function main() {
  const env = readEnv()
  guardEnvironment(env)

  const admin = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const pass = env.ACCEPTANCE_USER_PASSWORD

  const owner = await signIn(url, anon, fixture.ownerEmail, pass)
  const agent = await signIn(url, anon, fixture.agentEmail, pass)
  const viewer = await signIn(url, anon, fixture.viewerEmail, pass)
  const orgB = await signIn(url, anon, fixture.orgBEmail, pass)

  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", fixture.orgSlug)
    .maybeSingle()
  if (!org) throw new Error("fixture organization yok")

  const { data: agentUser } = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", org.id)
    .eq("role", "agent")
    .maybeSingle()

  // en eski (duplicate olmayan) lead uzerinde calis
  const { data: targetLead } = await admin
    .from("leads")
    .select("id, version, status")
    .eq("organization_id", org.id)
    .eq("is_duplicate", false)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!targetLead) throw new Error("hedef lead yok")

  const leadId = targetLead.id

  // --- ADIM 11: RLS ---
  for (const [label, client] of [
    ["owner", owner],
    ["agent", agent],
    ["viewer", viewer],
  ] as [string, Client][]) {
    const { data, error } = await client
      .from("leads")
      .select("id")
      .eq("organization_id", org.id)
    check(
      `11. ${label} kendi org leadlerini gorur`,
      !error && (data ?? []).length > 0,
      `adet=${(data ?? []).length}`,
    )
  }

  const { data: crossData } = await orgB
    .from("leads")
    .select("id")
    .eq("organization_id", org.id)
  check(
    "11. cross-tenant sizinti yok",
    (crossData ?? []).length === 0,
    `orgB gordugu=${(crossData ?? []).length}`,
  )

  const { error: viewerMutErr } = await viewer.rpc(
    "update_customer_lead_status",
    {
      target_lead_id: leadId,
      expected_version: targetLead.version,
      next_status: "contacted",
    },
  )
  check(
    "11. viewer mutasyon yapamaz",
    !!viewerMutErr,
    viewerMutErr ? "reddedildi" : "IZIN VERILDI",
  )

  // --- ADIM 12: owner list RPC ---
  const { data: listed, error: listErr } = await owner.rpc(
    "list_customer_leads",
    {
      target_organization_id: org.id,
    },
  )
  const listedRows = (listed ?? []) as { id?: string }[]
  check(
    "12. owner list RPC leadi gorur",
    !listErr && listedRows.some((r) => r.id === leadId),
    `donen=${listedRows.length}`,
  )

  // --- ADIM 13 + 14: yasam dongusu ---
  async function currentVersion() {
    const { data } = await admin
      .from("leads")
      .select("version, status")
      .eq("id", leadId)
      .maybeSingle()
    return data
  }

  async function auditCount() {
    const { count } = await admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org!.id)
    return count ?? 0
  }

  async function historyCount() {
    const { count } = await admin
      .from("lead_status_history")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
    return count ?? 0
  }

  // stale version reddedilmeli
  const before = await currentVersion()
  const { error: staleErr } = await owner.rpc("update_customer_lead_status", {
    target_lead_id: leadId,
    expected_version: (before?.version ?? 1) + 99,
    next_status: "contacted",
  })
  check(
    "14. stale version reddedilir",
    !!staleErr,
    staleErr ? "reddedildi" : "IZIN VERILDI",
  )

  // new -> contacted
  let v = await currentVersion()
  let a0 = await auditCount()
  let h0 = await historyCount()
  const { error: e1 } = await owner.rpc("update_customer_lead_status", {
    target_lead_id: leadId,
    expected_version: v!.version,
    next_status: "contacted",
  })
  let v1 = await currentVersion()
  check(
    "13a. new -> contacted",
    !e1 && v1?.status === "contacted",
    `status=${v1?.status} err=${e1?.message ?? "-"}`,
  )
  check(
    "14a. version arttı",
    (v1?.version ?? 0) === (v!.version ?? 0) + 1,
    `${v!.version} -> ${v1?.version}`,
  )
  check(
    "14a. status history eklendi",
    (await historyCount()) === h0 + 1,
    `+${(await historyCount()) - h0}`,
  )
  check(
    "14a. audit eklendi",
    (await auditCount()) > a0,
    `${a0} -> ${await auditCount()}`,
  )

  // not ekle
  const { error: e2 } = await owner.rpc("add_customer_lead_note", {
    target_lead_id: leadId,
    note_body: "Smoke test notu",
  })
  const { count: noteCount } = await admin
    .from("lead_notes")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
  check(
    "13b. not eklendi",
    !e2 && (noteCount ?? 0) === 1,
    `adet=${noteCount} err=${e2?.message ?? "-"}`,
  )

  // agent'a ata
  v = await currentVersion()
  const { error: e3 } = await owner.rpc("assign_customer_lead", {
    target_lead_id: leadId,
    expected_version: v!.version,
    assignee_user_id: agentUser?.user_id ?? null,
  })
  const { data: assigned } = await admin
    .from("leads")
    .select("assigned_to, version")
    .eq("id", leadId)
    .maybeSingle()
  check(
    "13c. agent'a atandı",
    !e3 && assigned?.assigned_to === agentUser?.user_id,
    `err=${e3?.message ?? "-"}`,
  )
  check(
    "14c. version arttı",
    (assigned?.version ?? 0) === (v!.version ?? 0) + 1,
    `${v!.version} -> ${assigned?.version}`,
  )

  // contacted -> offer_sent
  v = await currentVersion()
  const { error: e4 } = await owner.rpc("update_customer_lead_status", {
    target_lead_id: leadId,
    expected_version: v!.version,
    next_status: "offer_sent",
  })
  v1 = await currentVersion()
  check(
    "13d. contacted -> offer_sent",
    !e4 && v1?.status === "offer_sent",
    `status=${v1?.status} err=${e4?.message ?? "-"}`,
  )

  // offer_sent -> won
  v = await currentVersion()
  const { error: e5 } = await owner.rpc("update_customer_lead_status", {
    target_lead_id: leadId,
    expected_version: v!.version,
    next_status: "won",
  })
  v1 = await currentVersion()
  check(
    "13e. offer_sent -> won",
    !e5 && v1?.status === "won",
    `status=${v1?.status} err=${e5?.message ?? "-"}`,
  )

  // cross-tenant mutasyon denemesi
  const { error: crossMutErr } = await orgB.rpc("update_customer_lead_status", {
    target_lead_id: leadId,
    expected_version: v1!.version,
    next_status: "lost",
  })
  check(
    "14. cross-tenant mutasyon engellendi",
    !!crossMutErr,
    crossMutErr ? "reddedildi" : "IZIN VERILDI",
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
