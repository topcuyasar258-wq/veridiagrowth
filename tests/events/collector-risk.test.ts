import { describe, expect, it } from "vitest"

import {
  RISK_BANDS,
  RISK_WEIGHTS,
  decisionForScore,
  evaluateInteractionRisk,
  type RiskInput,
} from "../../apps/dashboard/src/server/interaction-collector/risk"

function input(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    origin: { origin: "match", referer: "match" },
    elevatedQuotas: [],
    duplicateEventId: false,
    timestamp: "ok",
    sequenceUnexpected: false,
    userAgentPresent: true,
    ...overrides,
  }
}

describe("decisionForScore", () => {
  it("pins the band boundaries", () => {
    // These exact numbers are the contract; changing one changes what gets
    // filtered from a customer's data.
    expect(decisionForScore(0)).toBe("accepted")
    expect(decisionForScore(29)).toBe("accepted")
    expect(decisionForScore(30)).toBe("suspicious")
    expect(decisionForScore(59)).toBe("suspicious")
    expect(decisionForScore(60)).toBe("quarantined")
    expect(decisionForScore(79)).toBe("quarantined")
    expect(decisionForScore(80)).toBe("rejected")
    expect(decisionForScore(100)).toBe("rejected")
  })

  it("matches the exported band constants", () => {
    expect(decisionForScore(RISK_BANDS.acceptedMax)).toBe("accepted")
    expect(decisionForScore(RISK_BANDS.acceptedMax + 1)).toBe("suspicious")
    expect(decisionForScore(RISK_BANDS.suspiciousMax)).toBe("suspicious")
    expect(decisionForScore(RISK_BANDS.suspiciousMax + 1)).toBe("quarantined")
    expect(decisionForScore(RISK_BANDS.quarantineMax)).toBe("quarantined")
    expect(decisionForScore(RISK_BANDS.quarantineMax + 1)).toBe("rejected")
  })
})

describe("evaluateInteractionRisk", () => {
  it("accepts a clean event with no signals", () => {
    const result = evaluateInteractionRisk(input())
    expect(result.score).toBe(0)
    expect(result.decision).toBe("accepted")
    expect(result.reasonCodes).toEqual([])
  })

  it("is deterministic", () => {
    const a = evaluateInteractionRisk(input({ timestamp: "future" }))
    const b = evaluateInteractionRisk(input({ timestamp: "future" }))
    expect(a).toEqual(b)
  })

  it("quarantines an origin mismatch on its own", () => {
    const result = evaluateInteractionRisk(
      input({ origin: { origin: "mismatch", referer: "mismatch" } }),
    )
    expect(result.decision).toBe("quarantined")
    expect(result.reasonCodes).toContain("origin_mismatch")
  })

  it("does not count a referer mismatch twice when the origin already mismatched", () => {
    const result = evaluateInteractionRisk(
      input({ origin: { origin: "mismatch", referer: "mismatch" } }),
    )
    expect(result.reasonCodes).not.toContain("referer_mismatch")
    expect(result.score).toBe(RISK_WEIGHTS.origin_mismatch)
  })

  it("counts a referer mismatch when the origin matched", () => {
    const result = evaluateInteractionRisk(
      input({ origin: { origin: "match", referer: "mismatch" } }),
    )
    expect(result.reasonCodes).toEqual(["referer_mismatch"])
    expect(result.decision).toBe("accepted")
  })

  it("keeps a missing origin below the suspicious band on its own", () => {
    // A real visitor must never be filtered for one weak signal.
    const result = evaluateInteractionRisk(
      input({ origin: { origin: "missing", referer: "missing" } }),
    )
    expect(result.decision).toBe("accepted")
  })

  it("keeps any single rate signal below the suspicious band", () => {
    for (const scope of ["site", "site_ip", "session", "event_type"] as const) {
      const result = evaluateInteractionRisk(input({ elevatedQuotas: [scope] }))
      expect(result.decision).toBe("accepted")
    }
  })

  it("escalates when rate signals accumulate", () => {
    const result = evaluateInteractionRisk(
      input({ elevatedQuotas: ["site", "site_ip", "session"] }),
    )
    expect(result.score).toBe(
      RISK_WEIGHTS.site_rate_elevated +
        RISK_WEIGHTS.site_ip_rate_elevated +
        RISK_WEIGHTS.session_rate_elevated,
    )
    expect(result.decision).toBe("quarantined")
  })

  it("treats a duplicate event id as almost harmless", () => {
    // Duplicate delivery is normal sendBeacon behaviour, not abuse.
    const result = evaluateInteractionRisk(input({ duplicateEventId: true }))
    expect(result.decision).toBe("accepted")
  })

  it("treats an unexpected sequence as a weak signal only", () => {
    const result = evaluateInteractionRisk(input({ sequenceUnexpected: true }))
    expect(result.decision).toBe("accepted")
  })

  it("clamps the score to 100", () => {
    const result = evaluateInteractionRisk(
      input({
        origin: { origin: "mismatch", referer: "mismatch" },
        elevatedQuotas: ["site", "site_ip", "session", "event_type"],
        duplicateEventId: true,
        timestamp: "future",
        sequenceUnexpected: true,
        userAgentPresent: false,
      }),
    )
    expect(result.score).toBe(100)
    expect(result.decision).toBe("rejected")
  })

  it("orders reason codes by weight so the primary cause is first", () => {
    const result = evaluateInteractionRisk(
      input({
        origin: { origin: "mismatch", referer: "match" },
        elevatedQuotas: ["site"],
      }),
    )
    expect(result.reasonCodes[0]).toBe("origin_mismatch")
  })

  it("never produces a reason code without a weight", () => {
    const result = evaluateInteractionRisk(
      input({
        origin: { origin: "invalid", referer: "mismatch" },
        elevatedQuotas: ["site", "site_ip", "session", "event_type"],
        duplicateEventId: true,
        timestamp: "stale",
        sequenceUnexpected: true,
        userAgentPresent: false,
      }),
    )

    for (const code of result.reasonCodes) {
      expect(RISK_WEIGHTS[code]).toBeTypeOf("number")
    }
  })
})
