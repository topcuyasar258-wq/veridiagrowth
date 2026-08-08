import { describe, expect, it } from "vitest"

import { validateLeadRequestBody } from "../../apps/dashboard/src/server/lead-ingestion/schema"
import { buildAttributionPayload } from "../../apps/dashboard/src/server/lead-ingestion/attribution"
import { evaluateSpamSignals } from "../../apps/dashboard/src/server/lead-ingestion/spam"
import { validBody } from "../security/lead-request-schema.test"

describe("lead API smoke benchmark", () => {
  it("processes 100 mocked valid requests and reports median/p95", () => {
    const durations: number[] = []
    let errorCount = 0

    for (let index = 0; index < 100; index += 1) {
      const started = performance.now()
      const body = validBody()
      const parsed = validateLeadRequestBody(body)

      if (!parsed.success) {
        errorCount += 1
        continue
      }

      const spam = evaluateSpamSignals({
        body: parsed.data,
        minCompletionMs: 2000,
      })

      if (!spam.accepted) {
        errorCount += 1
      }

      buildAttributionPayload(parsed.data)
      durations.push(performance.now() - started)
    }

    durations.sort((left, right) => left - right)
    const median = percentile(durations, 0.5)
    const p95 = percentile(durations, 0.95)

    expect(errorCount).toBe(0)
    expect(median).toBeGreaterThanOrEqual(0)
    expect(p95).toBeGreaterThanOrEqual(median)

    console.info(
      `lead-api-smoke median=${median.toFixed(3)}ms p95=${p95.toFixed(3)}ms errors=${errorCount}`,
    )
  })
})

function percentile(values: number[], percentileValue: number) {
  const index = Math.min(
    values.length - 1,
    Math.ceil(values.length * percentileValue) - 1,
  )

  return values[index] ?? 0
}
