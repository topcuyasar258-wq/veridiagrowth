import { describe, expect, it } from "vitest"

import {
  ATTRIBUTION_WINDOW_DAYS,
  applyTouch,
  isDirectOrUnknown,
  isWithinWindow,
  resolveSourceCategory,
  type AttributionState,
  type AttributionTouch,
} from "@veridia/shared"

const NOW = new Date("2026-08-09T12:00:00.000Z")

function touch(overrides: Partial<AttributionTouch> = {}): AttributionTouch {
  return {
    source: "google",
    medium: "cpc",
    campaign: "spring",
    referrerHost: null,
    occurredAt: NOW.toISOString(),
    ...overrides,
  }
}

const empty: AttributionState = { firstTouch: null, lastTouch: null }

describe("attribution window", () => {
  it("is 30 days", () => {
    expect(ATTRIBUTION_WINDOW_DAYS).toBe(30)
  })

  it("accepts a touch inside the window and rejects one outside", () => {
    expect(
      isWithinWindow(touch({ occurredAt: "2026-07-25T12:00:00.000Z" }), NOW),
    ).toBe(true)
    expect(
      isWithinWindow(touch({ occurredAt: "2026-06-01T12:00:00.000Z" }), NOW),
    ).toBe(false)
  })

  it("treats an unparseable timestamp as outside the window", () => {
    expect(isWithinWindow(touch({ occurredAt: "nonsense" }), NOW)).toBe(false)
  })
})

describe("applyTouch", () => {
  it("seeds both touches from empty state", () => {
    const state = applyTouch(empty, touch(), NOW)
    expect(state.firstTouch?.source).toBe("google")
    expect(state.lastTouch?.source).toBe("google")
  })

  it("keeps the first non-direct touch immutable", () => {
    const first = applyTouch(empty, touch({ campaign: "first" }), NOW)
    const second = applyTouch(
      first,
      touch({ source: "facebook", medium: "paid_social", campaign: "second" }),
      NOW,
    )

    expect(second.firstTouch?.campaign).toBe("first")
    expect(second.lastTouch?.campaign).toBe("second")
  })

  it("updates last touch on each new valid source", () => {
    let state = applyTouch(empty, touch({ campaign: "a" }), NOW)
    state = applyTouch(state, touch({ campaign: "b" }), NOW)
    state = applyTouch(state, touch({ campaign: "c" }), NOW)

    expect(state.firstTouch?.campaign).toBe("a")
    expect(state.lastTouch?.campaign).toBe("c")
  })

  it("does not let a direct touch overwrite an existing source", () => {
    const paid = applyTouch(empty, touch({ campaign: "paid" }), NOW)
    const direct = applyTouch(
      paid,
      touch({ source: null, medium: null, campaign: null, referrerHost: null }),
      NOW,
    )

    expect(direct.firstTouch?.campaign).toBe("paid")
    expect(direct.lastTouch?.campaign).toBe("paid")
  })

  it("seeds state from a direct touch when nothing exists yet", () => {
    const direct = applyTouch(
      empty,
      touch({ source: null, medium: null, campaign: null }),
      NOW,
    )
    expect(direct.firstTouch).not.toBeNull()
    expect(resolveSourceCategory(direct)).toBe("unknown")
  })

  it("drops expired state rather than mixing windows", () => {
    const stale: AttributionState = {
      firstTouch: touch({
        occurredAt: "2026-05-01T00:00:00.000Z",
        campaign: "old",
      }),
      lastTouch: touch({
        occurredAt: "2026-05-02T00:00:00.000Z",
        campaign: "old",
      }),
    }

    const fresh = applyTouch(stale, touch({ campaign: "new" }), NOW)
    expect(fresh.firstTouch?.campaign).toBe("new")
    expect(fresh.lastTouch?.campaign).toBe("new")
  })

  it("does not mutate the input state", () => {
    const state = applyTouch(empty, touch({ campaign: "a" }), NOW)
    const snapshot = JSON.stringify(state)
    applyTouch(state, touch({ campaign: "b" }), NOW)
    expect(JSON.stringify(state)).toBe(snapshot)
  })
})

describe("isDirectOrUnknown", () => {
  it("recognises signal-free touches", () => {
    expect(isDirectOrUnknown(touch({ source: null, medium: null }))).toBe(true)
    expect(isDirectOrUnknown(touch({ source: "direct", medium: null }))).toBe(
      true,
    )
    expect(isDirectOrUnknown(touch())).toBe(false)
  })
})

describe("resolveSourceCategory", () => {
  it("prefers last touch", () => {
    const state: AttributionState = {
      firstTouch: touch({ source: "google", medium: "organic" }),
      lastTouch: touch({ source: "facebook", medium: "paid_social" }),
    }
    expect(resolveSourceCategory(state)).toBe("paid_social")
  })

  it("falls back to first touch, then unknown", () => {
    expect(
      resolveSourceCategory({ firstTouch: touch(), lastTouch: null }),
    ).toBe("paid_search")
    expect(resolveSourceCategory(empty)).toBe("unknown")
  })
})
