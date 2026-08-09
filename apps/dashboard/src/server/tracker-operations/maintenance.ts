import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"

/**
 * Interaction maintenance: retention sweep and anomaly detection.
 *
 * Both run behind the internal worker endpoint, never as a public RPC. Neither
 * reads or writes personal data, and neither is reachable by a customer session.
 */

export interface RetentionSummary {
  deletedAccepted: number
  deletedSuspicious: number
  deletedQuarantined: number
  deletedQuotaBuckets: number
  batches: number
  durationMs: number
}

export interface MaintenanceSummary {
  retention: RetentionSummary
  anomaliesDetected: number
  durationMs: number
}

/** Batch size and loop cap, so one invocation can never run unbounded. */
export const RETENTION_BATCH_SIZE = 500
export const RETENTION_MAX_BATCHES = 40

/**
 * Sweeps expired interactions in bounded batches until nothing is left or the
 * batch cap is reached.
 *
 * Looping rather than issuing one large DELETE matters because this table is
 * written by a public endpoint: a long-running delete holds locks for its whole
 * duration and would show up as collector latency.
 *
 * Stopping at the cap is deliberate. The next invocation continues where this
 * one left off, so a large backlog is drained across runs rather than in one
 * long transaction.
 */
export async function runRetentionSweep(
  client: SupabaseClient<Database>,
  options: { batchSize?: number; maxBatches?: number } = {},
): Promise<RetentionSummary> {
  const batchSize = options.batchSize ?? RETENTION_BATCH_SIZE
  const maxBatches = options.maxBatches ?? RETENTION_MAX_BATCHES
  const startedAt = Date.now()

  const summary: RetentionSummary = {
    deletedAccepted: 0,
    deletedSuspicious: 0,
    deletedQuarantined: 0,
    deletedQuotaBuckets: 0,
    batches: 0,
    durationMs: 0,
  }

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const { data, error } = await client.rpc("sweep_expired_interactions", {
      batch_limit: batchSize,
    })

    if (error) {
      break
    }

    const row = Array.isArray(data) ? data[0] : data

    if (!row) {
      break
    }

    const removed =
      (row.deleted_accepted ?? 0) +
      (row.deleted_suspicious ?? 0) +
      (row.deleted_quarantined ?? 0) +
      (row.deleted_quota_buckets ?? 0)

    summary.deletedAccepted += row.deleted_accepted ?? 0
    summary.deletedSuspicious += row.deleted_suspicious ?? 0
    summary.deletedQuarantined += row.deleted_quarantined ?? 0
    summary.deletedQuotaBuckets += row.deleted_quota_buckets ?? 0
    summary.batches += 1

    if (removed === 0) {
      break
    }
  }

  summary.durationMs = Date.now() - startedAt
  return summary
}

export async function runAnomalyDetection(
  client: SupabaseClient<Database>,
): Promise<number> {
  const { data, error } = await client.rpc("detect_event_anomalies", {
    window_minutes: 5,
    baseline_windows: 12,
    min_sample: 20,
    spike_multiplier: 3.0,
    rate_threshold: 0.3,
  })

  return error ? 0 : (data ?? 0)
}

export async function runMaintenance(
  client: SupabaseClient<Database>,
): Promise<MaintenanceSummary> {
  const startedAt = Date.now()

  const retention = await runRetentionSweep(client)
  const anomaliesDetected = await runAnomalyDetection(client)

  return {
    retention,
    anomaliesDetected,
    durationMs: Date.now() - startedAt,
  }
}
