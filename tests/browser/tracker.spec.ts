import { expect, test, type ConsoleMessage, type Page } from "@playwright/test"

import { validateInteractionBatch } from "@veridia/shared"

import {
  FORBIDDEN_IN_PAYLOAD,
  SENTINELS,
  startFixtureServer,
  type FixtureServer,
} from "./fixture-server"

/**
 * Real-browser acceptance.
 *
 * Runs the actual built tracker bundle in Chromium against a local HTTP server
 * that plays the collector. Assertions are made on the bytes the browser really
 * sent, not on a stub's idea of them.
 */

let server: FixtureServer
let pageErrors: string[] = []
let consoleErrors: string[] = []

test.beforeAll(async () => {
  server = await startFixtureServer()
})

test.afterAll(async () => {
  await server.close()
})

test.beforeEach(async ({ page }) => {
  server.reset()
  pageErrors = []
  consoleErrors = []

  page.on("pageerror", (error) => {
    pageErrors.push(error.message)
  })
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text())
    }
  })
})

/** The fixture URL carries PII in its query string, which must never be sent. */
function fixtureUrl(path = "/") {
  return `${server.origin}${path}?email=${encodeURIComponent(SENTINELS.email)}&token=${SENTINELS.queryToken}`
}

async function load(page: Page, path = "/") {
  await page.goto(fixtureUrl(path))
  // The loader injects the tracker asynchronously; wait for its first event.
  await page.waitForFunction(() => window.__veridiaTracker__ !== undefined, {
    timeout: 10_000,
  })
}

function bodies() {
  return server.captured.map(
    (request) => JSON.parse(request.body) as Record<string, unknown>,
  )
}

function eventTypes() {
  return bodies().flatMap((body) =>
    (body.events as { eventType: string }[]).map((event) => event.eventType),
  )
}

async function settle(page: Page) {
  // Beacons are dispatched without awaiting; give the server a moment to record.
  await page.waitForTimeout(300)
}

test.describe("happy path", () => {
  test("loads the real bundle and starts a session", async ({ page }) => {
    await load(page)
    await settle(page)

    expect(eventTypes()).toEqual(["session_started"])
    expect(pageErrors).toEqual([])
  })

  test("reports a WhatsApp click", async ({ page }) => {
    await load(page)
    await settle(page)
    server.captured.length = 0

    await page.click("#whatsapp")
    await settle(page)

    expect(eventTypes()).toEqual(["whatsapp_clicked"])
  })

  test("reports a phone click", async ({ page }) => {
    await load(page)
    await settle(page)
    server.captured.length = 0

    await page.click("#phone")
    await settle(page)

    expect(eventTypes()).toEqual(["phone_clicked"])
  })

  test("reports a marked form once", async ({ page }) => {
    await load(page)
    await settle(page)
    server.captured.length = 0

    await page.focus("#marked-email")
    await page.focus("#marked-phone")
    await page.focus("#marked-message")
    await settle(page)

    expect(eventTypes()).toEqual(["form_started"])
  })

  test("ignores an unmarked form and a password form", async ({ page }) => {
    await load(page)
    await settle(page)
    server.captured.length = 0

    await page.focus("#unmarked-email")
    await page.focus("#login-email")
    await settle(page)

    expect(server.captured).toHaveLength(0)
  })

  test("emits nothing on SPA navigation", async ({ page }) => {
    await load(page)
    await settle(page)
    server.captured.length = 0

    await page.click("#spa-nav")
    await settle(page)

    // Phase 2A counts interactions, not page views, and SPA navigation is not a
    // new session.
    expect(server.captured).toHaveLength(0)
  })

  test("detects links and forms added after load", async ({ page }) => {
    await load(page)
    await settle(page)
    server.captured.length = 0

    await page.click("#add-dynamic")
    await page.click("#dyn-whatsapp")
    await page.click("#dyn-phone")
    await page.focus("#dyn-input")
    await settle(page)

    expect(eventTypes().sort()).toEqual([
      "form_started",
      "phone_clicked",
      "whatsapp_clicked",
    ])
  })
})

test.describe("PII boundary on the wire", () => {
  test("no sentinel appears in any captured body", async ({ page }) => {
    await load(page)
    await settle(page)

    await page.click("#whatsapp")
    await page.click("#whatsapp-api")
    await page.click("#phone")
    await page.focus("#marked-email")
    await page.focus("#marked-message")
    await settle(page)

    expect(server.captured.length).toBeGreaterThan(0)
    const wire = server.captured.map((request) => request.body).join("\n")

    for (const sentinel of FORBIDDEN_IN_PAYLOAD) {
      expect(wire, `${sentinel} reached the collector`).not.toContain(sentinel)
    }
  })

  test("the page URL is sent without its query string", async ({ page }) => {
    await load(page)
    await settle(page)

    const page0 = (bodies()[0].events as { page: { url: string } }[])[0].page
    expect(page0.url).toBe(`${server.origin}/`)
    expect(page0.url).not.toContain("?")
  })

  test("a WhatsApp click reports the visitor's page, not the destination", async ({
    page,
  }) => {
    // Regression for the slice 3 leak: reading location.href inside the click
    // handler could serialise wa.me/<phone number> as page context.
    await load(page)
    await settle(page)
    server.captured.length = 0

    await page.click("#whatsapp")
    await settle(page)

    const context = (bodies()[0].events as { page: { url: string } }[])[0].page
    expect(context.url).toBe(`${server.origin}/`)
    expect(context.url).not.toContain("wa.me")
    expect(context.url).not.toContain(SENTINELS.phoneDigits)
  })

  test("form field values are never read", async ({ page }) => {
    await load(page)
    await settle(page)
    server.captured.length = 0

    await page.fill("#marked-email", SENTINELS.email)
    await page.fill("#marked-message", SENTINELS.message)
    await page.click("#marked-submit")
    await settle(page)

    const wire = server.captured.map((r) => r.body).join("\n")
    expect(wire).not.toContain(SENTINELS.email)
    expect(wire).not.toContain(SENTINELS.message)
  })
})

test.describe("collector contract", () => {
  test("the real bundle emits a payload the collector validator accepts", async ({
    page,
  }) => {
    await load(page)
    await settle(page)

    await page.click("#whatsapp")
    await page.focus("#marked-email")
    await settle(page)

    expect(server.captured.length).toBeGreaterThan(0)

    for (const body of bodies()) {
      const result = validateInteractionBatch(
        { schemaVersion: body.schemaVersion, events: body.events },
        { now: new Date() },
      )
      expect(result.ok, JSON.stringify(body)).toBe(true)
    }
  })

  test("sends JSON with the site key and no tenant identifiers", async ({
    page,
  }) => {
    await load(page)
    await settle(page)

    const request = server.captured[0]
    expect(request.contentType).toContain("application/json")

    const body = bodies()[0]
    expect(body.siteKey).toBe("vtk_abcdef0123456789abcdef0123456789")
    expect(body).not.toHaveProperty("organizationId")
    expect(body).not.toHaveProperty("siteId")
    expect(body).not.toHaveProperty("sourceCategory")
  })
})

test.describe("fail-open", () => {
  const modes = ["500", "503", "429", "timeout", "abort"] as const

  for (const mode of modes) {
    test(`the page keeps working when the collector answers ${mode}`, async ({
      page,
    }) => {
      server.setCollectorMode(mode)
      await load(page)

      // Every interaction still behaves normally.
      await page.click("#whatsapp")
      expect(await page.evaluate(() => window.__lastNavigation)).toContain(
        "wa.me",
      )

      await page.click("#phone")
      expect(await page.evaluate(() => window.__lastNavigation)).toContain(
        "tel:",
      )

      await page.fill("#marked-email", "typed@example.com")
      expect(await page.inputValue("#marked-email")).toBe("typed@example.com")

      await settle(page)
      expect(pageErrors, pageErrors.join("\n")).toEqual([])
    })
  }

  test("the site works when the tracker artifact 404s", async ({ page }) => {
    server.setTrackerMissing(true)
    await page.goto(fixtureUrl())

    await expect(page.locator("#heading")).toBeVisible()
    await page.click("#whatsapp")
    expect(await page.evaluate(() => window.__lastNavigation)).toContain(
      "wa.me",
    )
    expect(pageErrors).toEqual([])
  })

  test("the tracker survives a hostile localStorage", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("SecurityError: storage disabled")
        },
      })
    })

    await page.goto(fixtureUrl())
    await expect(page.locator("#heading")).toBeVisible()

    await page.click("#whatsapp")
    expect(await page.evaluate(() => window.__lastNavigation)).toContain(
      "wa.me",
    )
    expect(pageErrors, pageErrors.join("\n")).toEqual([])
  })

  test("raises no uncaught error in any failure mode", async ({ page }) => {
    for (const mode of ["500", "timeout", "abort"] as const) {
      server.setCollectorMode(mode)
      await page.goto(fixtureUrl())
      await page.click("#whatsapp").catch(() => {})
      await settle(page)
    }

    const trackerErrors = pageErrors.filter((message) =>
      message.toLowerCase().includes("veridia"),
    )
    expect(trackerErrors).toEqual([])
    expect(pageErrors, pageErrors.join("\n")).toEqual([])
  })
})

test.describe("double init", () => {
  test("injecting the loader twice produces one session and one event", async ({
    page,
  }) => {
    await load(page)
    await settle(page)

    await page.evaluate((origin) => {
      const script = document.createElement("script")
      script.src = `${origin}/loader.js`
      script.setAttribute(
        "data-veridia-site",
        "vtk_abcdef0123456789abcdef0123456789",
      )
      script.setAttribute("data-veridia-collector", "/api/v1/collect")
      document.head.appendChild(script)
    }, server.origin)

    await settle(page)

    expect(eventTypes().filter((t) => t === "session_started")).toHaveLength(1)

    server.captured.length = 0
    await page.click("#whatsapp")
    await settle(page)

    // One click must not report twice.
    expect(eventTypes()).toEqual(["whatsapp_clicked"])
  })
})

test.describe("CSP", () => {
  test("works under a policy that allows the tracker", async ({ page }) => {
    await page.goto(`${server.origin}/csp-allowed`)
    await page.waitForTimeout(600)

    await expect(page.locator("#heading")).toBeVisible()
    expect(eventTypes()).toContain("session_started")
  })

  test("the site works when connect-src blocks the collector", async ({
    page,
  }) => {
    await page.goto(`${server.origin}/csp-connect-blocked`)
    await page.waitForTimeout(600)

    await expect(page.locator("#heading")).toBeVisible()
    await page.click("#whatsapp")
    expect(await page.evaluate(() => window.__lastNavigation)).toContain(
      "wa.me",
    )

    // A CSP violation is reported by the browser, not by the tracker.
    const trackerErrors = pageErrors.filter((m) =>
      m.toLowerCase().includes("veridia"),
    )
    expect(trackerErrors).toEqual([])
  })

  test("the site works when script-src blocks the tracker", async ({
    page,
  }) => {
    await page.goto(`${server.origin}/csp-script-blocked`)
    await page.waitForTimeout(600)

    await expect(page.locator("#heading")).toBeVisible()
    await page.click("#whatsapp")
    expect(await page.evaluate(() => window.__lastNavigation)).toContain(
      "wa.me",
    )
  })
})

declare global {
  interface Window {
    __veridiaTracker__?: unknown
    __lastNavigation?: string
  }
}
