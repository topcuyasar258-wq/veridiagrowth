/**
 * Veridia loader.
 *
 * The only file a customer site references directly. It reads configuration
 * from its own script tag, loads the versioned tracker artifact asynchronously
 * and initializes it.
 *
 * It stays tiny and separate from the tracker so the byte that every customer
 * page downloads synchronously in the critical path stays small, and so the
 * tracker artifact can be versioned and rolled back without touching the
 * snippet embedded in customer HTML.
 *
 * Every failure path here is silent by design. A tracker that cannot load must
 * leave the page exactly as it found it.
 */

interface LoaderWindow {
  __veridiaLoaderStarted__?: boolean
}

;(function veridiaLoader() {
  try {
    const scope = window as unknown as LoaderWindow

    // A site that pastes the snippet twice must not load the tracker twice.
    if (scope.__veridiaLoaderStarted__) {
      return
    }
    scope.__veridiaLoaderStarted__ = true

    const script =
      (document.currentScript as HTMLScriptElement | null) ??
      document.querySelector<HTMLScriptElement>("script[data-veridia-site]")

    if (!script) {
      return
    }

    const siteKey = script.getAttribute("data-veridia-site")

    if (!siteKey) {
      return
    }

    const collectorUrl =
      script.getAttribute("data-veridia-collector") ??
      new URL("/api/v1/collect", script.src).toString()

    const version = script.getAttribute("data-veridia-version") ?? "0.1.0"
    const trackerUrl =
      script.getAttribute("data-veridia-tracker") ??
      new URL(`tracker-v${version}.js`, script.src).toString()

    const tracker = document.createElement("script")
    tracker.src = trackerUrl
    // async so the tracker never blocks parsing or rendering. document.write
    // and synchronous XHR are never used.
    tracker.async = true
    tracker.crossOrigin = "anonymous"

    tracker.onload = function onTrackerLoad() {
      try {
        const api = (window as unknown as Record<string, unknown>)
          .VeridiaTracker as
          { init: (config: Record<string, unknown>) => unknown } | undefined

        api?.init({
          siteKey,
          collectorUrl,
          trackerVersion: version,
          integrationVersion:
            script.getAttribute("data-veridia-integration") ?? "1.0.0",
        })
      } catch {
        // A tracker that fails to initialize is simply not running.
      }
    }

    // A 404, a CSP block or an offline network all land here and are ignored.
    tracker.onerror = function onTrackerError() {
      /* fail open */
    }

    document.head.appendChild(tracker)
  } catch {
    // Nothing in the loader may surface to the page.
  }
})()
