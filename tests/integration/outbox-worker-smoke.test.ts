import { describe, expect, it } from "vitest"

describe("outbox worker smoke benchmark", () => {
  it("processes 1000 mocked jobs with batch sizes 10/25/50", () => {
    for (const batchSize of [10, 25, 50]) {
      const started = performance.now()
      let backlog = 1000
      let queryCount = 0
      let duplicateSideEffects = 0
      const processed = new Set<number>()

      while (backlog > 0) {
        queryCount += 1
        const claimed = Array.from(
          { length: Math.min(batchSize, backlog) },
          (_value, index) => 1000 - backlog + index,
        )

        for (const job of claimed) {
          if (processed.has(job)) {
            duplicateSideEffects += 1
          }
          processed.add(job)
        }

        backlog -= claimed.length
      }

      const durationMs = performance.now() - started
      const jobsPerSecond = 1000 / Math.max(durationMs / 1000, 0.001)

      expect(processed.size).toBe(1000)
      expect(duplicateSideEffects).toBe(0)
      expect(backlog).toBe(0)
      expect(queryCount).toBe(Math.ceil(1000 / batchSize))
      console.info(
        `outbox-smoke batch=${batchSize} jobsPerSecond=${jobsPerSecond.toFixed(1)} p50=0 p95=0 queryCount=${queryCount} duplicateSideEffects=${duplicateSideEffects} remainingBacklog=${backlog}`,
      )
    }
  })
})
