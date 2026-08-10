import {
  applyTouch,
  type AttributionState,
  type AttributionTouch,
} from "@veridia/shared"

import {
  readClickIds,
  readUtm,
  safeReferrer,
  type ClickIdValues,
  type UtmValues,
} from "./sanitize"
import { readJson, writeJson, type TrackerStorage } from "./storage"

/**
 * Browser-side attribution state.
 *
 * The merge rules come from `@veridia/shared` `applyTouch`, the same function
 * Phase 1 lead attribution uses. A second implementation here would drift and
 * make a lead and the interactions preceding it disagree about the same visit.
 *
 * The browser never sends `sourceCategory`. It reports the touch it observed;
 * the collector derives the category server side, because a client that could
 * assert its own category could relabel paid traffic as organic.
 */

export const ATTRIBUTION_STORAGE_KEY = "veridia.attribution.v1"

export interface StoredAttribution extends AttributionState {
  expiresAt: number
  /**
   * Advertising click ids, stored alongside attribution so they share its
   * expiry. Only ever written under marketing consent, and absent otherwise.
   */
  clickIds?: ClickIdValues
}

export interface AttributionManagerOptions {
  storage: TrackerStorage
  windowMs?: number
  now?: () => number
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export class AttributionManager {
  private readonly storage: TrackerStorage
  private readonly windowMs: number
  private readonly now: () => number

  constructor(options: AttributionManagerOptions) {
    this.storage = options.storage
    this.windowMs = options.windowMs ?? THIRTY_DAYS_MS
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Folds the current page's referrer and UTM parameters into stored state.
   *
   * Called once per page load and again on SPA navigation, so a campaign click
   * mid-session is recorded even without a full page load.
   */
  observe(
    href: string,
    referrer: string,
    options: { captureClickIds?: boolean } = {},
  ): StoredAttribution {
    const now = this.now()
    const stored = this.read(now)

    const utm = readUtm(href)
    const referrerOrigin = referrer ? safeReferrer(referrer) : null

    // Last touch wins, matching the UTM rule: a visitor who arrives again on a
    // new ad click should be attributed to that click, not the first one. A
    // page load carrying no click id leaves the stored one alone -- otherwise
    // navigating to a second page would erase the ad click that brought them.
    const clickIds = options.captureClickIds
      ? { ...(stored.clickIds ?? {}), ...readClickIds(href) }
      : stored.clickIds

    // A page load with neither UTM nor referrer is a direct touch, which by
    // contract cannot overwrite an existing non-direct source.
    const touch: AttributionTouch = {
      source: utm.utm_source ?? null,
      medium: utm.utm_medium ?? null,
      campaign: utm.utm_campaign ?? null,
      term: utm.utm_term ?? null,
      content: utm.utm_content ?? null,
      referrerHost: referrerOrigin ? hostOf(referrerOrigin) : null,
      occurredAt: new Date(now).toISOString(),
    }

    const merged = applyTouch(stored, touch, new Date(now))
    const next: StoredAttribution = {
      ...merged,
      expiresAt: now + this.windowMs,
      ...(clickIds && Object.keys(clickIds).length > 0 ? { clickIds } : {}),
    }

    writeJson(this.storage, ATTRIBUTION_STORAGE_KEY, next)
    return next
  }

  /** The click ids to attach to an outgoing event, empty when none are stored. */
  currentClickIds(): ClickIdValues {
    return this.read(this.now()).clickIds ?? {}
  }

  /**
   * Drops stored click ids while keeping ordinary attribution.
   *
   * Called when marketing consent is withdrawn: the campaign labels a site
   * operator chose stay, the advertising identifiers do not.
   */
  clearClickIds(): void {
    const state = this.read(this.now())

    if (!state.clickIds) {
      return
    }

    const next: StoredAttribution = {
      firstTouch: state.firstTouch,
      lastTouch: state.lastTouch,
      expiresAt: state.expiresAt,
    }

    writeJson(this.storage, ATTRIBUTION_STORAGE_KEY, next)
  }

  /** The UTM values to attach to an outgoing event: last touch wins. */
  currentUtm(): UtmValues {
    const state = this.read(this.now())
    const effective = state.lastTouch ?? state.firstTouch

    if (!effective) {
      return {}
    }

    const values: UtmValues = {}
    if (effective.source) values.utm_source = effective.source
    if (effective.medium) values.utm_medium = effective.medium
    if (effective.campaign) values.utm_campaign = effective.campaign
    if (effective.term) values.utm_term = effective.term
    if (effective.content) values.utm_content = effective.content
    return values
  }

  /** Expired state is discarded whole, so touches never mix across windows. */
  private read(now: number): StoredAttribution {
    const stored = readJson<StoredAttribution>(
      this.storage,
      ATTRIBUTION_STORAGE_KEY,
    )

    if (
      !stored ||
      typeof stored.expiresAt !== "number" ||
      stored.expiresAt <= now
    ) {
      return {
        firstTouch: null,
        lastTouch: null,
        expiresAt: now + this.windowMs,
      }
    }

    return stored
  }
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase()
  } catch {
    return null
  }
}
