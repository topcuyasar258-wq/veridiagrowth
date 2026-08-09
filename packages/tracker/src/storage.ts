/**
 * First-party storage with a memory fallback.
 *
 * Every access is guarded. `localStorage` throws rather than returning null in
 * several real situations -- Safari private mode, disabled site data, quota
 * exhaustion, and cross-origin iframe access -- and an unguarded read is a
 * genuine way an analytics script takes a customer's page down.
 *
 * When storage is unavailable the tracker keeps working in memory. Analytics is
 * then less accurate across page loads; the customer's site is unaffected. That
 * is the correct trade in both directions.
 */

export interface TrackerStorage {
  read(key: string): string | null
  write(key: string, value: string): void
  remove(key: string): void
  readonly persistent: boolean
}

function createMemoryStorage(): TrackerStorage {
  const map = new Map<string, string>()

  return {
    read: (key) => map.get(key) ?? null,
    write: (key, value) => {
      map.set(key, value)
    },
    remove: (key) => {
      map.delete(key)
    },
    persistent: false,
  }
}

/**
 * Probes localStorage with a real write.
 *
 * Feature detection by `typeof localStorage` is not enough: Safari private mode
 * exposes the object and throws on write.
 */
function localStorageUsable(): boolean {
  try {
    const probe = "__veridia_probe__"
    window.localStorage.setItem(probe, "1")
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export function createStorage(): TrackerStorage {
  if (typeof window === "undefined" || !localStorageUsable()) {
    return createMemoryStorage()
  }

  const memory = createMemoryStorage()

  return {
    read: (key) => {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return memory.read(key)
      }
    },
    write: (key, value) => {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // Quota can be exhausted at any time, not only at startup.
        memory.write(key, value)
      }
    },
    remove: (key) => {
      try {
        window.localStorage.removeItem(key)
      } catch {
        memory.remove(key)
      }
    },
    persistent: true,
  }
}

/** Reads and parses JSON, treating any corruption as absent state. */
export function readJson<T>(storage: TrackerStorage, key: string): T | null {
  const raw = storage.read(key)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    // Corrupt state is discarded rather than repaired; the tracker rebuilds it.
    storage.remove(key)
    return null
  }
}

export function writeJson(
  storage: TrackerStorage,
  key: string,
  value: unknown,
): void {
  try {
    storage.write(key, JSON.stringify(value))
  } catch {
    // Serialization can fail on a circular structure. Losing one write is
    // acceptable; throwing into the customer's page is not.
  }
}
