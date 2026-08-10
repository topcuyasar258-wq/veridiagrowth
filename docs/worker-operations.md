# Worker Operations

Queue health service returns:

```ts
{
  pendingCount: number
  processingCount: number
  deadLetterCount: number
  oldestPendingAgeSeconds: number | null
}
```

Status thresholds:

- `ok`: oldest pending age <= 120 seconds
- `warning`: oldest pending age > 120 seconds
- `critical`: oldest pending age > 600 seconds or dead letters exist

Manual resend:

- creates a new manual `notify_business` outbox event
- does not mutate old delivery attempts
- writes `notification.manual_resend_requested`

Secrets:

- `VERIDIA_WORKER_SECRET` protects the internal worker endpoint
- `RESEND_API_KEY` is server-only
- neither secret may appear in client bundles, logs, or Sentry payloads

## Required in production

`POST /api/internal/workers/outbox` answers 503 in production unless both are
set:

| Variable                      | Why                                                              |
| ----------------------------- | ---------------------------------------------------------------- |
| `VERIDIA_EMAIL_FROM`          | otherwise mail is sent from an invalid domain                    |
| `VERIDIA_LEAD_PANEL_BASE_URL` | otherwise every notification links to a host that does not exist |

Refusing is deliberate. Running without them does not fail — it delivers, and
marks the outbox row delivered, so the notification is gone and nobody learns
the lead was missed. Refusing leaves the event queued, where the pending-age
thresholds above surface it. An empty value counts as unset.

Development and test may run degraded; only production is gated.

## Invocation

Both worker endpoints are `POST` with `Authorization: Bearer $VERIDIA_WORKER_SECRET`.
Nothing in this repository schedules them — a scheduler must call them.

Each invocation claims one batch (`VERIDIA_OUTBOX_BATCH_SIZE`, default 10) and
returns; it does not drain the queue. Sustained throughput is therefore batch
size × invocation frequency, which has to stay ahead of lead volume for the
pending age to stay inside the `ok` threshold above.
