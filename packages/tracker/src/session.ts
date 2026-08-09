import { readJson, writeJson, type TrackerStorage } from "./storage"

/**
 * Anonymous first-party session.
 *
 * A session is a short-lived, random identifier scoped to one site. It carries
 * nothing derived from the device or the visitor, so it cannot be used to
 * recognise the same person on another site or after it expires.
 *
 * Explicitly not done, and not to be added later without a policy decision:
 * canvas, audio or font fingerprinting, device signatures, cross-site
 * identifiers, or anything that would survive as an advertising-style profile.
 */

export const SESSION_STORAGE_KEY = "veridia.session.v1"
export const DEFAULT_INACTIVITY_MS = 30 * 60 * 1000

export interface SessionState {
  sessionId: string
  createdAt: number
  lastActivityAt: number
  /** Whether `session_started` has already been emitted for this session. */
  startedEmitted: boolean
}

/**
 * Cryptographically random id.
 *
 * `Math.random` is never acceptable here: predictable ids would let anyone
 * forge or collide another visitor's session.
 */
export function randomId(prefix: string): string {
  const cryptoObject = globalThis.crypto

  if (cryptoObject?.randomUUID) {
    return `${prefix}_${cryptoObject.randomUUID()}`
  }

  if (cryptoObject?.getRandomValues) {
    const bytes = new Uint8Array(16)
    cryptoObject.getRandomValues(bytes)
    let hex = ""
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, "0")
    }
    return `${prefix}_${hex}`
  }

  // No secure source available. The caller disables tracking rather than
  // falling back to a weak identifier.
  throw new Error("no secure random source")
}

export interface SessionManagerOptions {
  storage: TrackerStorage
  inactivityMs?: number
  now?: () => number
}

export class SessionManager {
  private readonly storage: TrackerStorage
  private readonly inactivityMs: number
  private readonly now: () => number
  private state: SessionState | null = null

  constructor(options: SessionManagerOptions) {
    this.storage = options.storage
    this.inactivityMs = options.inactivityMs ?? DEFAULT_INACTIVITY_MS
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Returns the live session, creating or rotating it as needed.
   *
   * A stored session is reused only while it is inside the inactivity window.
   * A timestamp in the future is treated as expired: a clock that moved
   * backwards would otherwise pin a session open indefinitely.
   */
  current(): SessionState {
    const now = this.now()
    const stored =
      this.state ?? readJson<SessionState>(this.storage, SESSION_STORAGE_KEY)

    if (stored && this.isLive(stored, now)) {
      this.state = { ...stored, lastActivityAt: now }
      this.persist()
      return this.state
    }

    this.state = {
      sessionId: randomId("ses"),
      createdAt: now,
      lastActivityAt: now,
      startedEmitted: false,
    }
    this.persist()
    return this.state
  }

  private isLive(state: SessionState, now: number): boolean {
    if (
      typeof state.sessionId !== "string" ||
      typeof state.lastActivityAt !== "number" ||
      Number.isNaN(state.lastActivityAt)
    ) {
      return false
    }

    const idleFor = now - state.lastActivityAt

    // Negative means the stored time is in the future: a clock change, not a
    // live session.
    return idleFor >= 0 && idleFor <= this.inactivityMs
  }

  /**
   * Marks `session_started` as emitted.
   *
   * Recorded before the network call rather than after, so a failed send never
   * produces a second `session_started` for the same session.
   */
  markStartedEmitted(): void {
    const state = this.current()
    this.state = { ...state, startedEmitted: true }
    this.persist()
  }

  private persist(): void {
    if (this.state) {
      writeJson(this.storage, SESSION_STORAGE_KEY, this.state)
    }
  }
}
