/**
 * Veridia interaction tracker.
 *
 * Vanilla browser code with no framework, no analytics SDK and no Supabase
 * client. The only credential it carries is the public site key, which is
 * embedded in page source by design and grants nothing beyond naming a site.
 *
 * The Phase 1 HMAC signing secret, credential encryption keys, service role key
 * and worker secret are server-only and can never appear here. A regression test
 * asserts the built bundle contains no signing logic at all.
 *
 * Fail-open is the governing contract: no exception raised inside this tracker
 * may reach the customer's page, and no click is ever delayed waiting for the
 * network.
 */

import { AttributionManager } from "./attribution"
import {
  findInteraction,
  findTrackedForm,
  type InteractionKind,
} from "./detectors"
import { safePageUrl, safeReferrer } from "./sanitize"
import { randomId, SessionManager } from "./session"
import { createStorage, type TrackerStorage } from "./storage"
import { Transport } from "./transport"

export const TRACKER_SCHEMA_VERSION = "2.0"

export interface TrackerConfig {
  siteKey: string
  collectorUrl: string
  trackerVersion?: string
  integrationVersion?: string
  /**
   * Consent integration point.
   *
   * Deliberately not a hardcoded cookie-banner or DNT policy: whether tracking
   * is lawful without consent is a legal decision for the site operator, not
   * something an analytics library should decide on their behalf. Return false
   * to keep the tracker inert.
   */
  shouldTrack?: () => boolean
  enabled?: boolean
  /** Development only. Production is silent. */
  debug?: boolean
  inactivityMs?: number
  timeoutMs?: number
  storage?: TrackerStorage
  now?: () => number
  fetchImpl?: typeof fetch
  sendBeaconImpl?: (url: string, data: BodyInit) => boolean
}

type InteractionEventType =
  "session_started" | "whatsapp_clicked" | "phone_clicked" | "form_started"

const EVENT_FOR_KIND: Record<InteractionKind, InteractionEventType> = {
  whatsapp: "whatsapp_clicked",
  phone: "phone_clicked",
}

interface TrackerInstance {
  destroy(): void
}

const GLOBAL_KEY = "__veridiaTracker__"

export class VeridiaTracker implements TrackerInstance {
  private readonly config: TrackerConfig
  private readonly storage: TrackerStorage
  private readonly session: SessionManager
  private readonly attribution: AttributionManager
  private readonly transport: Transport
  private readonly now: () => number

  /** Forms already reported this session, so one form yields one event. */
  private readonly startedForms = new Set<string>()

  /**
   * Page context captured at load and at SPA navigation, never at click time.
   *
   * Reading `location.href` inside a click handler is unsafe: a click on a
   * `wa.me` or `tel:` link can have already moved the location, and the URL
   * would then be the link target -- which is a phone number. It is also
   * semantically wrong: the interaction happened on the page the visitor was
   * on, not on the destination.
   */
  private pageContext: { url: string | null; referrer: string | null } = {
    url: null,
    referrer: null,
  }
  private disposed = false
  private clickListener?: (event: Event) => void
  private formListener?: (event: Event) => void
  private popstateListener?: () => void
  private restoreHistory?: () => void

  private constructor(config: TrackerConfig) {
    this.config = config
    this.now = config.now ?? (() => Date.now())
    this.storage = config.storage ?? createStorage()
    this.session = new SessionManager({
      storage: this.storage,
      inactivityMs: config.inactivityMs,
      now: this.now,
    })
    this.attribution = new AttributionManager({
      storage: this.storage,
      now: this.now,
    })
    this.transport = new Transport({
      collectorUrl: config.collectorUrl,
      timeoutMs: config.timeoutMs,
      fetchImpl: config.fetchImpl,
      sendBeaconImpl: config.sendBeaconImpl,
    })
  }

  /**
   * Initializes the tracker.
   *
   * Never throws. A tracker that cannot start disables itself; the customer's
   * page must not notice.
   */
  static init(config: TrackerConfig): TrackerInstance | null {
    try {
      if (config.enabled === false) {
        return null
      }

      if (config.shouldTrack && !config.shouldTrack()) {
        return null
      }

      if (typeof document === "undefined") {
        return null
      }

      // A site that loads the snippet twice must not double count. Listeners,
      // session_started and form_started are all registered once.
      const existing = (globalThis as Record<string, unknown>)[GLOBAL_KEY]
      if (existing) {
        return existing as TrackerInstance
      }

      const tracker = new VeridiaTracker(config)
      tracker.start()
      ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = tracker
      return tracker
    } catch (error) {
      logDebug(config, error)
      return null
    }
  }

  private start(): void {
    this.capturePageContext(
      typeof document !== "undefined" ? document.referrer : "",
    )
    this.attribution.observe(
      typeof location !== "undefined" ? location.href : "",
      typeof document !== "undefined" ? document.referrer : "",
    )

    this.emitSessionStarted()
    this.attachClickListener()
    this.attachFormListener()
    this.attachNavigationHooks()
  }

  private emitSessionStarted(): void {
    const session = this.session.current()

    if (session.startedEmitted) {
      return
    }

    // Recorded before sending. A failed send must not produce a second
    // session_started for the same session.
    this.session.markStartedEmitted()
    this.queue("session_started")
  }

  /**
   * One delegated listener on the document rather than one per link.
   *
   * Links rendered later by a framework are covered for free, with no
   * MutationObserver and no DOM scan at startup.
   *
   * `passive` guarantees the handler cannot call `preventDefault`, so a
   * navigation can never be cancelled by this code even by mistake.
   */
  private attachClickListener(): void {
    this.clickListener = (event: Event) => {
      try {
        const kind = findInteraction(event.target)

        if (!kind) {
          return
        }

        // Queued, never awaited: the browser navigates immediately.
        this.queue(EVENT_FOR_KIND[kind])
      } catch (error) {
        logDebug(this.config, error)
      }
    }

    document.addEventListener("click", this.clickListener, {
      capture: true,
      passive: true,
    })
  }

  /**
   * Form start is detected from focus, which fires before the visitor types.
   *
   * No field value is read here or anywhere else. The detector only needs to
   * know that a marked form was engaged.
   */
  private attachFormListener(): void {
    this.formListener = (event: Event) => {
      try {
        const tracked = findTrackedForm(event.target)

        if (!tracked) {
          return
        }

        const session = this.session.current()
        const key = `${session.sessionId}:${tracked.formKey}`

        if (this.startedForms.has(key)) {
          return
        }

        this.startedForms.add(key)
        this.queue("form_started")
      } catch (error) {
        logDebug(this.config, error)
      }
    }

    document.addEventListener("focusin", this.formListener, {
      capture: true,
      passive: true,
    })
  }

  /**
   * SPA navigation refreshes page context and attribution.
   *
   * It does not start a new session and emits no `page_view`: Phase 2A counts
   * interactions, not page views.
   *
   * History methods are wrapped once and the originals kept, so another library
   * that patched them keeps working and `destroy()` can restore them.
   */
  private attachNavigationHooks(): void {
    if (typeof history === "undefined") {
      return
    }

    // Bound at capture so the saved references carry their own `this`. An
    // unbound method reference would rely on the call site preserving it.
    const originalPush = history.pushState.bind(history)
    const originalReplace = history.replaceState.bind(history)
    const onNavigate = () => {
      try {
        // Referrer is not re-read: within an SPA the document referrer still
        // describes how the visitor arrived at the site.
        this.capturePageContext(null)
        this.attribution.observe(location.href, "")
      } catch (error) {
        logDebug(this.config, error)
      }
    }

    history.pushState = function patchedPushState(
      ...args: Parameters<History["pushState"]>
    ) {
      const result = originalPush(...args)
      onNavigate()
      return result
    }

    history.replaceState = function patchedReplaceState(
      ...args: Parameters<History["replaceState"]>
    ) {
      const result = originalReplace(...args)
      onNavigate()
      return result
    }

    this.popstateListener = onNavigate
    window.addEventListener("popstate", this.popstateListener)

    this.restoreHistory = () => {
      history.pushState = originalPush
      history.replaceState = originalReplace
    }
  }

  private capturePageContext(referrer: string | null): void {
    const href = typeof location !== "undefined" ? location.href : ""

    this.pageContext = {
      url: safePageUrl(href),
      referrer:
        referrer === null
          ? this.pageContext.referrer
          : referrer
            ? safeReferrer(referrer)
            : null,
    }
  }

  /** Builds and sends one event. Never awaited by a click handler. */
  private queue(eventType: InteractionEventType): void {
    if (this.disposed) {
      return
    }

    try {
      const payload = this.buildPayload(eventType)
      void this.transport.send(payload).catch(() => {
        // Delivery failure is not the customer's problem.
      })
    } catch (error) {
      logDebug(this.config, error)
    }
  }

  private buildPayload(eventType: InteractionEventType) {
    const session = this.session.current()
    const utm = this.attribution.currentUtm()

    return {
      schemaVersion: TRACKER_SCHEMA_VERSION,
      siteKey: this.config.siteKey,
      events: [
        {
          eventId: randomId("evt"),
          eventType,
          sessionId: session.sessionId,
          occurredAt: new Date(this.now()).toISOString(),
          page: {
            // Snapshot taken at page load. Origin + pathname only; the query
            // string never leaves the page.
            url: this.pageContext.url,
            referrer: this.pageContext.referrer,
          },
          attribution: {
            utmSource: utm.utm_source ?? null,
            utmMedium: utm.utm_medium ?? null,
            utmCampaign: utm.utm_campaign ?? null,
            utmTerm: utm.utm_term ?? null,
            utmContent: utm.utm_content ?? null,
          },
          trackerVersion: this.config.trackerVersion ?? null,
          integrationVersion: this.config.integrationVersion ?? null,
        },
      ],
    }
  }

  /** Removes every listener and restores patched history methods. */
  destroy(): void {
    this.disposed = true

    try {
      if (this.clickListener) {
        document.removeEventListener("click", this.clickListener, {
          capture: true,
        })
      }
      if (this.formListener) {
        document.removeEventListener("focusin", this.formListener, {
          capture: true,
        })
      }
      if (this.popstateListener) {
        window.removeEventListener("popstate", this.popstateListener)
      }
      this.restoreHistory?.()
    } catch {
      // Teardown is best effort.
    }

    if ((globalThis as Record<string, unknown>)[GLOBAL_KEY] === this) {
      delete (globalThis as Record<string, unknown>)[GLOBAL_KEY]
    }
  }
}

/**
 * Debug output is opt-in and development only.
 *
 * A tracker that logs on every failure would fill a customer's console during a
 * collector outage, turning an invisible problem into a visible one.
 */
function logDebug(config: TrackerConfig, error: unknown): void {
  if (!config.debug) {
    return
  }

  try {
    // Message only. An error object can carry request details in its properties.
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[veridia] ${message}`)
  } catch {
    // Even logging must not throw.
  }
}

export default VeridiaTracker
