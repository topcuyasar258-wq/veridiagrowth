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

export {
  classifySourceCategory,
  sourceCategories,
  type SourceCategory,
  type SourceClassificationInput,
} from "./attribution/source-classification"

export {
  ALLOWED_ATTRIBUTION_KEYS,
  ALLOWED_CLICK_ID_KEYS,
  ALLOWED_EVENT_KEYS,
  ALLOWED_PAGE_KEYS,
  FORBIDDEN_KEYS,
  checkAllowedKeys,
  checkPrimitiveLeaves,
  isForbiddenKey,
  type AllowedEventKey,
  type ClickIdKey,
  type PiiViolation,
} from "./events/pii"

export {
  MAX_HOST_LENGTH,
  MAX_PATH_LENGTH,
  MAX_UTM_LENGTH,
  UTM_KEYS,
  extractUtm,
  sanitizePageUrl,
  sanitizeReferrer,
  sanitizeUrl,
  type SanitizedPage,
  type SanitizedUrl,
  type UtmKey,
} from "./events/url"

export {
  BACKEND_ONLY_EVENT_TYPES,
  EVENT_SCHEMA_VERSION,
  INTERACTION_EVENT_TYPES,
  MAX_BATCH_SIZE,
  MAX_BODY_BYTES,
  MAX_CLOCK_SKEW_MS,
  MAX_EVENT_AGE_MS,
  isBackendOnlyEventType,
  isInteractionEventType,
  validateInteractionBatch,
  validateInteractionEvent,
  type EventRejection,
  type InteractionEventType,
  type NormalizedInteractionEvent,
  type RejectionReason,
  type ValidatedBatch,
  type ValidationResult,
} from "./events/contract"

export {
  ATTRIBUTION_WINDOW_DAYS,
  ATTRIBUTION_WINDOW_MS,
  applyTouch,
  isDirectOrUnknown,
  isWithinWindow,
  resolveSourceCategory,
  touchCategory,
  type AttributionState,
  type AttributionTouch,
} from "./events/attribution-contract"
