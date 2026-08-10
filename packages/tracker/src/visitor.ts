/**
 * Persistent visitor identity, scoped to a single site.
 *
 * A session id answers "is this the same visit"; this answers "is this the same
 * browser as last week", which is what an audience for remarketing needs.
 *
 * Two properties keep it from becoming a cross-site profile:
 *
 * 1. `localStorage` is origin-scoped, so a value written on one customer's site
 *    is unreadable on another's. This is a property of the browser, not a
 *    promise made by this code.
 * 2. The storage key carries the site key, so even two sites sharing one origin
 *    hold separate identities.
 *
 * Together those mean a Veridia-wide visitor graph cannot happen by accident.
 * Building one would take a deliberate new mechanism, which is the point: it
 * stays a decision somebody makes on purpose, in the open.
 *
 * The identifier is random. It is not derived from anything about the device,
 * so it carries no information on its own and cannot be recomputed after it is
 * cleared -- unlike a fingerprint, which returns whether the visitor wants it
 * to or not.
 */

import { randomId } from "./session"
import { type TrackerStorage } from "./storage"

export const VISITOR_STORAGE_PREFIX = "veridia.visitor.v1"

/** Namespaced per site so one origin can host two sites without merging them. */
export function visitorStorageKey(siteKey: string): string {
  return `${VISITOR_STORAGE_PREFIX}.${siteKey}`
}

export interface VisitorManagerOptions {
  storage: TrackerStorage
  siteKey: string
}

export class VisitorManager {
  private readonly storage: TrackerStorage
  private readonly key: string

  constructor(options: VisitorManagerOptions) {
    this.storage = options.storage
    this.key = visitorStorageKey(options.siteKey)
  }

  /**
   * Returns the stored identity, creating one on first call.
   *
   * Only ever called once marketing consent is confirmed, so reaching this
   * function is itself the consent decision; it does not re-check.
   */
  ensure(): string | null {
    // Private-mode and quota failures fall back to in-memory storage, where a
    // "persistent" identity would be new on every page load -- a stream of
    // one-visit strangers that would quietly corrupt any audience built from
    // it. Better to send nothing and let the row be honestly anonymous.
    if (!this.storage.persistent) {
      return null
    }

    const existing = this.storage.read(this.key)

    if (existing) {
      return existing
    }

    const created = randomId("vis")
    this.storage.write(this.key, created)

    // Confirmed by reading back: `write` swallows quota errors by design.
    return this.storage.read(this.key) === created ? created : null
  }

  /** Reads without creating, for the case where consent has not been given. */
  peek(): string | null {
    return this.storage.read(this.key)
  }

  /** Erases the identity. Called when marketing consent is withdrawn. */
  clear(): void {
    this.storage.remove(this.key)
  }
}
