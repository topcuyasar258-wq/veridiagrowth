/**
 * Single source-classification engine.
 *
 * Phase 1 lead ingestion and Phase 2 interaction events must agree on what
 * counts as paid, organic, referral or direct traffic. Two engines would drift
 * and produce contradictory numbers for the same visit, so this module is the
 * only implementation; the lead-ingestion path re-exports it.
 *
 * Behaviour is intentionally unchanged from the Phase 1 implementation this
 * replaces. Any change here changes historical comparability and needs a
 * migration note.
 */

export const sourceCategories = [
  "organic",
  "paid_search",
  "paid_social",
  "referral",
  "direct",
  "unknown",
] as const

export type SourceCategory = (typeof sourceCategories)[number]

const paidMediums = new Set([
  "cpc",
  "ppc",
  "paid",
  "paid_search",
  "paid-social",
  "paid_social",
  "display",
])

const paidSocialSources = new Set([
  "facebook",
  "instagram",
  "meta",
  "linkedin",
  "twitter",
  "x",
  "tiktok",
])

const organicSearchHosts = [
  "google.",
  "bing.",
  "yahoo.",
  "yandex.",
  "duckduckgo.",
]

export interface SourceClassificationInput {
  utmSource?: string | null
  utmMedium?: string | null
  referrer?: string | null
}

export function classifySourceCategory(
  input: SourceClassificationInput,
): SourceCategory {
  const medium = input.utmMedium?.trim().toLowerCase()
  const source = input.utmSource?.trim().toLowerCase()
  const referrerHost = parseHost(input.referrer)

  if (medium && paidMediums.has(medium)) {
    return source && paidSocialSources.has(source)
      ? "paid_social"
      : "paid_search"
  }

  if (medium === "organic") {
    return "organic"
  }

  if (
    referrerHost &&
    organicSearchHosts.some((host) => referrerHost.includes(host))
  ) {
    return "organic"
  }

  if (referrerHost) {
    return "referral"
  }

  return medium === "direct" || source === "direct" ? "direct" : "unknown"
}

/**
 * Accepts a bare host as well as a URL, because interaction events carry a
 * referrer host rather than a full referrer URL.
 */
function parseHost(value: string | null | undefined) {
  if (!value) {
    return null
  }

  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    const trimmed = value.trim().toLowerCase()
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed) ? trimmed : null
  }
}
