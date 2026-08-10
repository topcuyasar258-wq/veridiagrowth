/**
 * Strict interaction-event contract shared by the tracker and the collector.
 *
 * TERMINOLOGY (locked at code level, see docs/interaction-events.md):
 *   Interaction   — an anonymous browser signal. Never cryptographically
 *                   verified, therefore never a lead.
 *   Verified Lead — a `public.leads` row created by the Phase 1 HMAC-signed
 *                   Lead API.
 *
 * A browser can never assert a lead: `lead_created` is not a member of
 * INTERACTION_EVENT_TYPES and is rejected with a dedicated reason so the
 * attempt is visible rather than silently dropped.
 */

import {
  ALLOWED_ATTRIBUTION_KEYS,
  ALLOWED_CLICK_ID_KEYS,
  ALLOWED_EVENT_KEYS,
  ALLOWED_PAGE_KEYS,
  checkAllowedKeys,
  checkPrimitiveLeaves,
  type ClickIdKey,
  type PiiViolation,
} from "./pii"
import {
  extractUtm,
  MAX_UTM_LENGTH,
  sanitizePageUrl,
  sanitizeReferrer,
  type UtmKey,
} from "./url"

export const EVENT_SCHEMA_VERSION = "2.0"

/** The complete set of event types a public tracker may send. */
export const INTERACTION_EVENT_TYPES = [
  "session_started",
  "whatsapp_clicked",
  "phone_clicked",
  "form_started",
] as const

export type InteractionEventType = (typeof INTERACTION_EVENT_TYPES)[number]

/**
 * Event types that belong to the Phase 1 backend and must never arrive from a
 * browser. Listed explicitly so the rejection reason is specific.
 */
export const BACKEND_ONLY_EVENT_TYPES = [
  "lead_created",
  "lead_won",
  "lead_lost",
  "purchase",
] as const

export const MAX_BATCH_SIZE = 20
export const MAX_BODY_BYTES = 16 * 1024
export const MAX_ID_LENGTH = 64
export const MIN_ID_LENGTH = 16
/** Clock skew tolerance for `occurredAt`, matching the Phase 1 HMAC window. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
/** Events older than this are not worth accepting from a stale tab. */
export const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Click ids are issued by the ad platforms, so their length and alphabet are
 * not ours to choose. Bounded generously and checked for shape only: rejecting
 * a valid `gclid` because the platform lengthened it would lose the very
 * attribution the field exists to carry, while leaving it unbounded turns it
 * into a payload smuggling route.
 */
export const MAX_CLICK_ID_LENGTH = 512

const CLICK_ID_PATTERN = /^[A-Za-z0-9._~-]{1,512}$/
const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/

export interface NormalizedInteractionEvent {
  eventId: string
  eventType: InteractionEventType
  sessionId: string
  occurredAt: string
  pageHost: string | null
  pagePath: string | null
  referrerHost: string | null
  utm: Record<UtmKey, string | null>
  /**
   * Present only under marketing consent, and only ever scoped to one site --
   * see docs/tracker-privacy-boundaries.md. Absent is the normal case.
   */
  visitorId: string | null
  clickIds: Record<ClickIdKey, string | null>
  trackerVersion: string | null
  integrationVersion: string | null
}

export type RejectionReason =
  | "schema_version_mismatch"
  | "batch_too_large"
  | "batch_empty"
  | "not_an_object"
  | "unknown_field"
  | "forbidden_field"
  | "non_primitive_field"
  | "missing_field"
  | "invalid_event_id"
  | "invalid_session_id"
  | "invalid_visitor_id"
  | "invalid_click_id"
  | "invalid_event_type"
  | "backend_only_event_type"
  | "invalid_occurred_at"
  | "occurred_at_in_future"
  | "occurred_at_too_old"
  | "invalid_version"
  | "duplicate_event_id_in_batch"

export interface EventRejection {
  reason: RejectionReason
  path: string
  violations?: PiiViolation[]
}

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; rejection: EventRejection }

export function isInteractionEventType(
  value: unknown,
): value is InteractionEventType {
  return (
    typeof value === "string" &&
    (INTERACTION_EVENT_TYPES as readonly string[]).includes(value)
  )
}

export function isBackendOnlyEventType(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (BACKEND_ONLY_EVENT_TYPES as readonly string[]).includes(value)
  )
}

/**
 * Validates and normalizes a single event envelope.
 *
 * `now` is injected so validation is deterministic in tests rather than
 * dependent on wall-clock time.
 */
export function validateInteractionEvent(
  input: unknown,
  options: { now?: Date; path?: string } = {},
): ValidationResult<NormalizedInteractionEvent> {
  const path = options.path ?? "event"
  const now = options.now ?? new Date()

  if (!isPlainObject(input)) {
    return reject("not_an_object", path)
  }

  const keyViolations = [
    ...checkAllowedKeys(input, ALLOWED_EVENT_KEYS, path),
    ...checkPrimitiveLeaves(
      input,
      [
        "eventId",
        "eventType",
        "sessionId",
        "occurredAt",
        "trackerVersion",
        "integrationVersion",
      ],
      path,
    ),
  ]

  if (keyViolations.length > 0) {
    return reject(reasonFor(keyViolations), path, keyViolations)
  }

  const { eventId, eventType, sessionId, occurredAt } = input

  if (typeof eventId !== "string" || !ID_PATTERN.test(eventId)) {
    return reject("invalid_event_id", `${path}.eventId`)
  }

  if (typeof sessionId !== "string" || !ID_PATTERN.test(sessionId)) {
    return reject("invalid_session_id", `${path}.sessionId`)
  }

  // Checked before the general type check so the browser learns it may not
  // claim a lead, rather than getting a generic "unknown type".
  if (isBackendOnlyEventType(eventType)) {
    return reject("backend_only_event_type", `${path}.eventType`)
  }

  if (!isInteractionEventType(eventType)) {
    return reject("invalid_event_type", `${path}.eventType`)
  }

  if (typeof occurredAt !== "string") {
    return reject("invalid_occurred_at", `${path}.occurredAt`)
  }

  const occurredAtMs = Date.parse(occurredAt)
  if (Number.isNaN(occurredAtMs)) {
    return reject("invalid_occurred_at", `${path}.occurredAt`)
  }

  const nowMs = now.getTime()
  if (occurredAtMs - nowMs > MAX_CLOCK_SKEW_MS) {
    return reject("occurred_at_in_future", `${path}.occurredAt`)
  }

  if (nowMs - occurredAtMs > MAX_EVENT_AGE_MS) {
    return reject("occurred_at_too_old", `${path}.occurredAt`)
  }

  const trackerVersion = optionalVersion(input.trackerVersion)
  if (trackerVersion === INVALID) {
    return reject("invalid_version", `${path}.trackerVersion`)
  }

  const integrationVersion = optionalVersion(input.integrationVersion)
  if (integrationVersion === INVALID) {
    return reject("invalid_version", `${path}.integrationVersion`)
  }

  const page = input.page
  let pageHost: string | null = null
  let pagePath: string | null = null
  let referrerHost: string | null = null
  let utm: Record<UtmKey, string | null> = emptyUtm()

  if (page !== undefined && page !== null) {
    if (!isPlainObject(page)) {
      return reject("non_primitive_field", `${path}.page`)
    }

    const pageViolations = [
      ...checkAllowedKeys(page, ALLOWED_PAGE_KEYS, `${path}.page`),
      ...checkPrimitiveLeaves(page, ["url", "referrer"], `${path}.page`),
    ]

    if (pageViolations.length > 0) {
      return reject(reasonFor(pageViolations), `${path}.page`, pageViolations)
    }

    const url = typeof page.url === "string" ? page.url : null
    const sanitized = sanitizePageUrl(url)
    pageHost = sanitized.host
    pagePath = sanitized.path
    referrerHost = sanitizeReferrer(
      typeof page.referrer === "string" ? page.referrer : null,
    )
    utm = extractUtm(url)
  }

  const attribution = input.attribution

  if (attribution !== undefined && attribution !== null) {
    if (!isPlainObject(attribution)) {
      return reject("non_primitive_field", `${path}.attribution`)
    }

    const attributionViolations = [
      ...checkAllowedKeys(
        attribution,
        ALLOWED_ATTRIBUTION_KEYS,
        `${path}.attribution`,
      ),
      ...checkPrimitiveLeaves(
        attribution,
        [...ALLOWED_ATTRIBUTION_KEYS],
        `${path}.attribution`,
      ),
    ]

    if (attributionViolations.length > 0) {
      return reject(
        reasonFor(attributionViolations),
        `${path}.attribution`,
        attributionViolations,
      )
    }

    // Explicit attribution wins over values parsed out of the page URL: the
    // tracker persists first/last touch across navigations, the current URL
    // only describes this page.
    utm = {
      utm_source: pick(attribution.utmSource) ?? utm.utm_source,
      utm_medium: pick(attribution.utmMedium) ?? utm.utm_medium,
      utm_campaign: pick(attribution.utmCampaign) ?? utm.utm_campaign,
      utm_term: pick(attribution.utmTerm) ?? utm.utm_term,
      utm_content: pick(attribution.utmContent) ?? utm.utm_content,
    }
  }

  // Absent is the normal case: a visitor who has not given marketing consent
  // sends no identifier at all, rather than an empty or placeholder one.
  let visitorId: string | null = null

  if (input.visitorId !== undefined && input.visitorId !== null) {
    if (
      typeof input.visitorId !== "string" ||
      !ID_PATTERN.test(input.visitorId)
    ) {
      return reject("invalid_visitor_id", `${path}.visitorId`)
    }

    visitorId = input.visitorId
  }

  const clickIds = emptyClickIds()
  const rawClickIds = input.clickIds

  if (rawClickIds !== undefined && rawClickIds !== null) {
    if (!isPlainObject(rawClickIds)) {
      return reject("non_primitive_field", `${path}.clickIds`)
    }

    const clickIdViolations = [
      ...checkAllowedKeys(
        rawClickIds,
        ALLOWED_CLICK_ID_KEYS,
        `${path}.clickIds`,
      ),
      ...checkPrimitiveLeaves(
        rawClickIds,
        [...ALLOWED_CLICK_ID_KEYS],
        `${path}.clickIds`,
      ),
    ]

    if (clickIdViolations.length > 0) {
      return reject(
        reasonFor(clickIdViolations),
        `${path}.clickIds`,
        clickIdViolations,
      )
    }

    for (const key of ALLOWED_CLICK_ID_KEYS) {
      const raw = rawClickIds[key]

      if (raw === undefined || raw === null || raw === "") {
        continue
      }

      if (typeof raw !== "string" || !CLICK_ID_PATTERN.test(raw)) {
        return reject("invalid_click_id", `${path}.clickIds.${key}`)
      }

      clickIds[key] = raw
    }
  }

  return {
    ok: true,
    value: {
      eventId,
      eventType,
      sessionId,
      occurredAt: new Date(occurredAtMs).toISOString(),
      pageHost,
      pagePath,
      referrerHost,
      utm,
      visitorId,
      clickIds,
      trackerVersion,
      integrationVersion,
    },
  }
}

function emptyClickIds(): Record<ClickIdKey, string | null> {
  return { gclid: null, gbraid: null, wbraid: null, fbclid: null }
}

export interface ValidatedBatch {
  events: NormalizedInteractionEvent[]
  /** Duplicate ids collapsed inside the batch; reported, not an error. */
  droppedDuplicateIds: string[]
}

/**
 * Validates a batch envelope.
 *
 * Duplicate event ids inside one batch are collapsed rather than rejected: a
 * retrying tracker legitimately resends, and the caller should not lose the
 * whole batch over it.
 */
export function validateInteractionBatch(
  input: unknown,
  options: { now?: Date } = {},
): ValidationResult<ValidatedBatch> {
  if (!isPlainObject(input)) {
    return reject("not_an_object", "body")
  }

  if (input.schemaVersion !== EVENT_SCHEMA_VERSION) {
    return reject("schema_version_mismatch", "body.schemaVersion")
  }

  const rawEvents = input.events

  if (!Array.isArray(rawEvents)) {
    return reject("missing_field", "body.events")
  }

  if (rawEvents.length === 0) {
    return reject("batch_empty", "body.events")
  }

  if (rawEvents.length > MAX_BATCH_SIZE) {
    return reject("batch_too_large", "body.events")
  }

  const events: NormalizedInteractionEvent[] = []
  const seen = new Set<string>()
  const droppedDuplicateIds: string[] = []

  for (const [index, rawEvent] of rawEvents.entries()) {
    const result = validateInteractionEvent(rawEvent, {
      now: options.now,
      path: `body.events[${index}]`,
    })

    if (!result.ok) {
      return result
    }

    if (seen.has(result.value.eventId)) {
      droppedDuplicateIds.push(result.value.eventId)
      continue
    }

    seen.add(result.value.eventId)
    events.push(result.value)
  }

  return { ok: true, value: { events, droppedDuplicateIds } }
}

const INVALID = Symbol("invalid") as unknown as string

function optionalVersion(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null
  }

  if (typeof value !== "string" || !VERSION_PATTERN.test(value)) {
    return INVALID
  }

  return value
}

function pick(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim().slice(0, MAX_UTM_LENGTH)
  return trimmed.length > 0 ? trimmed : null
}

function emptyUtm(): Record<UtmKey, string | null> {
  return {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
  }
}

function reasonFor(violations: PiiViolation[]): RejectionReason {
  if (violations.some((v) => v.kind === "forbidden_key")) {
    return "forbidden_field"
  }

  if (violations.some((v) => v.kind === "non_primitive")) {
    return "non_primitive_field"
  }

  return "unknown_field"
}

function reject(
  reason: RejectionReason,
  path: string,
  violations?: PiiViolation[],
): ValidationResult<never> {
  return { ok: false, rejection: { reason, path, violations } }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
