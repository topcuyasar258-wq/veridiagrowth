/**
 * Event transport.
 *
 * The governing rule: sending an event must never delay or block what the
 * visitor was doing. A WhatsApp click opens WhatsApp whether or not the
 * collector is reachable, so nothing here is ever awaited by a click handler.
 *
 * There is no persistent queue and no unbounded retry. A queue that survives
 * reloads would keep retrying against an outage and turn a collector problem
 * into a customer-site problem.
 */

export interface TransportOptions {
  collectorUrl: string
  timeoutMs?: number
  /** At most one retry, reusing the same event id so the collector deduplicates. */
  maxRetries?: number
  fetchImpl?: typeof fetch
  sendBeaconImpl?: (url: string, data: BodyInit) => boolean
}

export type TransportResult = "sent" | "failed" | "unavailable"

const DEFAULT_TIMEOUT_MS = 3000

export class Transport {
  private readonly collectorUrl: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly fetchImpl?: typeof fetch
  private readonly sendBeaconImpl?: (url: string, data: BodyInit) => boolean

  constructor(options: TransportOptions) {
    this.collectorUrl = options.collectorUrl
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = options.maxRetries ?? 1
    this.fetchImpl = options.fetchImpl
    this.sendBeaconImpl = options.sendBeaconImpl
  }

  /**
   * Fire and forget.
   *
   * Returns a promise for tests only. Callers in the click path must not await
   * it, and the promise never rejects.
   */
  async send(payload: unknown): Promise<TransportResult> {
    let body: string

    try {
      body = JSON.stringify(payload)
    } catch {
      // A payload that will not serialize is dropped rather than retried.
      return "failed"
    }

    if (this.trySendBeacon(body)) {
      return "sent"
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const result = await this.tryFetch(body)

      if (result === "sent") {
        return "sent"
      }

      if (result === "unavailable") {
        return "unavailable"
      }
    }

    return "failed"
  }

  /**
   * `sendBeacon` is preferred because it survives page unload, which is exactly
   * when a WhatsApp or tel click navigates away.
   *
   * A Blob carries the content type; beacon has no header API. It returns false
   * when the payload exceeds the browser's queue limit, in which case we fall
   * through to fetch rather than losing the event.
   */
  private trySendBeacon(body: string): boolean {
    const beacon =
      this.sendBeaconImpl ??
      (typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
        ? navigator.sendBeacon.bind(navigator)
        : undefined)

    if (!beacon) {
      return false
    }

    try {
      const blob =
        typeof Blob === "function"
          ? new Blob([body], { type: "application/json" })
          : body
      return beacon(this.collectorUrl, blob as BodyInit) === true
    } catch {
      return false
    }
  }

  private async tryFetch(body: string): Promise<TransportResult> {
    const fetchFn =
      this.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined)

    if (!fetchFn) {
      return "unavailable"
    }

    // AbortController is not universally present in every embedded webview;
    // without it the request simply is not time-bounded.
    const controller =
      typeof AbortController === "function" ? new AbortController() : undefined
    const timer = controller
      ? setTimeout(() => {
          controller.abort()
        }, this.timeoutMs)
      : undefined

    try {
      const response = await fetchFn(this.collectorUrl, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller?.signal,
      })

      // Any 2xx counts as delivered. A 4xx means the collector rejected the
      // payload and retrying identical bytes cannot help.
      if (response.ok) return "sent"
      if (response.status >= 400 && response.status < 500) return "unavailable"
      return "failed"
    } catch {
      return "failed"
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }
}
