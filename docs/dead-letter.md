# Dead Letter

`dead_letter_events` records exhausted or non-retryable jobs.

Payload reference is minimal:

```json
{
  "leadId": "uuid",
  "siteId": "uuid"
}
```

No phone, email, message, provider response, signature, token, or raw body is stored.

Backend operations:

- `requeueDeadLetter()` moves the original outbox event back to `pending`.
- `resolveDeadLetter()` marks the dead-letter record resolved with a bounded note.

Attempt history remains in `job_executions`; requeue does not erase prior attempts.
