import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"

import { collectorConfig, type QuotaScope } from "./config"

/**
 * Quota consumption.
 *
 * Counting happens in a single atomic statement inside `consume_event_quota`.
 * The obvious shape -- read the counter, decide, then write -- loses under
 * concurrency: twenty parallel requests all read the same value and all decide
 * they are under the limit.
 *
 * Exceeding a limit is graded rather than binary. Going slightly over raises the
 * risk score; going far over refuses the request outright. A busy real site
 * must not lose visitors to a threshold, but a scripted flood must not be able
 * to grow the database without bound.
 */

export interface QuotaOutcome {
  scope: QuotaScope
  allowed: boolean
  hardExceeded: boolean
  currentCount: number
  limit: number
}

export async function consumeQuota(
  client: SupabaseClient<Database>,
  input: {
    organizationId: string
    siteId: string
    scope: QuotaScope
    scopeKey: string
    increment: number
  },
): Promise<QuotaOutcome> {
  const config = collectorConfig.quotas[input.scope]

  const { data, error } = await client.rpc("consume_event_quota", {
    target_organization_id: input.organizationId,
    target_site_id: input.siteId,
    quota_scope: input.scope,
    quota_scope_key: input.scopeKey,
    quota_window_seconds: config.windowSeconds,
    quota_limit: config.max,
    increment_by: input.increment,
  })

  if (error) {
    // Fail open on a counter failure. Losing real interactions because a quota
    // row could not be written is worse than briefly not enforcing a limit, and
    // the risk engine still sees every other signal.
    return {
      scope: input.scope,
      allowed: true,
      hardExceeded: false,
      currentCount: 0,
      limit: config.max,
    }
  }

  const row = Array.isArray(data) ? data[0] : data
  const currentCount = row?.current_count ?? 0

  return {
    scope: input.scope,
    allowed: row?.allowed ?? true,
    hardExceeded: currentCount > config.max * collectorConfig.hardMultiplier,
    currentCount,
    limit: config.max,
  }
}

export function elevatedScopes(
  outcomes: readonly QuotaOutcome[],
): QuotaScope[] {
  return outcomes.filter((outcome) => !outcome.allowed).map((o) => o.scope)
}

export function anyHardExceeded(outcomes: readonly QuotaOutcome[]): boolean {
  return outcomes.some((outcome) => outcome.hardExceeded)
}
