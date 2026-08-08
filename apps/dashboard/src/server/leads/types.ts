import type { Database } from "@veridia/database"

export type LeadStatus = "new" | "contacted" | "offer_sent" | "won" | "lost"

export type SourceCategory =
  "organic" | "paid_search" | "paid_social" | "referral" | "direct" | "unknown"

export type MemberRole = "organization_owner" | "agent" | "viewer"
export type UuidString = string & { readonly __uuidString: unique symbol }

export type LeadRow = Database["public"]["Tables"]["leads"]["Row"]
export type LeadAttributionRow =
  Database["public"]["Tables"]["lead_attributions"]["Row"]
export type LeadNoteRow = Database["public"]["Tables"]["lead_notes"]["Row"]
export type LeadStatusHistoryRow =
  Database["public"]["Tables"]["lead_status_history"]["Row"]
export type SiteRow = Database["public"]["Tables"]["sites"]["Row"]

export type DashboardMember = {
  userId: string
  role: MemberRole
  label: string
}

export type DashboardContext = {
  userId: string
  organizationId: string
  organizationName: string
  role: MemberRole
  sites: Pick<SiteRow, "id" | "name" | "status">[]
  members: DashboardMember[]
}

export type LeadListFilters = {
  query: string
  status: LeadStatus | "all"
  source: SourceCategory | "all"
  assignee: UuidString | "all" | "unassigned"
  siteId: UuidString | "all"
  date: "all" | "today" | "7d" | "30d"
  page: number
}

export type LeadListItem = Pick<
  LeadRow,
  | "id"
  | "first_name"
  | "last_name"
  | "phone"
  | "phone_normalized"
  | "email"
  | "service"
  | "city"
  | "status"
  | "assigned_to"
  | "is_duplicate"
  | "duplicate_of"
  | "is_suspicious"
  | "suspicion_reasons"
  | "source_category"
  | "version"
  | "last_activity_at"
  | "created_at"
  | "site_id"
>

export type LeadDetail = LeadRow & {
  attribution: LeadAttributionRow | null
  notes: LeadNoteRow[]
  history: LeadStatusHistoryRow[]
  siteName: string
}

export type LeadListResult = {
  leads: LeadListItem[]
  total: number
  page: number
  pageSize: number
}

export type LeadActionState = {
  ok: boolean
  message: string
  conflict?: boolean
}
