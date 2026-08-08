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
