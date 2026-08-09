/**
 * Attribution contract shared by the tracker, the collector and Phase 1 lead
 * ingestion.
 *
 * Rules (identical to Phase 1 so a lead and the interactions that preceded it
 * attribute the same way):
 *   - 30 day window
 *   - the first valid non-direct touch is immutable
 *   - a later valid non-direct touch updates last touch
 *   - a direct touch never overwrites an existing non-direct source
 */

import {
  classifySourceCategory,
  type SourceCategory,
} from "../attribution/source-classification"

export const ATTRIBUTION_WINDOW_DAYS = 30
export const ATTRIBUTION_WINDOW_MS =
  ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000

export interface AttributionTouch {
  source: string | null
  medium: string | null
  campaign: string | null
  term?: string | null
  content?: string | null
  referrerHost: string | null
  occurredAt: string
}

export interface AttributionState {
  firstTouch: AttributionTouch | null
  lastTouch: AttributionTouch | null
}

export function touchCategory(touch: AttributionTouch): SourceCategory {
  return classifySourceCategory({
    utmSource: touch.source,
    utmMedium: touch.medium,
    referrer: touch.referrerHost,
  })
}

/** A touch that carries no usable signal must not displace a real one. */
export function isDirectOrUnknown(touch: AttributionTouch): boolean {
  const category = touchCategory(touch)
  return category === "direct" || category === "unknown"
}

export function isWithinWindow(
  touch: AttributionTouch,
  now: Date = new Date(),
): boolean {
  const touchedAt = Date.parse(touch.occurredAt)

  if (Number.isNaN(touchedAt)) {
    return false
  }

  return now.getTime() - touchedAt <= ATTRIBUTION_WINDOW_MS
}

/**
 * Folds a new touch into existing state.
 *
 * Returns a new object; the caller's state is never mutated so this stays safe
 * to use from both the browser and the server.
 */
export function applyTouch(
  state: AttributionState,
  touch: AttributionTouch,
  now: Date = new Date(),
): AttributionState {
  // Expired state is dropped entirely rather than partially kept, so first and
  // last touch can never come from different windows.
  const firstTouch =
    state.firstTouch && isWithinWindow(state.firstTouch, now)
      ? state.firstTouch
      : null
  const lastTouch =
    state.lastTouch && isWithinWindow(state.lastTouch, now)
      ? state.lastTouch
      : null

  if (isDirectOrUnknown(touch)) {
    // Direct never overwrites a real source, but it does seed empty state.
    if (!firstTouch && !lastTouch) {
      return { firstTouch: touch, lastTouch: touch }
    }

    return { firstTouch, lastTouch }
  }

  return {
    firstTouch:
      firstTouch && !isDirectOrUnknown(firstTouch) ? firstTouch : touch,
    lastTouch: touch,
  }
}

/** The category an event is stored with: last touch wins, first touch backs it. */
export function resolveSourceCategory(state: AttributionState): SourceCategory {
  const effective = state.lastTouch ?? state.firstTouch

  if (!effective) {
    return "unknown"
  }

  return touchCategory(effective)
}
