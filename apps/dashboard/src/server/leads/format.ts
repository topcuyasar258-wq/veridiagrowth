import type {
  DashboardMember,
  LeadListFilters,
  LeadListItem,
  LeadStatus,
  MemberRole,
  SourceCategory,
  UuidString,
} from "./types"

export const pageSize = 25

export const leadStatusLabels: Record<LeadStatus, string> = {
  new: "Yeni",
  contacted: "İletişime Geçildi",
  offer_sent: "Teklif Gönderildi",
  won: "Kazanıldı",
  lost: "Kaybedildi",
}

export const sourceCategoryLabels: Record<SourceCategory, string> = {
  organic: "Organik",
  paid_search: "Google Ads",
  paid_social: "Sosyal Reklam",
  referral: "Referans",
  direct: "Direkt",
  unknown: "Bilinmiyor",
}

export const roleLabels: Record<MemberRole, string> = {
  organization_owner: "Yetkili",
  agent: "Personel",
  viewer: "İzleyici",
}

const statuses = new Set<LeadStatus>([
  "new",
  "contacted",
  "offer_sent",
  "won",
  "lost",
])

const sources = new Set<SourceCategory>([
  "organic",
  "paid_search",
  "paid_social",
  "referral",
  "direct",
  "unknown",
])

export function displayLeadName(
  lead: Pick<LeadListItem, "first_name" | "last_name" | "email" | "phone">,
) {
  const name = [lead.first_name, lead.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ")

  return name || lead.email || lead.phone || "İsimsiz Talep"
}

export function parseLeadFilters(
  searchParams: Record<string, string | string[] | undefined>,
): LeadListFilters {
  const value = (key: string) => {
    const raw = searchParams[key]
    return Array.isArray(raw) ? raw[0] : raw
  }

  const query = (value("q") ?? "").trim().slice(0, 80)
  const status = value("status")
  const source = value("source")
  const assignee = value("assignee")
  const siteId = value("site")
  const date = value("date")
  const page = Number.parseInt(value("page") ?? "1", 10)

  return {
    query: query.length >= 2 ? query : "",
    status:
      status && statuses.has(status as LeadStatus)
        ? (status as LeadStatus)
        : "all",
    source:
      source && sources.has(source as SourceCategory)
        ? (source as SourceCategory)
        : "all",
    assignee:
      assignee &&
      (assignee === "unassigned" || /^[0-9a-f-]{36}$/i.test(assignee))
        ? (assignee as UuidString | "unassigned")
        : "all",
    siteId:
      siteId && /^[0-9a-f-]{36}$/i.test(siteId)
        ? (siteId as UuidString)
        : "all",
    date:
      date === "today" || date === "7d" || date === "30d" || date === "all"
        ? date
        : "all",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  }
}

export function canMutateLead(role: MemberRole) {
  return role === "organization_owner" || role === "agent"
}

export function canAssignMember(
  role: MemberRole,
  member: DashboardMember,
  currentUserId: string,
) {
  if (role === "organization_owner") {
    return member.role === "organization_owner" || member.role === "agent"
  }

  return role === "agent" && member.userId === currentUserId
}

export function memberLabel(
  userId: string,
  currentUserId: string,
  role: MemberRole,
) {
  return userId === currentUserId
    ? `Ben (${roleLabels[role]})`
    : roleLabels[role]
}

export function assigneeLabel(
  assignedTo: string | null,
  members: DashboardMember[],
  currentUserId: string,
) {
  if (!assignedTo) {
    return "Atanmamış"
  }

  return (
    members.find((member) => member.userId === assignedTo)?.label ??
    memberLabel(assignedTo, currentUserId, "agent")
  )
}

export function buildTelHref(phoneNormalized: string | null) {
  if (!phoneNormalized || !/^\+[1-9]\d{7,14}$/.test(phoneNormalized)) {
    return null
  }

  return `tel:${phoneNormalized}`
}

export function buildWhatsAppHref(
  phoneNormalized: string | null,
  message?: string,
) {
  if (!phoneNormalized || !/^\+[1-9]\d{7,14}$/.test(phoneNormalized)) {
    return null
  }

  const digits = phoneNormalized.replace(/^\+/, "")
  const encodedMessage = message?.trim()
    ? `?text=${encodeURIComponent(message.trim())}`
    : ""

  return `https://wa.me/${digits}${encodedMessage}`
}

export function formatRelativeDate(value: string) {
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (!Number.isFinite(date.getTime())) {
    return ""
  }

  if (diffMs < hour) {
    return `${Math.max(1, Math.floor(diffMs / minute))} dk önce`
  }

  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)} saat önce`
  }

  if (diffMs < 2 * day) {
    return "Dün"
  }

  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date)
}
