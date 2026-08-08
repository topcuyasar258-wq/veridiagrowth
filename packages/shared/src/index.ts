export const organizationRoles = [
  "organization_owner",
  "agent",
  "viewer",
] as const

export type OrganizationRole = (typeof organizationRoles)[number]

export type OrganizationStatus = "active" | "suspended" | "archived"
export type SiteStatus = "active" | "paused" | "archived"

export interface Organization {
  id: string
  name: string
  slug: string
  status: OrganizationStatus
  created_at: string
  updated_at: string
}

export interface Site {
  id: string
  organization_id: string
  name: string
  status: SiteStatus
  created_at: string
  updated_at: string
}

export { normalizeEmail, normalizeTurkishPhone } from "./contact-normalization"
