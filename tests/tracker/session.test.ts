import { beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_INACTIVITY_MS,
  SessionManager,
  randomId,
} from "../../packages/tracker/src/session"
import { createStorage } from "../../packages/tracker/src/storage"
import type { TrackerStorage } from "../../packages/tracker/src/storage"

function memoryStorage(): TrackerStorage {
  const map = new Map<string, string>()
  return {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => {
      map.set(k, v)
    },
    remove: (k) => {
      map.delete(k)
    },
    persistent: true,
  }
}

describe("randomId", () => {
  it("produces ids that satisfy the collector contract", () => {
    // ^[A-Za-z0-9_-]{16,64}$ -- a rejected id would silently lose every event.
    const pattern = /^[A-Za-z0-9_-]{16,64}$/
    for (let i = 0; i < 50; i += 1) {
      expect(randomId("evt")).toMatch(pattern)
    }
  })

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomId("ses")))
    expect(ids.size).toBe(500)
  })

  it("refuses to invent an id without a secure random source", () => {
    // Predictable ids would let anyone forge or collide another visitor's
    // session, so a weak fallback is worse than no tracking.
    const original = globalThis.crypto
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    })

    expect(() => randomId("evt")).toThrow(/secure random/)

    Object.defineProperty(globalThis, "crypto", {
      value: original,
      configurable: true,
    })
  })
})

describe("SessionManager", () => {
  let clock: number
  let storage: TrackerStorage

  beforeEach(() => {
    clock = 1_800_000_000_000
    storage = memoryStorage()
  })

  const manager = () => new SessionManager({ storage, now: () => clock })

  it("creates a session on first use", () => {
    const session = manager().current()
    expect(session.sessionId).toMatch(/^ses_/)
    expect(session.startedEmitted).toBe(false)
  })

  it("reuses the session across reloads while storage survives", () => {
    const first = manager().current().sessionId
    clock += 60_000
    expect(manager().current().sessionId).toBe(first)
  })

  it("refreshes the timeout on activity", () => {
    const first = manager().current().sessionId

    // Active every 20 minutes for an hour: still one session.
    for (let i = 0; i < 3; i += 1) {
      clock += 20 * 60 * 1000
      expect(manager().current().sessionId).toBe(first)
    }
  })

  it("keeps the session at the edge of the inactivity window", () => {
    const first = manager().current().sessionId
    clock += DEFAULT_INACTIVITY_MS
    expect(manager().current().sessionId).toBe(first)
  })

  it("rotates the session after 31 minutes of inactivity", () => {
    const first = manager().current().sessionId
    clock += DEFAULT_INACTIVITY_MS + 60_000
    expect(manager().current().sessionId).not.toBe(first)
  })

  it("rotates when the stored timestamp is in the future", () => {
    // A clock that moved backwards would otherwise pin a session open forever.
    const first = manager().current().sessionId
    clock -= 60 * 60 * 1000
    expect(manager().current().sessionId).not.toBe(first)
  })

  it("recovers from corrupt stored state", () => {
    storage.write("veridia.session.v1", "{ not json")
    expect(manager().current().sessionId).toMatch(/^ses_/)
  })

  it("rebuilds when stored state is missing required fields", () => {
    storage.write("veridia.session.v1", JSON.stringify({ sessionId: 42 }))
    expect(manager().current().sessionId).toMatch(/^ses_/)
  })

  it("records session_started before any network call", () => {
    // Marked up front so a failed send cannot produce a second one.
    const subject = manager()
    expect(subject.current().startedEmitted).toBe(false)
    subject.markStartedEmitted()
    expect(manager().current().startedEmitted).toBe(true)
  })
})

describe("createStorage", () => {
  it("falls back to memory when localStorage is absent", () => {
    const storage = createStorage()
    storage.write("k", "v")
    expect(storage.read("k")).toBe("v")
  })

  it("never throws on a hostile localStorage", () => {
    // Safari private mode exposes the object and throws on write.
    const globalWithWindow = globalThis as unknown as { window?: unknown }
    const original = globalWithWindow.window

    globalWithWindow.window = {
      localStorage: {
        setItem() {
          throw new Error("SecurityError")
        },
        getItem() {
          throw new Error("SecurityError")
        },
        removeItem() {
          throw new Error("SecurityError")
        },
      },
    }

    const storage = createStorage()
    expect(() => storage.write("k", "v")).not.toThrow()
    expect(() => storage.read("k")).not.toThrow()
    expect(storage.persistent).toBe(false)

    globalWithWindow.window = original
  })
})
