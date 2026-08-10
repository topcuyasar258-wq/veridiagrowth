import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"
import {
  classifySourceCategory,
  MAX_CLOCK_SKEW_MS,
  MAX_EVENT_AGE_MS,
  validateInteractionBatch,
  type NormalizedInteractionEvent,
} from "@veridia/shared"

import { getRequestIp, hashIpForRisk } from "../security/request-ip"
import { collectorConfig } from "./config"
import { evaluateOrigin, type OriginEvaluation } from "./origin"
import { anyHardExceeded, consumeQuota, elevatedScopes } from "./rate-limit"
import { resolveSiteKey } from "./site-resolution"
import { evaluateInteractionRisk } from "./risk"

/**
 * Collector pipeline.
 *
 * Partial batches are not supported at the envelope level: if any event fails
 * schema validation the whole request is refused, because a tracker that emits
 * one malformed event is misconfigured and silently dropping it would hide
 * that. Once a batch is structurally valid, each event is decided and stored
 * independently, so one high-risk event does not discard its valid siblings.
 */

export interface CollectSummary {
  accepted: number
  duplicate: number
  quarantined: number
  rejected: number
}

export type CollectOutcome =
  | { status: 202; summary: CollectSummary; allowedOrigin: string | null }
  | { status: 400 | 404 | 413 | 429 | 500; error: string }

/** IP hashes are namespaced so a Phase 2 hash cannot be joined to a Phase 1 one. */
const EVENT_IP_PURPOSE = "veridia:event-ip:v1"

function classifyTimestamp(
  occurredAt: string,
  now: Date,
): "ok" | "future" | "stale" {
  const delta = now.getTime() - Date.parse(occurredAt)

  if (delta < -MAX_CLOCK_SKEW_MS) return "future"
  if (delta > MAX_EVENT_AGE_MS) return "stale"
  return "ok"
}

export async function handleCollectRequest(input: {
  client: SupabaseClient<Database>
  request: Request
  rawBodyText: string
  now?: Date
}): Promise<CollectOutcome> {
  const now = input.now ?? new Date()

  let parsed: unknown
  try {
    parsed = JSON.parse(input.rawBodyText)
  } catch {
    return { status: 400, error: "invalid_request" }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { status: 400, error: "invalid_request" }
  }

  const envelope = parsed as Record<string, unknown>

  // Site resolution happens before schema validation so an unknown key costs a
  // single query rather than full validation of an arbitrary payload.
  const resolution = await resolveSiteKey(input.client, envelope.siteKey)

  if (!resolution.ok) {
    // Malformed, unknown, revoked and paused all answer identically: telling
    // them apart would let a caller enumerate which sites exist.
    return { status: 404, error: "invalid_request" }
  }

  const { organizationId, siteId, allowedDomains } = resolution.site

  const batch = validateInteractionBatch(
    { schemaVersion: envelope.schemaVersion, events: envelope.events },
    { now },
  )

  if (!batch.ok) {
    return { status: 400, error: "invalid_request" }
  }

  const { events, droppedDuplicateIds } = batch.value

  const origin: OriginEvaluation = evaluateOrigin(
    {
      origin: input.request.headers.get("origin"),
      referer: input.request.headers.get("referer"),
    },
    allowedDomains,
  )

  const userAgentPresent = Boolean(input.request.headers.get("user-agent"))

  const rawIp = getRequestIp(input.request)
  const ipHash =
    rawIp && collectorConfig.eventIpRiskKey
      ? hashIpForRisk({
          ip: `${EVENT_IP_PURPOSE}:${rawIp}`,
          key: collectorConfig.eventIpRiskKey,
        })
      : null

  // Quotas are consumed once per request for the whole batch rather than per
  // event, so a 20 event batch costs four counter writes instead of eighty.
  const quotaOutcomes = [
    await consumeQuota(input.client, {
      organizationId,
      siteId,
      scope: "site",
      scopeKey: siteId,
      increment: events.length,
    }),
    ...(ipHash
      ? [
          await consumeQuota(input.client, {
            organizationId,
            siteId,
            scope: "site_ip",
            scopeKey: ipHash,
            increment: events.length,
          }),
        ]
      : []),
    await consumeQuota(input.client, {
      organizationId,
      siteId,
      scope: "session",
      scopeKey: events[0].sessionId,
      increment: events.length,
    }),
    await consumeQuota(input.client, {
      organizationId,
      siteId,
      scope: "event_type",
      scopeKey: events[0].eventType,
      increment: events.length,
    }),
  ]

  if (anyHardExceeded(quotaOutcomes)) {
    return { status: 429, error: "rate_limited" }
  }

  const elevated = elevatedScopes(quotaOutcomes)

  const summary: CollectSummary = {
    accepted: 0,
    duplicate: droppedDuplicateIds.length,
    quarantined: 0,
    rejected: 0,
  }

  const sessionStartSeen = events.some(
    (event) => event.eventType === "session_started",
  )

  for (const event of events) {
    const outcome = await storeEvent({
      client: input.client,
      siteId,
      event,
      origin,
      elevated,
      userAgentPresent,
      sessionStartSeen,
      now,
    })

    summary[outcome] += 1
  }

  await input.client.rpc("touch_site_tracker_deployment", {
    target_site_id: siteId,
    in_tracker_version: events[0].trackerVersion,
    in_integration_version: events[0].integrationVersion,
    throttle_seconds: 300,
  })

  return {
    status: 202,
    summary,
    allowedOrigin:
      origin.origin === "match" ? input.request.headers.get("origin") : null,
  }
}

async function storeEvent(input: {
  client: SupabaseClient<Database>
  siteId: string
  event: NormalizedInteractionEvent
  origin: OriginEvaluation
  elevated: ReturnType<typeof elevatedScopes>
  userAgentPresent: boolean
  sessionStartSeen: boolean
  now: Date
}): Promise<keyof CollectSummary> {
  const { event } = input

  const risk = evaluateInteractionRisk({
    origin: input.origin,
    elevatedQuotas: input.elevated,
    duplicateEventId: false,
    timestamp: classifyTimestamp(event.occurredAt, input.now),
    sequenceUnexpected:
      event.eventType !== "session_started" && !input.sessionStartSeen,
    userAgentPresent: input.userAgentPresent,
  })

  // Source category is always derived server side. A client that could assert
  // its own category could relabel paid traffic as organic.
  const sourceCategory = classifySourceCategory({
    utmSource: event.utm.utm_source,
    utmMedium: event.utm.utm_medium,
    referrer: event.referrerHost,
  })

  const { data, error } = await input.client.rpc("ingest_interaction_event", {
    target_site_id: input.siteId,
    in_event_id: event.eventId,
    in_event_type: event.eventType,
    in_session_id: event.sessionId,
    in_occurred_at: event.occurredAt,
    in_page_host: event.pageHost,
    in_page_path: event.pagePath,
    in_referrer_host: event.referrerHost,
    in_source_category: sourceCategory,
    in_utm_source: event.utm.utm_source,
    in_utm_medium: event.utm.utm_medium,
    in_utm_campaign: event.utm.utm_campaign,
    in_utm_term: event.utm.utm_term,
    in_utm_content: event.utm.utm_content,
    in_tracker_version: event.trackerVersion,
    in_integration_version: event.integrationVersion,
    in_decision: risk.decision,
    in_risk_score: risk.score,
    in_reason_codes: risk.reasonCodes,
    // Present only when the tracker had marketing consent. The RPC stores them
    // on accepted events only; a quarantined event never enters an audience.
    in_visitor_id: event.visitorId,
    in_gclid: event.clickIds.gclid,
    in_gbraid: event.clickIds.gbraid,
    in_wbraid: event.clickIds.wbraid,
    in_fbclid: event.clickIds.fbclid,
  })

  if (error) {
    // A storage failure is counted as rejected rather than surfaced. The tracker
    // cannot act on the difference, and the page must keep working regardless.
    return "rejected"
  }

  switch (data) {
    case "accepted":
    case "suspicious":
      return "accepted"
    case "duplicate":
      return "duplicate"
    case "quarantined":
      return "quarantined"
    default:
      return "rejected"
  }
}
