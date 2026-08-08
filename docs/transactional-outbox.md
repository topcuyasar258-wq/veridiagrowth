# Transactional Outbox

`outbox_events` stores pending backend work but no worker is implemented in 02B.

Created jobs for each accepted lead:

- `notify-business:{lead_id}`
- `update-metrics:{lead_id}`

Payload is intentionally minimal:

```json
{
  "leadId": "uuid",
  "organizationId": "uuid",
  "siteId": "uuid"
}
```

The payload must not copy phone, email, message, HMAC headers, Turnstile token, nonce, signature, raw request body, or IP.

`complete_lead_ingestion` is the transaction boundary. It atomically creates:

- lead
- attribution
- initial status history
- internal `lead_created` domain event
- outbox jobs
- idempotency completion
- audit/security telemetry

If any insert fails, the PostgreSQL function aborts and no partial lead state remains.
