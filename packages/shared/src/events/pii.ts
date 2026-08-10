/**
 * PII boundary for anonymous interaction events.
 *
 * The tracker runs inside customer pages that contain real personal data, so
 * the boundary is enforced by an allowlist, not a blocklist: a field is dropped
 * unless it is explicitly permitted. A blocklist would silently pass every
 * field name nobody thought of.
 *
 * The forbidden-key list below is therefore not the boundary. It exists so that
 * a rejected payload can be reported with a precise reason, and so that tests
 * can assert on well-known offenders.
 */

/** The only keys an event envelope may carry. */
export const ALLOWED_EVENT_KEYS = [
  "eventId",
  "eventType",
  "sessionId",
  "occurredAt",
  "page",
  "attribution",
  "visitorId",
  "clickIds",
  "trackerVersion",
  "integrationVersion",
] as const

export const ALLOWED_PAGE_KEYS = ["url", "referrer"] as const

export const ALLOWED_ATTRIBUTION_KEYS = [
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
] as const

/**
 * Advertising click identifiers.
 *
 * These are the only query-string parameters besides UTM that survive, and they
 * are the reason remarketing can work at all: an ad platform recognises its own
 * click id, and nothing in this system can reconstruct one.
 *
 * `gbraid` and `wbraid` are Google's replacements for `gclid` on traffic where
 * `gclid` is unavailable. Accepting only `gclid` would silently lose the
 * campaigns that use them.
 *
 * They identify an ad click, not a person, but they are still an advertising
 * identifier: the tracker sends them only under marketing consent.
 */
export const ALLOWED_CLICK_ID_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
] as const

export type ClickIdKey = (typeof ALLOWED_CLICK_ID_KEYS)[number]

export type AllowedEventKey = (typeof ALLOWED_EVENT_KEYS)[number]

/**
 * Well-known personal-data field names. Used for diagnostics only; rejection is
 * driven by the allowlist above.
 */
export const FORBIDDEN_KEYS = [
  "firstname",
  "lastname",
  "fullname",
  "name",
  "email",
  "emailaddress",
  "phone",
  "phonenumber",
  "tel",
  "telephone",
  "mobile",
  "whatsapp",
  "whatsappnumber",
  "message",
  "comment",
  "note",
  "address",
  "street",
  "city",
  "postcode",
  "zip",
  "password",
  "passwd",
  "secret",
  "token",
  "value",
  "formdata",
  "fields",
  "payload",
  "metadata",
] as const

export type PiiViolation =
  | { kind: "unknown_key"; path: string }
  | { kind: "forbidden_key"; path: string }
  | { kind: "non_primitive"; path: string }

const normalize = (key: string) => key.toLowerCase().replace(/[\s_-]/g, "")

const forbidden = new Set<string>(FORBIDDEN_KEYS.map(normalize))

export function isForbiddenKey(key: string): boolean {
  return forbidden.has(normalize(key))
}

/**
 * Validates one object level against an allowlist.
 *
 * Reports unknown keys before forbidden ones so the caller learns the real
 * rule: unknown keys are rejected regardless of whether they look personal.
 */
export function checkAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): PiiViolation[] {
  const violations: PiiViolation[] = []
  const allowedSet = new Set(allowed)

  for (const key of Object.keys(value)) {
    const keyPath = path ? `${path}.${key}` : key

    if (!allowedSet.has(key)) {
      violations.push(
        isForbiddenKey(key)
          ? { kind: "forbidden_key", path: keyPath }
          : { kind: "unknown_key", path: keyPath },
      )
    }
  }

  return violations
}

/**
 * Rejects nested objects and arrays in leaf positions.
 *
 * Arbitrary JSON is the usual way personal data reaches an analytics endpoint,
 * so leaves must be primitives.
 */
export function checkPrimitiveLeaves(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): PiiViolation[] {
  const violations: PiiViolation[] = []

  for (const key of keys) {
    const leaf = value[key]

    if (leaf === undefined || leaf === null) {
      continue
    }

    if (typeof leaf === "object") {
      violations.push({
        kind: "non_primitive",
        path: path ? `${path}.${key}` : key,
      })
    }
  }

  return violations
}
