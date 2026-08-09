import { createServer, type Server } from "node:http"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { AddressInfo } from "node:net"

/**
 * Controlled fixture server for real-browser acceptance.
 *
 * Serves the actual built tracker artifacts and acts as the collector, so the
 * test exercises the bundle a customer would receive rather than the TypeScript
 * source. Everything is local: no DNS, no external request, no dependency on
 * WhatsApp or any other third party, so CI stays deterministic.
 */

export const SENTINELS = {
  email: "phase2-browser-secret@example.com",
  phone: "+905551234567",
  phoneDigits: "905551234567",
  message: "BROWSER_PRIVATE_MESSAGE_123",
  queryToken: "unsafe-query-token-xyz",
} as const

/** Every string that must never appear in a captured request body. */
export const FORBIDDEN_IN_PAYLOAD = [
  SENTINELS.email,
  SENTINELS.phone,
  SENTINELS.phoneDigits,
  SENTINELS.message,
  SENTINELS.queryToken,
  `wa.me/${SENTINELS.phoneDigits}`,
  `tel:${SENTINELS.phone}`,
]

const DIST = "packages/tracker/dist"
const SITE_KEY = "vtk_abcdef0123456789abcdef0123456789"

export type CollectorMode = "ok" | "500" | "503" | "429" | "timeout" | "abort"

export interface CapturedRequest {
  url: string
  body: string
  origin: string | null
  contentType: string | null
}

export interface FixtureServer {
  origin: string
  captured: CapturedRequest[]
  setCollectorMode(mode: CollectorMode): void
  /** Serve a 404 for the tracker artifact, simulating a failed CDN. */
  setTrackerMissing(missing: boolean): void
  reset(): void
  close(): Promise<void>
}

function page(options: { csp?: string; trackerSrc?: string }): string {
  const csp = options.csp
    ? `<meta http-equiv="Content-Security-Policy" content="${options.csp}" />`
    : ""

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
${csp}
<title>Veridia fixture</title>
</head>
<body>
  <h1 id="heading">Veridia test sayfası</h1>

  <a id="internal" href="/other">Diğer sayfa</a>
  <a id="whatsapp" href="https://wa.me/${SENTINELS.phoneDigits}?text=${encodeURIComponent(SENTINELS.message)}">WhatsApp</a>
  <a id="whatsapp-api" href="https://api.whatsapp.com/send?phone=${SENTINELS.phoneDigits}">WhatsApp API</a>
  <a id="whatsapp-marked" href="/iletisim" data-veridia-track="whatsapp">WhatsApp (işaretli)</a>
  <a id="phone" href="tel:${SENTINELS.phone}">Ara</a>
  <a id="phone-marked" href="/ara" data-veridia-track="phone">Ara (işaretli)</a>

  <form id="marked-form" data-veridia-form="contact" onsubmit="return false">
    <input id="marked-email" name="email" type="email" value="${SENTINELS.email}" />
    <input id="marked-phone" name="phone" type="tel" value="${SENTINELS.phone}" />
    <textarea id="marked-message" name="message">${SENTINELS.message}</textarea>
    <button id="marked-submit" type="submit">Gönder</button>
  </form>

  <form id="unmarked-form" onsubmit="return false">
    <input id="unmarked-email" type="email" value="${SENTINELS.email}" />
  </form>

  <form id="login-form" data-veridia-form="login" onsubmit="return false">
    <input id="login-email" type="email" value="${SENTINELS.email}" />
    <input id="login-password" type="password" value="hunter2" />
  </form>

  <button id="spa-nav" onclick="history.pushState({}, '', '/hizmetler')">SPA</button>
  <button id="add-dynamic">Dinamik ekle</button>

  <div id="dynamic"></div>

  <script>
    document.getElementById("add-dynamic").addEventListener("click", function () {
      var host = document.getElementById("dynamic");
      host.innerHTML =
        '<a id="dyn-whatsapp" href="https://wa.me/${SENTINELS.phoneDigits}">dyn wa</a>' +
        '<a id="dyn-phone" href="tel:${SENTINELS.phone}">dyn tel</a>' +
        '<form id="dyn-form" data-veridia-form="dynamic" onsubmit="return false">' +
        '<input id="dyn-input" type="text" /></form>';
    });

    // Every link points somewhere real on this server, so a navigation that is
    // allowed to proceed does not leave the fixture.
    document.addEventListener("click", function (event) {
      var anchor = event.target.closest && event.target.closest("a");
      if (anchor && !event.defaultPrevented) {
        event.preventDefault();
        window.__lastNavigation = anchor.getAttribute("href");
      }
    });
  </script>

  <script async src="${options.trackerSrc ?? "/loader.js"}" data-veridia-site="${SITE_KEY}" data-veridia-collector="/api/v1/collect"></script>
</body>
</html>`
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const captured: CapturedRequest[] = []
  let collectorMode: CollectorMode = "ok"
  let trackerMissing = false

  const trackerJs = readFileSync(join(DIST, "tracker-v0.1.0.js"), "utf8")
  const loaderJs = readFileSync(join(DIST, "loader.js"), "utf8")

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost")

    if (url.pathname === "/api/v1/collect" && request.method === "POST") {
      let body = ""
      request.on("data", (chunk) => {
        body += String(chunk)
      })
      request.on("end", () => {
        // The real serialized bytes, decoded. A placeholder here would make
        // every PII assertion vacuous.
        captured.push({
          url: url.pathname,
          body,
          origin: (request.headers.origin as string) ?? null,
          contentType: (request.headers["content-type"] as string) ?? null,
        })

        if (collectorMode === "timeout") {
          // Never answer. The tracker must abort on its own.
          return
        }

        if (collectorMode === "abort") {
          request.socket.destroy()
          return
        }

        const status =
          collectorMode === "ok" ? 202 : Number.parseInt(collectorMode, 10)

        response.writeHead(status, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": request.headers.origin ?? "*",
        })
        response.end(
          JSON.stringify({
            accepted: 1,
            duplicate: 0,
            quarantined: 0,
            rejected: 0,
          }),
        )
      })
      return
    }

    if (url.pathname === "/api/v1/collect" && request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": request.headers.origin ?? "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      })
      response.end()
      return
    }

    if (url.pathname === "/loader.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" })
      response.end(loaderJs)
      return
    }

    if (url.pathname === "/tracker-v0.1.0.js") {
      if (trackerMissing) {
        response.writeHead(404)
        response.end("not found")
        return
      }
      response.writeHead(200, { "Content-Type": "text/javascript" })
      response.end(trackerJs)
      return
    }

    // CSP scenarios, each a real response header rather than a meta tag.
    const cspHeaders: Record<string, string> = {}

    if (url.pathname === "/csp-allowed") {
      cspHeaders["Content-Security-Policy"] =
        "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
    }

    if (url.pathname === "/csp-connect-blocked") {
      // Script may load; the collector call may not be made.
      cspHeaders["Content-Security-Policy"] =
        "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'none'"
    }

    if (url.pathname === "/csp-script-blocked") {
      cspHeaders["Content-Security-Policy"] =
        "default-src 'self'; script-src 'unsafe-inline'; connect-src 'self'"
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      ...cspHeaders,
    })
    response.end(page({}))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })

  const port = (server.address() as AddressInfo).port

  return {
    origin: `http://127.0.0.1:${port}`,
    captured,
    setCollectorMode(mode) {
      collectorMode = mode
    },
    setTrackerMissing(missing) {
      trackerMissing = missing
    },
    reset() {
      captured.length = 0
      collectorMode = "ok"
      trackerMissing = false
    },
    async close() {
      await new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => {
          resolve()
        })
      })
    },
  }
}
