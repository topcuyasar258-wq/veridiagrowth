# Outbox Worker

Worker endpoint:

```text
POST /api/internal/workers/outbox
Authorization: Bearer VERIDIA_WORKER_SECRET
```

The endpoint is internal-only, returns aggregate counts, and never includes lead PII, provider responses, recipient email, or payload bodies.

Claiming uses `claim_outbox_events(worker_id, batch_size, lock_timeout_seconds)` with `FOR UPDATE SKIP LOCKED`.

State machine:

```text
pending -> processing -> completed
pending -> processing -> pending
pending -> processing -> dead_letter
```

`processing` jobs with stale `locked_at` older than `VERIDIA_OUTBOX_LOCK_TIMEOUT_SECONDS` can be reclaimed. Handlers remain idempotent because a stale worker may have produced a side effect before crashing.

Worker IDs are generated as `hostname/process/random-id` and contain no PII.
