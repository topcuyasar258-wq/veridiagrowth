# Interaction Retention

## Policy

| Data                    | Retention            |
| ----------------------- | -------------------- |
| accepted interactions   | 90 days              |
| suspicious interactions | 30 days              |
| quarantined events      | 30 days              |
| quota windows           | 2 windows past close |

`expires_at` is set by trigger on insert, so no row is ever written without a
deadline. The sweeper only reads that column.

## Mechanism

`sweep_expired_interactions(batch_limit)` — service-role only, never a public
RPC. Driven by `POST /api/v1/internal/workers/maintenance` behind the same
worker secret as the outbox worker.

### Bounded by design

Batches of 500, at most 40 batches per invocation.

A single unbounded `DELETE` holds locks for as long as it runs, and
`conversion_events` is written by a public endpoint — that would surface as
collector latency. Stopping at the cap is deliberate: the next run continues
where this one stopped, so a backlog drains across runs instead of in one long
transaction.

`FOR UPDATE SKIP LOCKED` means two concurrent sweeps do not block each other.

Repeated invocation is idempotent. A missed schedule costs a delay, nothing else.

## Safety

The only selector is `expires_at <= now()`. There is no tenant filter and no
other predicate, so the sweeper cannot delete a row that has not expired and
cannot single out a tenant.

Deleting a non-expired row is a P0. So is touching another tenant's data. Both
are asserted in `tracker_operations.test.sql`.

Quota rows use a different rule — two full windows past close — so a sweep can
never race a counter that is still being written.

Operational records (anomalies, releases, deployments, audit logs) are **not**
covered by interaction retention. They describe the system, not visitors.

## Orphans

`event_risk_assessments.conversion_event_id` is `ON DELETE CASCADE`, so an
assessment cannot outlive the interaction it explains. A dedicated assertion
looks for any assessment pointing at a missing row after a sweep.

## Telemetry

```json
{
  "retention": {
    "deletedAccepted": 0,
    "deletedSuspicious": 0,
    "deletedQuarantined": 0,
    "deletedQuotaBuckets": 0,
    "batches": 1,
    "durationMs": 12
  },
  "anomaliesDetected": 0
}
```

Counts and timings only. No event payload, no identifier, no tenant detail.

## Scheduling

Call the maintenance endpoint every few minutes. Frequency matters less than
regularity: each run is bounded, so a busy period simply takes more runs.
