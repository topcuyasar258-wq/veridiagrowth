import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { Database } from "@veridia/database"

import {
  RETENTION_MAX_BATCHES,
  runAnomalyDetection,
  runMaintenance,
  runRetentionSweep,
} from "../../apps/dashboard/src/server/tracker-operations/maintenance"

function client(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient<Database>
}

function sweepRow(counts: Partial<Record<string, number>> = {}) {
  return {
    data: [
      {
        deleted_accepted: counts.accepted ?? 0,
        deleted_suspicious: counts.suspicious ?? 0,
        deleted_quarantined: counts.quarantined ?? 0,
        deleted_quota_buckets: counts.quota ?? 0,
      },
    ],
    error: null,
  }
}

describe("runRetentionSweep", () => {
  it("stops as soon as a batch deletes nothing", async () => {
    const rpc = vi.fn(async () => sweepRow())
    const summary = await runRetentionSweep(client(rpc))

    expect(rpc).toHaveBeenCalledOnce()
    expect(summary.batches).toBe(1)
    expect(summary.deletedAccepted).toBe(0)
  })

  it("keeps going while rows are still being removed", async () => {
    let call = 0
    const rpc = vi.fn(async () => {
      call += 1
      return call <= 3 ? sweepRow({ accepted: 500 }) : sweepRow()
    })

    const summary = await runRetentionSweep(client(rpc))

    expect(summary.batches).toBe(4)
    expect(summary.deletedAccepted).toBe(1500)
  })

  it("never loops without bound", async () => {
    // A backlog larger than one invocation is drained across runs rather than
    // in one long transaction holding locks against a live public endpoint.
    const rpc = vi.fn(async () => sweepRow({ accepted: 500 }))
    const summary = await runRetentionSweep(client(rpc))

    expect(summary.batches).toBe(RETENTION_MAX_BATCHES)
    expect(rpc).toHaveBeenCalledTimes(RETENTION_MAX_BATCHES)
  })

  it("respects an explicit batch cap", async () => {
    const rpc = vi.fn(async () => sweepRow({ quarantined: 10 }))
    const summary = await runRetentionSweep(client(rpc), { maxBatches: 3 })

    expect(summary.batches).toBe(3)
    expect(summary.deletedQuarantined).toBe(30)
  })

  it("passes the configured batch size to the database", async () => {
    const rpc = vi.fn(async () => sweepRow())
    await runRetentionSweep(client(rpc), { batchSize: 250 })

    expect(rpc).toHaveBeenCalledWith("sweep_expired_interactions", {
      batch_limit: 250,
    })
  })

  it("stops rather than retrying when the sweep errors", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }))
    const summary = await runRetentionSweep(client(rpc))

    expect(rpc).toHaveBeenCalledOnce()
    expect(summary.batches).toBe(0)
  })

  it("reports counts and duration only", async () => {
    const rpc = vi.fn(async () => sweepRow())
    const summary = await runRetentionSweep(client(rpc))

    // Nothing here may carry an event payload or an identifier.
    expect(Object.keys(summary).sort()).toEqual([
      "batches",
      "deletedAccepted",
      "deletedQuarantined",
      "deletedQuotaBuckets",
      "deletedSuspicious",
      "durationMs",
    ])
  })
})

describe("runAnomalyDetection", () => {
  it("returns the number of anomalies written", async () => {
    const rpc = vi.fn(async () => ({ data: 3, error: null }))
    await expect(runAnomalyDetection(client(rpc))).resolves.toBe(3)
  })

  it("reports zero rather than throwing on failure", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "x" } }))
    await expect(runAnomalyDetection(client(rpc))).resolves.toBe(0)
  })

  it("uses a minimum sample so a quiet site cannot produce a false spike", async () => {
    const rpc = vi.fn(async () => ({ data: 0, error: null }))
    await runAnomalyDetection(client(rpc))

    const args = rpc.mock.calls[0][1] as Record<string, number>
    expect(args.min_sample).toBeGreaterThanOrEqual(20)
    expect(args.spike_multiplier).toBeGreaterThan(1)
  })
})

describe("runMaintenance", () => {
  it("sweeps before detecting, so anomalies see current data", async () => {
    const order: string[] = []
    const rpc = vi.fn(async (name: string) => {
      order.push(name)
      return name === "sweep_expired_interactions"
        ? sweepRow()
        : { data: 1, error: null }
    })

    const summary = await runMaintenance(client(rpc))

    expect(order[0]).toBe("sweep_expired_interactions")
    expect(order.at(-1)).toBe("detect_event_anomalies")
    expect(summary.anomaliesDetected).toBe(1)
  })
})
