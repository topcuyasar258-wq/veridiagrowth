// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { validateInteractionBatch } from "@veridia/shared"

import { AttributionManager } from "../../packages/tracker/src/attribution"
import { VeridiaTracker } from "../../packages/tracker/src/index"
import { readClickIds } from "../../packages/tracker/src/sanitize"
import {
  VisitorManager,
  visitorStorageKey,
} from "../../packages/tracker/src/visitor"

/**
 * Marketing identity is the first thing this tracker stores that can outlive a
 * visit, so the tests that matter are the ones proving it does not exist
 * without consent, and stops existing the moment consent is withdrawn.
 *
 * The `gclid` below doubles as a sentinel: without marketing consent it sits in
 * the page URL and must never reach the wire, exactly like the PII sentinels in
 * dom-behaviour.test.ts.
 */

const SITE_KEY = "vtk_abcdef0123456789abcdef0123456789"
const OTHER_SITE_KEY = "vtk_99998888777766665555444433332222"
const COLLECTOR = "https://collector.veridia.test/api/v1/collect"
const PAGE_ORIGIN = "http://localhost:3000"
const GCLID = "EAIaIQobChMI-test-click-id"

let captured: BodyInit[] = []

function captureBeacon(_url: string, data: BodyInit): boolean {
  captured.push(data)
  return true
}

async function capturedEvents() {
  const texts = await Promise.all(
    captured.map(async (entry) =>
      typeof entry === "string" ? entry : await (entry as Blob).text(),
    ),
  )

  return texts.map((text) => JSON.parse(text).events[0])
}

const noNetwork: typeof fetch = () =>
  Promise.reject(new Error("network disabled in tests"))

function storageFactory(persistent = true) {
  const map = new Map<string, string>()
  return {
    map,
    storage: {
      read: (k: string) => map.get(k) ?? null,
      write: (k: string, v: string) => {
        map.set(k, v)
      },
      remove: (k: string) => {
        map.delete(k)
      },
      persistent,
    },
  }
}

function navigateTo(url: string) {
  const happy = (
    window as unknown as { happyDOM?: { setURL?: (url: string) => void } }
  ).happyDOM

  if (happy?.setURL) {
    happy.setURL(url)
    return
  }

  window.history.replaceState({}, "", url)
}

let tracker: { destroy(): void } | null = null
let store = storageFactory()

beforeEach(() => {
  captured = []
  store = storageFactory()
  document.body.innerHTML = `<a id="wa" href="https://wa.me/905551234567">WhatsApp</a>`
  navigateTo(`${PAGE_ORIGIN}/iletisim?gclid=${GCLID}&utm_source=google`)
})

afterEach(() => {
  tracker?.destroy()
  tracker = null
})

function start(overrides: Record<string, unknown> = {}) {
  return VeridiaTracker.init({
    siteKey: SITE_KEY,
    collectorUrl: COLLECTOR,
    trackerVersion: "0.1.0",
    storage: store.storage,
    fetchImpl: noNetwork,
    sendBeaconImpl: captureBeacon,
    ...overrides,
  })
}

describe("marketing consent gate", () => {
  it("sends no identity and no click id when consent is not configured", async () => {
    tracker = start()

    const [event] = await capturedEvents()

    expect(event.visitorId).toBeNull()
    expect(event.clickIds).toEqual({
      gclid: null,
      gbraid: null,
      wbraid: null,
      fbclid: null,
    })
  })

  it("keeps the gclid in the page out of the payload entirely", async () => {
    tracker = start({ marketingConsent: () => false })

    const texts = await Promise.all(
      captured.map(async (entry) =>
        typeof entry === "string" ? entry : await (entry as Blob).text(),
      ),
    )

    expect(texts).not.toHaveLength(0)
    for (const text of texts) {
      expect(text).not.toContain(GCLID)
    }
  })

  it("carries visitor id and click id once consent is given", async () => {
    tracker = start({ marketingConsent: () => true })

    const [event] = await capturedEvents()

    expect(event.visitorId).toMatch(/^vis_[A-Za-z0-9_-]+$/)
    expect(event.clickIds.gclid).toBe(GCLID)
    expect(event.clickIds.fbclid).toBeNull()
  })

  it("reuses one identity across events in a visit", async () => {
    tracker = start({ marketingConsent: () => true })
    document.getElementById("wa")?.click()

    const events = await capturedEvents()

    expect(events.length).toBeGreaterThan(1)
    expect(new Set(events.map((e) => e.visitorId)).size).toBe(1)
  })

  // The important direction: consent can be revoked mid-visit, and the next
  // event must reflect that without waiting for a page load.
  it("stops sending identity the moment consent is withdrawn", async () => {
    let consented = true
    tracker = start({ marketingConsent: () => consented })

    consented = false
    document.getElementById("wa")?.click()

    const events = await capturedEvents()
    const last = events[events.length - 1]

    expect(events[0].visitorId).not.toBeNull()
    expect(last.visitorId).toBeNull()
    expect(last.clickIds.gclid).toBeNull()
  })

  it("erases the stored identity on withdrawal rather than hiding it", async () => {
    let consented = true
    tracker = start({ marketingConsent: () => consented })

    expect(store.map.get(visitorStorageKey(SITE_KEY))).toBeDefined()

    consented = false
    document.getElementById("wa")?.click()

    expect(store.map.get(visitorStorageKey(SITE_KEY))).toBeUndefined()
  })

  it("treats a throwing consent callback as a refusal", async () => {
    tracker = start({
      marketingConsent: () => {
        throw new Error("consent provider unavailable")
      },
    })

    const [event] = await capturedEvents()

    expect(event.visitorId).toBeNull()
    expect(event.clickIds.gclid).toBeNull()
  })

  it("produces a payload the collector contract accepts", async () => {
    tracker = start({ marketingConsent: () => true })

    const texts = await Promise.all(
      captured.map(async (entry) =>
        typeof entry === "string" ? entry : await (entry as Blob).text(),
      ),
    )

    for (const text of texts) {
      const parsed = JSON.parse(text)
      const result = validateInteractionBatch(
        { schemaVersion: parsed.schemaVersion, events: parsed.events },
        { now: new Date() },
      )

      expect(result.ok).toBe(true)
    }
  })
})

describe("visitor identity scope", () => {
  it("keys storage per site so one origin cannot merge two sites", () => {
    expect(visitorStorageKey(SITE_KEY)).not.toBe(
      visitorStorageKey(OTHER_SITE_KEY),
    )
  })

  it("gives two sites different identities in the same storage", () => {
    const shared = storageFactory().storage
    const a = new VisitorManager({ storage: shared, siteKey: SITE_KEY })
    const b = new VisitorManager({ storage: shared, siteKey: OTHER_SITE_KEY })

    expect(a.ensure()).not.toBe(b.ensure())
  })

  // A fresh id on every page load would look like a stream of one-visit
  // strangers and quietly corrupt any audience built from it.
  it("mints no identity when storage cannot persist one", () => {
    const volatile = storageFactory(false).storage
    const manager = new VisitorManager({ storage: volatile, siteKey: SITE_KEY })

    expect(manager.ensure()).toBeNull()
  })

  it("starts a new identity after one is cleared", () => {
    const { storage } = storageFactory()
    const manager = new VisitorManager({ storage, siteKey: SITE_KEY })

    const first = manager.ensure()
    manager.clear()

    expect(manager.peek()).toBeNull()
    expect(manager.ensure()).not.toBe(first)
  })
})

describe("click id capture", () => {
  it("reads every supported click id and nothing else", () => {
    const ids = readClickIds(
      "https://x.test/?gclid=a&gbraid=b&wbraid=c&fbclid=d&email=leak@example.com",
    )

    expect(ids).toEqual({ gclid: "a", gbraid: "b", wbraid: "c", fbclid: "d" })
  })

  it("survives navigation to a page carrying no click id", () => {
    const { storage } = storageFactory()
    const manager = new AttributionManager({ storage })

    manager.observe("https://x.test/landing?gclid=abc", "", {
      captureClickIds: true,
    })
    manager.observe("https://x.test/iletisim", "", { captureClickIds: true })

    expect(manager.currentClickIds().gclid).toBe("abc")
  })

  it("stores nothing when capture is not requested", () => {
    const { storage } = storageFactory()
    const manager = new AttributionManager({ storage })

    manager.observe("https://x.test/landing?gclid=abc", "", {
      captureClickIds: false,
    })

    expect(manager.currentClickIds()).toEqual({})
  })

  it("keeps ordinary attribution when click ids are cleared", () => {
    const { storage } = storageFactory()
    const manager = new AttributionManager({ storage })

    manager.observe("https://x.test/?utm_source=google&gclid=abc", "", {
      captureClickIds: true,
    })
    manager.clearClickIds()

    expect(manager.currentClickIds()).toEqual({})
    expect(manager.currentUtm().utm_source).toBe("google")
  })
})
