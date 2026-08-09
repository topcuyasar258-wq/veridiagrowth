// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { validateInteractionBatch } from "@veridia/shared"

import { VeridiaTracker } from "../../packages/tracker/src/index"

/**
 * Tracker behaviour in a real DOM.
 *
 * Two things are proven here that cannot be proven by unit tests:
 *
 * 1. Nothing personal on the page reaches the wire. The fixture contains real
 *    sentinel values -- an email, a phone number, a message body, a WhatsApp
 *    number, a tel target and query parameters -- and every captured request
 *    body is asserted against all of them.
 *
 * 2. The customer's page keeps working. Clicks are never cancelled, so a
 *    WhatsApp or phone link navigates whether or not the collector responds.
 */

const PII_EMAIL = "phase2-secret@example.com"
const PII_PHONE = "+905551234567"
const PII_PHONE_DIGITS = "905551234567"
const PII_MESSAGE = "PRIVATE_MESSAGE_123"
const SITE_KEY = "vtk_abcdef0123456789abcdef0123456789"
const COLLECTOR = "https://collector.veridia.test/api/v1/collect"
const PAGE_ORIGIN = "http://localhost:3000"

/** Every sentinel that must never appear in a request body. */
const SENTINELS = [
  PII_EMAIL,
  PII_PHONE,
  PII_PHONE_DIGITS,
  PII_MESSAGE,
  "wa.me/905551234567",
  "tel:+905551234567",
  "secret-token-abc",
]

let captured: BodyInit[] = []

/**
 * Captures the exact bytes the transport hands to sendBeacon.
 *
 * The transport sends a Blob so the beacon carries a content type. Decoding it
 * rather than stringifying the object matters: an earlier version of this test
 * recorded "[non-string]" and every PII assertion passed without ever
 * inspecting a payload.
 */
function captureBeacon(_url: string, data: BodyInit): boolean {
  captured.push(data)
  return true
}

async function capturedText(): Promise<string[]> {
  return Promise.all(
    captured.map(async (entry) =>
      typeof entry === "string" ? entry : await (entry as Blob).text(),
    ),
  )
}

/** Stands in for the network. Rejects like an unreachable collector would. */
const noNetwork: typeof fetch = () =>
  Promise.reject(new Error("network disabled in tests"))

function fixture() {
  document.body.innerHTML = `
    <a id="wa" href="https://wa.me/${PII_PHONE_DIGITS}?text=${encodeURIComponent(PII_MESSAGE)}">
      <span id="wa-child">WhatsApp</span>
    </a>
    <a id="wa-api" href="https://api.whatsapp.com/send?phone=${PII_PHONE_DIGITS}">API</a>
    <a id="wa-scheme" href="whatsapp://send?phone=${PII_PHONE_DIGITS}">Scheme</a>
    <a id="wa-explicit" href="/contact" data-veridia-track="whatsapp">Explicit</a>
    <a id="tel" href="tel:${PII_PHONE}">Call</a>
    <a id="tel-explicit" href="/x" data-veridia-track="phone">Explicit phone</a>
    <a id="plain" href="/about">About</a>

    <form id="marked" data-veridia-form="contact">
      <input id="marked-email" type="email" value="${PII_EMAIL}" />
      <input id="marked-phone" type="tel" value="${PII_PHONE}" />
      <textarea id="marked-message">${PII_MESSAGE}</textarea>
    </form>

    <form id="unmarked">
      <input id="unmarked-email" type="email" value="${PII_EMAIL}" />
    </form>

    <form id="login" data-veridia-form="login">
      <input id="login-user" type="email" value="${PII_EMAIL}" />
      <input id="login-pass" type="password" value="hunter2" />
    </form>
  `
}

/** Fresh per test, so one test's session never leaks into the next. */
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

let storage = memoryStorage()

function start(overrides: Record<string, unknown> = {}) {
  return VeridiaTracker.init({
    storage,
    siteKey: SITE_KEY,
    collectorUrl: COLLECTOR,
    trackerVersion: "0.1.0",
    integrationVersion: "1.0.0",
    sendBeaconImpl: captureBeacon,
    fetchImpl: noNetwork,
    ...overrides,
  })
}

async function bodies() {
  const texts = await capturedText()
  return texts.map((raw) => JSON.parse(raw) as Record<string, unknown>)
}

async function eventTypes() {
  const parsed = await bodies()
  return parsed.flatMap((body) =>
    (body.events as { eventType: string }[]).map((e) => e.eventType),
  )
}

function clickOn(id: string) {
  const element = document.getElementById(id)
  const event = new MouseEvent("click", { bubbles: true, cancelable: true })
  element?.dispatchEvent(event)
  return event
}

function focusOn(id: string) {
  const element = document.getElementById(id)
  element?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
}

function resetLocation() {
  const target = `${PAGE_ORIGIN}/iletisim?email=${PII_EMAIL}&token=secret-token-abc`
  const happy = (
    window as unknown as {
      happyDOM?: { setURL?: (url: string) => void }
    }
  ).happyDOM

  if (happy?.setURL) {
    happy.setURL(target)
    return
  }

  window.history.replaceState({}, "", target)
}

let tracker: { destroy(): void } | null = null

/**
 * Neutralises the real network for the whole file.
 *
 * happy-dom implements fetch and sendBeacon for real, so a case that omits an
 * injected implementation would otherwise perform an actual DNS lookup. Beyond
 * being slow, that makes the suite behave differently on a machine without
 * network access.
 */
let restoreGlobals: (() => void) | null = null

function isolateNetwork() {
  const globalScope = globalThis as unknown as {
    fetch?: unknown
    navigator?: { sendBeacon?: unknown }
  }
  const originalFetch = globalScope.fetch
  const originalBeacon = globalScope.navigator?.sendBeacon

  globalScope.fetch = noNetwork
  if (globalScope.navigator) {
    globalScope.navigator.sendBeacon = () => false
  }

  restoreGlobals = () => {
    globalScope.fetch = originalFetch
    if (globalScope.navigator) {
      globalScope.navigator.sendBeacon = originalBeacon
    }
  }
}

beforeEach(() => {
  captured = []
  isolateNetwork()
  storage = memoryStorage()
  fixture()
  // A previous test's click really does navigate the document (happy-dom
  // follows anchors), possibly to a whatsapp: or tel: URL. history.replaceState
  // cannot cross origins, so the document URL is reset through the environment
  // itself before each test.
  resetLocation()
  tracker = start()
})

afterEach(() => {
  tracker?.destroy()
  tracker = null
  restoreGlobals?.()
  restoreGlobals = null
  delete (globalThis as Record<string, unknown>).__veridiaTracker__
})

describe("session start", () => {
  it("emits exactly one session_started", async () => {
    expect(await eventTypes()).toEqual(["session_started"])
  })

  it("does not emit a second session_started on re-init", async () => {
    const second = VeridiaTracker.init({
      storage,
      siteKey: SITE_KEY,
      collectorUrl: COLLECTOR,
      sendBeaconImpl: captureBeacon,
      fetchImpl: noNetwork,
    })

    expect(
      (await eventTypes()).filter((t) => t === "session_started"),
    ).toHaveLength(1)
    expect(second).toBe(tracker)
  })

  it("stays inert when consent says no", async () => {
    tracker?.destroy()
    captured = []

    const blocked = VeridiaTracker.init({
      siteKey: SITE_KEY,
      collectorUrl: COLLECTOR,
      sendBeaconImpl: captureBeacon,
      fetchImpl: noNetwork,
      shouldTrack: () => false,
    })

    expect(blocked).toBeNull()
    expect(captured).toHaveLength(0)
  })
})

describe("WhatsApp detection", () => {
  it.each([
    ["wa", "wa.me"],
    ["wa-api", "api.whatsapp.com"],
    ["wa-scheme", "whatsapp:// scheme"],
    ["wa-explicit", "explicit data attribute"],
  ])("detects %s (%s)", async (id) => {
    captured = []
    clickOn(id)
    expect(await eventTypes()).toEqual(["whatsapp_clicked"])
  })

  it("detects a click on a child element of the link", async () => {
    captured = []
    clickOn("wa-child")
    expect(await eventTypes()).toEqual(["whatsapp_clicked"])
  })

  it("detects a link added to the DOM after init", async () => {
    captured = []
    const link = document.createElement("a")
    link.id = "dynamic-wa"
    link.href = `https://wa.me/${PII_PHONE_DIGITS}`
    document.body.appendChild(link)

    clickOn("dynamic-wa")
    expect(await eventTypes()).toEqual(["whatsapp_clicked"])
  })

  it("never cancels the navigation", async () => {
    // The single most important property: WhatsApp must open regardless.
    const event = clickOn("wa")
    expect(event.defaultPrevented).toBe(false)
  })

  it("ignores a plain link", async () => {
    captured = []
    clickOn("plain")
    expect(captured).toHaveLength(0)
  })
})

describe("phone detection", () => {
  it("detects a tel: link", async () => {
    captured = []
    clickOn("tel")
    expect(await eventTypes()).toEqual(["phone_clicked"])
  })

  it("detects an explicitly marked phone link", async () => {
    captured = []
    clickOn("tel-explicit")
    expect(await eventTypes()).toEqual(["phone_clicked"])
  })

  it("never cancels the call", async () => {
    expect(clickOn("tel").defaultPrevented).toBe(false)
  })
})

describe("form start", () => {
  it("emits one form_started for a marked form", async () => {
    captured = []
    focusOn("marked-email")
    expect(await eventTypes()).toEqual(["form_started"])
  })

  it("does not emit again for another field in the same form", async () => {
    captured = []
    focusOn("marked-email")
    focusOn("marked-phone")
    focusOn("marked-message")
    expect(await eventTypes()).toEqual(["form_started"])
  })

  it("ignores an unmarked form entirely", async () => {
    captured = []
    focusOn("unmarked-email")
    expect(captured).toHaveLength(0)
  })

  it("skips a form containing a password field", async () => {
    // Login, payment and credential forms are never observed, even though no
    // detector reads values anywhere.
    captured = []
    focusOn("login-user")
    expect(captured).toHaveLength(0)
  })

  it("tracks a marked form added after init", async () => {
    captured = []
    const form = document.createElement("form")
    form.setAttribute("data-veridia-form", "later")
    const input = document.createElement("input")
    input.id = "later-input"
    form.appendChild(input)
    document.body.appendChild(form)

    focusOn("later-input")
    expect(await eventTypes()).toEqual(["form_started"])
  })
})

describe("PII boundary", () => {
  it("leaks no sentinel from any interaction", async () => {
    captured = []
    clickOn("wa")
    clickOn("wa-api")
    clickOn("tel")
    focusOn("marked-email")
    focusOn("marked-message")

    const all = (await capturedText()).join("\n")
    expect(captured.length).toBeGreaterThan(0)

    for (const sentinel of SENTINELS) {
      expect(all).not.toContain(sentinel)
    }
  })

  it("strips the query string from page context", async () => {
    // The fixture URL carries ?email= and ?token=.
    captured = []
    clickOn("wa")

    const page = ((await bodies())[0].events as { page: { url: string } }[])[0]
      .page
    expect(page.url).toBe(`${PAGE_ORIGIN}/iletisim`)
    expect(page.url).not.toContain("?")
  })

  it("never reads a form field value", async () => {
    captured = []
    focusOn("marked-email")
    focusOn("marked-message")

    const all = (await capturedText()).join("\n")
    expect(all).not.toContain(PII_EMAIL)
    expect(all).not.toContain(PII_MESSAGE)
  })

  it("sends no risk score or client-asserted category", async () => {
    // Risk lives in the collector; source_category is derived server side.
    captured = []
    clickOn("wa")
    const all = (await capturedText()).join("\n")
    expect(all).not.toContain("riskScore")
    expect(all).not.toContain("sourceCategory")
  })
})

describe("collector contract", () => {
  it("emits a payload the collector validator accepts", async () => {
    captured = []
    clickOn("wa")

    const body = (await bodies())[0]
    const result = validateInteractionBatch(
      { schemaVersion: body.schemaVersion, events: body.events },
      { now: new Date() },
    )

    expect(result.ok).toBe(true)
  })

  it("carries the site key and no tenant identifiers", async () => {
    captured = []
    clickOn("tel")
    const body = (await bodies())[0]

    expect(body.siteKey).toBe(SITE_KEY)
    expect(body).not.toHaveProperty("organizationId")
    expect(body).not.toHaveProperty("siteId")
  })

  it("produces a valid payload for every event type", async () => {
    captured = []
    clickOn("wa")
    clickOn("tel")
    focusOn("marked-email")

    for (const body of await bodies()) {
      const result = validateInteractionBatch(
        { schemaVersion: body.schemaVersion, events: body.events },
        { now: new Date() },
      )
      expect(result.ok).toBe(true)
    }
  })
})

describe("fail-open", () => {
  const failures: [string, Record<string, unknown>][] = [
    [
      "collector offline",
      {
        sendBeaconImpl: undefined,
        fetchImpl: () => Promise.reject(new Error("offline")),
      },
    ],
    [
      "collector 500",
      {
        sendBeaconImpl: () => false,
        fetchImpl: async () => new Response(null, { status: 500 }),
      },
    ],
    [
      "collector 503",
      {
        sendBeaconImpl: () => false,
        fetchImpl: async () => new Response(null, { status: 503 }),
      },
    ],
    [
      "collector 429",
      {
        sendBeaconImpl: () => false,
        fetchImpl: async () => new Response(null, { status: 429 }),
      },
    ],
    [
      "sendBeacon throws",
      {
        sendBeaconImpl: () => {
          throw new Error("CSP")
        },
      },
    ],
    ["sendBeacon returns false", { sendBeaconImpl: () => false }],
    ["fetch missing", { sendBeaconImpl: () => false, fetchImpl: undefined }],
  ]

  it.each(failures)(
    "keeps the page working when %s",
    async (_label, overrides) => {
      tracker?.destroy()
      delete (globalThis as Record<string, unknown>).__veridiaTracker__

      const instance = start(overrides)

      // Every interaction still behaves normally.
      expect(clickOn("wa").defaultPrevented).toBe(false)
      expect(clickOn("tel").defaultPrevented).toBe(false)
      expect(() => focusOn("marked-email")).not.toThrow()

      instance?.destroy()
    },
  )

  it("survives a storage layer that throws on every call", async () => {
    tracker?.destroy()
    delete (globalThis as Record<string, unknown>).__veridiaTracker__

    const hostile = {
      read() {
        throw new Error("SecurityError")
      },
      write() {
        throw new Error("SecurityError")
      },
      remove() {
        throw new Error("SecurityError")
      },
      persistent: false,
    }

    expect(() => start({ storage: hostile })).not.toThrow()
    expect(clickOn("wa").defaultPrevented).toBe(false)
  })

  it("returns null instead of throwing when initialization fails", async () => {
    tracker?.destroy()
    delete (globalThis as Record<string, unknown>).__veridiaTracker__

    const instance = VeridiaTracker.init({
      siteKey: SITE_KEY,
      collectorUrl: COLLECTOR,
      shouldTrack() {
        throw new Error("consent provider exploded")
      },
    })

    expect(instance).toBeNull()
  })

  it("stays silent in the console by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    clickOn("wa")
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe("SPA navigation", () => {
  it("does not start a new session or emit page_view", async () => {
    captured = []
    window.history.pushState({}, "", "/hizmetler")
    window.history.replaceState({}, "", "/hizmetler/detay")
    window.dispatchEvent(new PopStateEvent("popstate"))

    expect(captured).toHaveLength(0)
  })

  it("restores native history methods on destroy", async () => {
    const patched = window.history.pushState
    tracker?.destroy()
    tracker = null
    expect(window.history.pushState).not.toBe(patched)
  })
})
