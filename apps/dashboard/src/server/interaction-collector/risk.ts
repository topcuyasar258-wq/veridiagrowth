/**
 * Deterministic interaction risk scoring.
 *
 * Public browser analytics is trivially forgeable, so this is a filter for
 * obviously bad data, not an authentication mechanism. It is a pure function of
 * its input: no clock, no network, no randomness, so the same input always
 * produces the same decision and the boundaries can be pinned by tests.
 *
 * No fingerprinting and no machine learning. Both are out of scope by design:
 * fingerprinting is a privacy boundary this product does not cross, and an
 * opaque model cannot be explained to a customer whose traffic it filtered.
 */

import type { OriginEvaluation } from "./origin"

export type RiskSignal =
  | "origin_missing"
  | "origin_mismatch"
  | "origin_invalid"
  | "referer_mismatch"
  | "site_rate_elevated"
  | "site_ip_rate_elevated"
  | "session_rate_elevated"
  | "event_type_rate_elevated"
  | "duplicate_event_id"
  | "future_timestamp"
  | "stale_timestamp"
  | "invalid_sequence"
  | "user_agent_missing"

export type RiskDecision =
  "accepted" | "suspicious" | "quarantined" | "rejected"

/**
 * Weights are centralized so the whole model is readable in one place.
 *
 * Calibration notes:
 * - `origin_mismatch` alone reaches the quarantine band. An event claiming to
 *   come from a site whose origin does not match any configured domain is not
 *   usable data, but it is held rather than discarded in case the cause is a
 *   domain that was never configured.
 * - Rate signals are deliberately below the suspicious band individually. A
 *   real visitor on a busy site must never be filtered for being one of many.
 *   This matters most for `site_ip`: corporate networks, mobile carrier NAT and
 *   shared exits put many genuine visitors behind one address, so an IP-derived
 *   signal is the likeliest to catch innocent traffic and must never decide an
 *   event alone.
 * - `duplicate_event_id` is near zero: duplicate delivery is normal transport
 *   behaviour for `sendBeacon`, not evidence of abuse.
 */
export const RISK_WEIGHTS: Record<RiskSignal, number> = {
  origin_missing: 15,
  origin_mismatch: 60,
  origin_invalid: 55,
  referer_mismatch: 10,
  site_rate_elevated: 20,
  site_ip_rate_elevated: 25,
  session_rate_elevated: 25,
  event_type_rate_elevated: 20,
  duplicate_event_id: 5,
  future_timestamp: 20,
  stale_timestamp: 15,
  invalid_sequence: 10,
  user_agent_missing: 15,
}

export const RISK_BANDS = {
  acceptedMax: 29,
  suspiciousMax: 59,
  quarantineMax: 79,
} as const

export interface RiskInput {
  origin: OriginEvaluation
  /** Quota scopes whose current window is already over its configured limit. */
  elevatedQuotas: readonly ("site" | "site_ip" | "session" | "event_type")[]
  duplicateEventId: boolean
  timestamp: "ok" | "future" | "stale"
  /**
   * True when an interaction arrives for a session that has no `session_started`
   * yet. Only a weak signal: a beacon carrying the session start can legitimately
   * be lost or arrive out of order, so this must never decide an event alone.
   */
  sequenceUnexpected: boolean
  userAgentPresent: boolean
}

export interface RiskResult {
  score: number
  decision: RiskDecision
  reasonCodes: RiskSignal[]
}

export function decisionForScore(score: number): RiskDecision {
  if (score <= RISK_BANDS.acceptedMax) return "accepted"
  if (score <= RISK_BANDS.suspiciousMax) return "suspicious"
  if (score <= RISK_BANDS.quarantineMax) return "quarantined"
  return "rejected"
}

export function evaluateInteractionRisk(input: RiskInput): RiskResult {
  const reasonCodes: RiskSignal[] = []

  if (input.origin.origin === "missing") reasonCodes.push("origin_missing")
  if (input.origin.origin === "mismatch") reasonCodes.push("origin_mismatch")
  if (input.origin.origin === "invalid") reasonCodes.push("origin_invalid")

  // A referer mismatch only adds signal when the origin did not already settle
  // the question, so one underlying cause is not counted twice.
  if (
    input.origin.referer === "mismatch" &&
    input.origin.origin !== "mismatch" &&
    input.origin.origin !== "invalid"
  ) {
    reasonCodes.push("referer_mismatch")
  }

  for (const scope of input.elevatedQuotas) {
    reasonCodes.push(`${scope}_rate_elevated` as RiskSignal)
  }

  if (input.duplicateEventId) reasonCodes.push("duplicate_event_id")
  if (input.timestamp === "future") reasonCodes.push("future_timestamp")
  if (input.timestamp === "stale") reasonCodes.push("stale_timestamp")
  if (input.sequenceUnexpected) reasonCodes.push("invalid_sequence")
  if (!input.userAgentPresent) reasonCodes.push("user_agent_missing")

  const rawScore = reasonCodes.reduce(
    (total, code) => total + RISK_WEIGHTS[code],
    0,
  )
  const score = Math.min(100, Math.max(0, rawScore))

  // Highest-weight signal first, so the primary quarantine reason is the one
  // that actually drove the decision.
  reasonCodes.sort((a, b) => RISK_WEIGHTS[b] - RISK_WEIGHTS[a])

  return { score, decision: decisionForScore(score), reasonCodes }
}
