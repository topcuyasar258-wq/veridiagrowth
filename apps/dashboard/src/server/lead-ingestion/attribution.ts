import { classifySourceCategory } from "@veridia/shared"

import type { LeadRequestBody } from "./schema"

// Source classification lives in @veridia/shared so Phase 1 leads and Phase 2
// interaction events cannot drift apart. Re-exported here to keep existing
// import sites working.
export { classifySourceCategory }
export type { SourceCategory } from "@veridia/shared"

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
