import type { LeadRequestBody } from "./schema"

export type SourceCategory =
  "organic" | "paid_search" | "paid_social" | "referral" | "direct" | "unknown"

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

export function classifySourceCategory(input: {
  utmSource?: string | null
  utmMedium?: string | null
  referrer?: string | null
}): SourceCategory {
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

export function buildAttributionPayload(body: LeadRequestBody) {
  const lastTouch = body.attribution.lastTouch ?? null
  const sourceCategory = classifySourceCategory({
    utmSource: body.attribution.utmSource ?? lastTouch?.source,
    utmMedium: body.attribution.utmMedium ?? lastTouch?.medium,
    referrer: body.attribution.referrer ?? lastTouch?.referrer,
  })

  return {
    ...body.attribution,
    firstTouch: normalizeTouch(body.attribution.firstTouch),
    lastTouch: normalizeTouch(lastTouch),
    sourceCategory,
  }
}

function normalizeTouch(
  touch: LeadRequestBody["attribution"]["firstTouch"] | null | undefined,
) {
  if (!touch) {
    return null
  }

  return {
    source: touch.source ?? null,
    medium: touch.medium ?? null,
    campaign: touch.campaign ?? null,
    referrer: touch.referrer ?? null,
    occurredAt: touch.occurredAt ?? null,
  }
}

function parseHost(url: string | null | undefined) {
  if (!url) {
    return null
  }

  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}
