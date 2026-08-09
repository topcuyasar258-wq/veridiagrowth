import { expect, test, type Page } from "@playwright/test"

import { startFixtureServer, type FixtureServer } from "./fixture-server"

/**
 * Core Web Vitals smoke.
 *
 * Measures the same page with the tracker loaded and with it absent, and
 * compares. The absolute numbers are meaningless outside this machine; the
 * delta between two runs of the same page in the same browser is what the
 * tracker is responsible for.
 *
 * Several runs and a median, because a single sample on a shared CI runner
 * measures the runner's mood as much as the code.
 */

const RUNS = 5

/** Engineering guards, not a production SLA. */
const BUDGETS = {
  lcpDeltaMs: 100,
  interactionDeltaMs: 20,
  clsDelta: 0.01,
} as const

let server: FixtureServer

test.beforeAll(async () => {
  server = await startFixtureServer()
})

test.afterAll(async () => {
  await server.close()
})

interface Sample {
  lcp: number
  cls: number
  interaction: number
}

async function measure(page: Page, withTracker: boolean): Promise<Sample> {
  server.setTrackerMissing(!withTracker)

  await page.goto(`${server.origin}/`, { waitUntil: "load" })

  // Let LCP settle and, when enabled, the tracker finish initialising.
  await page.waitForTimeout(500)

  const paint = await page.evaluate(
    () =>
      new Promise<{ lcp: number; cls: number }>((resolve) => {
        let lcp = 0
        let cls = 0

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              lcp = Math.max(lcp, entry.startTime)
            }
          }).observe({ type: "largest-contentful-paint", buffered: true })

          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as unknown as {
                value: number
                hadRecentInput: boolean
              }
              if (!shift.hadRecentInput) cls += shift.value
            }
          }).observe({ type: "layout-shift", buffered: true })
        } catch {
          // An unsupported entry type yields zero rather than a failure.
        }

        setTimeout(() => {
          resolve({ lcp, cls })
        }, 300)
      }),
  )

  // Interaction latency: time for a click to be processed and the next frame to
  // be painted. A tracker that did synchronous work in the click path would
  // show up here.
  const interaction = await page.evaluate(async () => {
    const link = document.getElementById("whatsapp")
    if (!link) return 0

    const started = performance.now()
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    )

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })

    return performance.now() - started
  })

  return { lcp: paint.lcp, cls: paint.cls, interaction }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

test("tracker stays inside its performance budget", async ({ page }) => {
  const withoutTracker: Sample[] = []
  const withTracker: Sample[] = []

  // Interleaved rather than grouped, so a machine that gets busy partway
  // through affects both arms equally.
  for (let run = 0; run < RUNS; run += 1) {
    withoutTracker.push(await measure(page, false))
    withTracker.push(await measure(page, true))
  }

  const baseline = {
    lcp: median(withoutTracker.map((s) => s.lcp)),
    cls: median(withoutTracker.map((s) => s.cls)),
    interaction: median(withoutTracker.map((s) => s.interaction)),
  }

  const tracked = {
    lcp: median(withTracker.map((s) => s.lcp)),
    cls: median(withTracker.map((s) => s.cls)),
    interaction: median(withTracker.map((s) => s.interaction)),
  }

  const delta = {
    lcp: tracked.lcp - baseline.lcp,
    cls: tracked.cls - baseline.cls,
    interaction: tracked.interaction - baseline.interaction,
  }

  console.log(
    `cwv runs=${RUNS}\n` +
      `  LCP          baseline=${baseline.lcp.toFixed(1)}ms tracked=${tracked.lcp.toFixed(1)}ms delta=${delta.lcp.toFixed(1)}ms (budget ${BUDGETS.lcpDeltaMs}ms)\n` +
      `  interaction  baseline=${baseline.interaction.toFixed(2)}ms tracked=${tracked.interaction.toFixed(2)}ms delta=${delta.interaction.toFixed(2)}ms (budget ${BUDGETS.interactionDeltaMs}ms)\n` +
      `  CLS          baseline=${baseline.cls.toFixed(4)} tracked=${tracked.cls.toFixed(4)} delta=${delta.cls.toFixed(4)} (budget ${BUDGETS.clsDelta})`,
  )

  // A measurement of zero across every run means the observer produced nothing,
  // which is an unmeasured result rather than a good one.
  expect(
    withTracker.some((sample) => sample.lcp > 0),
    "LCP was never observed; the result is unmeasured, not passing",
  ).toBe(true)

  expect(delta.lcp).toBeLessThanOrEqual(BUDGETS.lcpDeltaMs)
  expect(delta.interaction).toBeLessThanOrEqual(BUDGETS.interactionDeltaMs)
  expect(delta.cls).toBeLessThan(BUDGETS.clsDelta)
})
