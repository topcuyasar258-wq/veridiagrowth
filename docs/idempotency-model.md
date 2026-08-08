# Idempotency Model

`idempotency_records` stores only hashed idempotency keys:

- `site_id`
- `idempotency_key_hash`
- `request_hash`
- `status`: `processing`, `completed`, or `failed`
- minimal safe response metadata
- `locked_until`
- `expires_at`

The unique index on `(site_id, idempotency_key_hash)` makes claim creation atomic.

Behavior:

- Same key and same request body can replay a completed safe response.
- Same key with a different request body is a conflict.
- Concurrent identical requests race on the unique key; one starts processing, the other observes processing.
- `locked_until` lets a backend recover records that are stuck in processing.
- `response_body` must not contain PII; store only minimal safe fields such as resource ids and coarse status.

Cleanup worker is intentionally not implemented in 02A. `expires_at` and related indexes are ready for a later batch cleanup task.
