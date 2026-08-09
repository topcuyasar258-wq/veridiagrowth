import { describe, expect, it } from "vitest"

import {
  evaluateInteractionRisk,
  type RiskInput,
} from "../../apps/dashboard/src/server/interaction-collector/risk"
import { evaluateOrigin } from "../../apps/dashboard/src/server/interaction-collector/origin"
import { validateInteractionBatch } from "@veridia/shared"

/**
 * Controlled 1000 event smoke.
 *
 * This is not the Slice 4 load test: no real database, no concurrency, no
 * production-like traffic shape. It exercises the decision path enough to
 * confirm the mix of outcomes is sane and the scoring is stable, and it reports
 * timings so an obvious regression is visible.
 */

const NOW = new Date("2026-08-09T12:00:00.000Z")
const ALLOWED = ["example.com"]

function eventAt(index: number, overrides: Record<string, unknown> = {}) {
  return {
    eventId: `evt_${String(index).padStart(16, "0")}`,
    eventType: [
      "session_started",
      "whatsapp_clicked",
      "phone_clicked",
      "form_started",
    ][index % 4],
    sessionId: `ses_${String(index % 50).padStart(16, "0")}`,
    occurredAt: "2026-08-09T11:59:30.000Z",
    page: {
      url: "https://example.com/iletisim?utm_source=google&utm_medium=cpc",
    },
    trackerVersion: "0.1.0",
    ...overrides,
  }
}

function riskFor(
  originHeader: string | null,
  elevated: RiskInput["elevatedQuotas"],
) {
  return evaluateInteractionRisk({
    origin: evaluateOrigin({ origin: originHeader, referer: null }, ALLOWED),
    elevatedQuotas: elevated,
    duplicateEventId: false,
    timestamp: "ok",
    sequenceUnexpected: false,
    userAgentPresent: true,
  })
}

describe("collector 1000 event smoke", () => {
  it("produces a stable outcome mix and no errors", () => {
    const TOTAL = 1000
    const durations: number[] = []
    const outcomes = { accepted: 0, suspicious: 0, quarantined: 0, rejected: 0 }
    let errors = 0

    for (let index = 0; index < TOTAL; index += 1) {
      const started = performance.now()

      try {
        // 90% clean, 5% no origin, 5% from an unconfigured origin.
        const bucket = index % 20
        const originHeader =
          bucket === 0
            ? null
            : bucket === 1
              ? "https://evil.com"
              : "https://example.com"

        const batch = validateInteractionBatch(
          { schemaVersion: "2.0", events: [eventAt(index)] },
          { now: NOW },
        )

        if (!batch.ok) {
          errors += 1
          continue
        }

        const risk = riskFor(originHeader, [])
        outcomes[risk.decision] += 1
      } catch {
        errors += 1
      }

      durations.push(performance.now() - started)
    }

    expect(errors).toBe(0)
    expect(
      outcomes.accepted +
        outcomes.suspicious +
        outcomes.quarantined +
        outcomes.rejected,
    ).toBe(TOTAL)

    // 90% clean plus 5% missing-origin (a weak signal only) stay accepted.
    expect(outcomes.accepted).toBe(950)
    // Only the unconfigured-origin slice is held.
    expect(outcomes.quarantined).toBe(50)
    expect(outcomes.rejected).toBe(0)

    durations.sort((left, right) => left - right)
    const p50 = percentile(durations, 0.5)
    const p95 = percentile(durations, 0.95)

    console.info(
      `collector-smoke n=${TOTAL} accepted=${outcomes.accepted} ` +
        `suspicious=${outcomes.suspicious} quarantined=${outcomes.quarantined} ` +
        `rejected=${outcomes.rejected} errors=${errors} ` +
        `p50=${p50.toFixed(4)}ms p95=${p95.toFixed(4)}ms`,
    )

    // Error budget from the spec, checked here at decision-path level.
    expect(errors / TOTAL).toBeLessThan(0.005)
  })

  it("scores identically on a second pass over the same inputs", () => {
    const first = Array.from({ length: 200 }, (_, i) =>
      riskFor(i % 2 === 0 ? "https://example.com" : "https://evil.com", []),
    )
    const second = Array.from({ length: 200 }, (_, i) =>
      riskFor(i % 2 === 0 ? "https://example.com" : "https://evil.com", []),
    )

    expect(first).toEqual(second)
  })
})

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const index = Math.min(values.length - 1, Math.floor(values.length * p))
  return values[index]
}
