// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { VeridiaTracker } from "../../packages/tracker/src/index"

/**
 * Tracker performance regression smoke.
 *
 * Not the Slice 4 Core Web Vitals measurement: happy-dom does not lay out or
 * paint, so this cannot produce an LCP or INP number. What it can prove is that
 * the tracker does no work proportional to page size -- no DOM scan at startup,
 * no per-link listener, no observer -- which is the property that would show up
 * as a regression on a real page.
 */

const SITE_KEY = "vtk_abcdef0123456789abcdef0123456789"
const COLLECTOR = "https://collector.veridia.test/api/v1/collect"

const noNetwork: typeof fetch = () => {
  throw new Error("test attempted a real network call")
}

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    read: (k: string) => map.get(k) ?? null,
    write: (k: string, v: string) => {
      map.set(k, v)
    },
    remove: (k: string) => {
      map.delete(k)
    },
    persistent: false,
  }
}

function buildPage(linkCount: number) {
  const parts: string[] = []
  for (let index = 0; index < linkCount; index += 1) {
    parts.push(`<a href="https://example.com/p/${index}">link ${index}</a>`)
  }
  parts.push('<a id="wa" href="https://wa.me/905551112233">WhatsApp</a>')
  document.body.innerHTML = parts.join("")
}

function start() {
  return VeridiaTracker.init({
    siteKey: SITE_KEY,
    collectorUrl: COLLECTOR,
    storage: memoryStorage(),
    sendBeaconImpl: () => true,
    fetchImpl: noNetwork,
  })
}

let tracker: { destroy(): void } | null = null

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__veridiaTracker__
})

afterEach(() => {
  tracker?.destroy()
  tracker = null
  delete (globalThis as Record<string, unknown>).__veridiaTracker__
})

function timeInit(linkCount: number): number {
  buildPage(linkCount)
  const started = performance.now()
  tracker = start()
  const elapsed = performance.now() - started
  tracker?.destroy()
  tracker = null
  delete (globalThis as Record<string, unknown>).__veridiaTracker__
  return elapsed
}

describe("tracker performance smoke", () => {
  it("initializes in constant time regardless of page size", () => {
    // Warm up so JIT effects do not dominate the comparison.
    timeInit(50)

    const small = timeInit(50)
    const large = timeInit(5000)

    console.info(
      `tracker-init 50 links=${small.toFixed(3)}ms 5000 links=${large.toFixed(3)}ms`,
    )

    // A per-link listener or a startup DOM scan would make the 100x page
    // dramatically slower. Generous bound: this asserts the absence of an
    // O(n) startup path, not a precise timing.
    expect(large).toBeLessThan(Math.max(small * 10, 25))
  })

  it("attaches a bounded number of listeners", () => {
    buildPage(500)

    const added: string[] = []
    const originalAdd = document.addEventListener.bind(document)
    document.addEventListener = ((type: string, ...rest: unknown[]) => {
      added.push(type)
      return (originalAdd as unknown as (...a: unknown[]) => void)(
        type,
        ...rest,
      )
    }) as typeof document.addEventListener

    tracker = start()
    document.addEventListener = originalAdd

    // One click listener plus one focus listener, whatever the page contains.
    expect(added).toEqual(["click", "focusin"])
  })

  it("handles a click without measurable work", () => {
    buildPage(2000)
    tracker = start()

    const started = performance.now()
    document
      .getElementById("wa")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    const elapsed = performance.now() - started

    console.info(`tracker-click elapsed=${elapsed.toFixed(3)}ms`)
    expect(elapsed).toBeLessThan(25)
  })
})
