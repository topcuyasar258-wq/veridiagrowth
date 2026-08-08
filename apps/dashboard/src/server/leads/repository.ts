import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { notFound, redirect } from "next/navigation"

import type { Database } from "@veridia/database"
import { createSupabaseServerUserClient } from "@/lib/supabase/server"

import { assigneeLabel, memberLabel, pageSize } from "./format"
import type {
  DashboardContext,
  DashboardMember,
  LeadActionState,
  LeadDetail,
  LeadListFilters,
  LeadListItem,
  LeadListResult,
  LeadStatus,
  MemberRole,
} from "./types"

type OrganizationRow = {
  id: string
  name: string
  slug: string
  status: string
}

type MembershipRow = {
  organization_id: string
  user_id: string
  role: string
}

type ListLeadRpcRow = LeadListItem & {
  organization_id: string
  total_count: number
}

type UserClient = SupabaseClient<Database>

async function createLeadUserClient(): Promise<UserClient> {
  return (await createSupabaseServerUserClient()) as unknown as UserClient
}

function toMemberRole(role: string): MemberRole {
  if (role === "organization_owner" || role === "agent" || role === "viewer") {
    return role
  }

  return "viewer"
}

function dateFilterStart(filter: LeadListFilters["date"]) {
  const now = new Date()

  if (filter === "today") {
    now.setHours(0, 0, 0, 0)
    return now.toISOString()
  }

  if (filter === "7d") {
    now.setDate(now.getDate() - 7)
    return now.toISOString()
  }

  if (filter === "30d") {
    now.setDate(now.getDate() - 30)
    return now.toISOString()
  }

  return null
}

export async function getDashboardContext(): Promise<DashboardContext> {
  const supabase = await createLeadUserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: organizations, error: organizationsError } = await supabase
    .from("organizations")
    .select("id, name, slug, status")
    .order("created_at", { ascending: true })
    .limit(1)

  if (organizationsError) {
    throw new Error("Organizasyon bilgisi okunamadı.")
  }

  const organization = (organizations?.[0] ?? null) as OrganizationRow | null

  if (!organization) {
    return {
      userId: user.id,
      organizationId: "",
      organizationName: "Organizasyon yok",
      role: "viewer",
      sites: [],
      members: [],
    }
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("organization_members")
    .select("organization_id, user_id, role")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: true })

  if (membershipsError) {
    throw new Error("Ekip bilgisi okunamadı.")
  }

  const typedMemberships = (memberships ?? []) as MembershipRow[]
  const currentMembership = typedMemberships.find(
    (membership) => membership.user_id === user.id,
  )

  const members: DashboardMember[] = typedMemberships.map((membership) => {
    const role = toMemberRole(membership.role)

    return {
      userId: membership.user_id,
      role,
      label: memberLabel(membership.user_id, user.id, role),
    }
  })

  const { data: sites, error: sitesError } = await supabase
    .from("sites")
    .select("id, name, status")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })

  if (sitesError) {
    throw new Error("Site bilgisi okunamadı.")
  }

  return {
    userId: user.id,
    organizationId: organization.id,
    organizationName: organization.name,
    role: toMemberRole(currentMembership?.role ?? "viewer"),
    sites: sites ?? [],
    members,
  }
}

export async function listCustomerLeads(
  filters: LeadListFilters,
): Promise<LeadListResult> {
  const context = await getDashboardContext()

  if (!context.organizationId) {
    return {
      leads: [],
      total: 0,
      page: filters.page,
      pageSize,
    }
  }

  const supabase = await createLeadUserClient()
  const { data, error } = await supabase.rpc("list_customer_leads", {
    target_organization_id: context.organizationId,
    search_query: filters.query || null,
    status_filter: filters.status === "all" ? null : filters.status,
    source_filter: filters.source === "all" ? null : filters.source,
    assignee_filter:
      filters.assignee === "all" || filters.assignee === "unassigned"
        ? null
        : filters.assignee,
    unassigned_only: filters.assignee === "unassigned",
    site_filter: filters.siteId === "all" ? null : filters.siteId,
    created_after: dateFilterStart(filters.date),
    page_limit: pageSize,
    page_offset: (filters.page - 1) * pageSize,
  })

  if (error) {
    throw new Error("Talepler okunamadı.")
  }

  const rows = (data ?? []) as ListLeadRpcRow[]

  return {
    leads: rows.map((row) => ({
      id: row.id,
      site_id: row.site_id,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      phone_normalized: row.phone_normalized,
      email: row.email,
      service: row.service,
      city: row.city,
      status: row.status,
      assigned_to: row.assigned_to,
      is_duplicate: row.is_duplicate,
      duplicate_of: row.duplicate_of,
      is_suspicious: row.is_suspicious,
      suspicion_reasons: row.suspicion_reasons,
      source_category: row.source_category,
      version: row.version,
      last_activity_at: row.last_activity_at,
      created_at: row.created_at,
    })),
    total: rows[0]?.total_count ?? 0,
    page: filters.page,
    pageSize,
  }
}

export async function getLeadDetail(leadId: string): Promise<{
  context: DashboardContext
  lead: LeadDetail
}> {
  const context = await getDashboardContext()
  const supabase = await createLeadUserClient()

  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle()

  if (error) {
    throw new Error("Talep detayı okunamadı.")
  }

  if (!lead) {
    notFound()
  }

  const [{ data: attribution }, { data: notes }, { data: history }] =
    await Promise.all([
      supabase
        .from("lead_attributions")
        .select("*")
        .eq("lead_id", leadId)
        .maybeSingle(),
      supabase
        .from("lead_notes")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false }),
      supabase
        .from("lead_status_history")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false }),
    ])

  const siteName =
    context.sites.find((site) => site.id === lead.site_id)?.name ?? "Site"

  return {
    context,
    lead: {
      ...lead,
      attribution: attribution ?? null,
      notes: notes ?? [],
      history: history ?? [],
      siteName,
    },
  }
}

export async function getDashboardCounts() {
  const context = await getDashboardContext()

  if (!context.organizationId) {
    return {
      total: 0,
      newCount: 0,
      contactedCount: 0,
      suspiciousCount: 0,
    }
  }

  const supabase = await createLeadUserClient()

  const base = () =>
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", context.organizationId)
      .is("deleted_at", null)

  const [totalResult, newResult, contactedResult, suspiciousResult] =
    await Promise.all([
      base(),
      base().eq("status", "new"),
      base().eq("status", "contacted"),
      base().eq("is_suspicious", true),
    ])

  const results = [totalResult, newResult, contactedResult, suspiciousResult]

  if (results.some((result) => result.error)) {
    throw new Error("Talep özeti okunamadı.")
  }

  const [total, newCount, contactedCount, suspiciousCount] = results.map(
    (result) => result.count ?? 0,
  ) as [number, number, number, number]

  return {
    total,
    newCount,
    contactedCount,
    suspiciousCount,
  }
}

export function successState(message: string): LeadActionState {
  return { ok: true, message }
}

export function errorState(message: string, conflict = false): LeadActionState {
  return { ok: false, message, conflict }
}

export async function updateLeadStatus(
  leadId: string,
  expectedVersion: number,
  status: LeadStatus,
  note: string | null,
) {
  const supabase = await createLeadUserClient()

  return supabase.rpc("update_customer_lead_status", {
    target_lead_id: leadId,
    expected_version: expectedVersion,
    next_status: status,
    status_note: note,
  })
}

export async function addLeadNote(leadId: string, body: string) {
  const supabase = await createLeadUserClient()

  return supabase.rpc("add_customer_lead_note", {
    target_lead_id: leadId,
    note_body: body,
  })
}

export async function assignLead(
  leadId: string,
  expectedVersion: number,
  assigneeUserId: string | null,
) {
  const supabase = await createLeadUserClient()

  return supabase.rpc("assign_customer_lead", {
    target_lead_id: leadId,
    expected_version: expectedVersion,
    assignee_user_id: assigneeUserId,
  })
}

export { assigneeLabel }
