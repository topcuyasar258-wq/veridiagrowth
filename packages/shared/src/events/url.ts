/**
 * URL sanitization for anonymous interaction events.
 *
 * Full URLs are never stored. A customer page can carry personal data in its
 * query string (`?email=`, `?phone=`, `?token=`) or in a WhatsApp/tel target,
 * so a URL is reduced to host + path and the five UTM parameters are read out
 * separately. Everything else is discarded.
 */

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const

export type UtmKey = (typeof UTM_KEYS)[number]

export const MAX_HOST_LENGTH = 253
export const MAX_PATH_LENGTH = 512
export const MAX_UTM_LENGTH = 128

export interface SanitizedPage {
  host: string | null
  path: string | null
}

export interface SanitizedUrl extends SanitizedPage {
  utm: Record<UtmKey, string | null>
}

/**
 * Reduces a URL to host + path. Returns nulls for anything unparseable rather
 * than throwing: a malformed page URL must never break the caller.
 */
export function sanitizePageUrl(
  value: string | null | undefined,
): SanitizedPage {
  const parsed = safeParse(value)

  if (!parsed) {
    return { host: null, path: null }
  }

  return {
    host: truncate(parsed.hostname.toLowerCase(), MAX_HOST_LENGTH),
    // `pathname` excludes both query string and fragment by construction.
    path: truncate(parsed.pathname || "/", MAX_PATH_LENGTH),
  }
}

/**
 * Referrers are reduced to a host. The path of a referring page is not needed
 * for attribution and can itself leak personal data.
 */
export function sanitizeReferrer(
  value: string | null | undefined,
): string | null {
  const parsed = safeParse(value)

  if (parsed) {
    return truncate(parsed.hostname.toLowerCase(), MAX_HOST_LENGTH)
  }

  const trimmed = value?.trim().toLowerCase() ?? ""
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed)
    ? truncate(trimmed, MAX_HOST_LENGTH)
    : null
}

/** Reads only the five UTM parameters; every other query parameter is dropped. */
export function extractUtm(
  value: string | null | undefined,
): Record<UtmKey, string | null> {
  const parsed = safeParse(value)
  const result = {} as Record<UtmKey, string | null>

  for (const key of UTM_KEYS) {
    const raw = parsed?.searchParams.get(key) ?? null
    result[key] = raw ? truncate(raw.trim(), MAX_UTM_LENGTH) || null : null
  }

  return result
}

export function sanitizeUrl(value: string | null | undefined): SanitizedUrl {
  return { ...sanitizePageUrl(value), utm: extractUtm(value) }
}

/**
 * Only http(s) is accepted. `whatsapp:`, `tel:`, `mailto:` and `javascript:`
 * targets carry the very identifiers this module exists to keep out, so they
 * are rejected outright rather than parsed.
 */
function safeParse(value: string | null | undefined): URL | null {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}
