# Phase 1 Acceptance Runbook

This runbook verifies the real Phase 1 chain:

```text
demo form/backend -> HMAC -> Lead API -> hosted Postgres -> outbox -> worker -> email -> dashboard workflow
```

Do not run it against production.

## 1. Configure Staging

1. Create or select the hosted staging Supabase project.
2. Apply migrations in order.
3. Configure staging dashboard deployment secrets from `docs/phase1-acceptance-environment.md`.
4. Configure Turnstile test/staging success and failure tokens.
5. Configure Resend with a controlled acceptance recipient.
6. Set a staging-only worker secret.

## 2. Preflight

```bash
npm run acceptance:phase1 -- preflight
```

Expected:

- staging guard passes
- Supabase service-role can read schema
- worker endpoint rejects missing authorization with `401`

## 3. Seed

```bash
npm run acceptance:phase1 -- seed
```

Expected:

- synthetic owner/agent/viewer users exist
- demo organization and site exist
- notification setting points to the controlled recipient
- one active site credential exists

If a new credential is created, the script prints:

```text
ACCEPTANCE_SITE_KEY_ID=...
ACCEPTANCE_SITE_SECRET=...
```

Store the secret only in the demo website backend environment. It is one-time output and is not recoverable from the database.

## 4. Submit Happy Path

Run through the demo website backend if available. The browser must post to the demo website backend, and the backend must sign the Veridia request.

For direct staging API acceptance:

```bash
ACCEPTANCE_SITE_SECRET=<one-time-secret> npm run acceptance:phase1 -- submit-happy
```

Expected:

- HTTP `201`
- response has `leadId`
- response has `duplicate`
- no PII/internal data in response

## 5. Security Requests

```bash
ACCEPTANCE_SITE_SECRET=<one-time-secret> npm run acceptance:phase1 -- submit-security
```

Minimum checks:

- invalid HMAC rejected
- expired timestamp rejected
- nonce replay rejected
- invalid Turnstile rejected
- honeypot rejected

After failures, inspect DB to confirm no business records were created for rejected requests.

## 6. Worker

```bash
npm run acceptance:phase1 -- worker
```

Expected:

- valid worker secret claims jobs
- notify-business and update-metrics jobs complete
- controlled recipient receives exactly one logical business email

## 7. Database Verification

```bash
npm run acceptance:phase1 -- verify-db
```

Then inspect hosted Supabase for:

- `leads`
- `lead_attributions`
- `lead_status_history`
- `domain_events`
- `outbox_events`
- `idempotency_records`
- `delivery_operations`
- `delivery_attempts`
- `job_executions`
- `dead_letter_events` when retry exhaustion is tested

## 8. Dashboard Workflow

Login to the staging dashboard as:

- `acceptance.owner@example.com`
- `acceptance.agent@example.com`
- `acceptance.viewer@example.com`

Verify:

- owner sees lead list/detail
- owner changes `new -> contacted`
- owner adds `Acceptance test - musteriyle gorusuldu.`
- owner assigns agent
- agent sees assigned lead
- agent changes `contacted -> offer_sent`
- agent adds a note
- owner changes `offer_sent -> won`
- viewer can read but cannot mutate
- Org B user sees `Talep bulunamadı` for Org A lead ID

## 9. Additional Acceptance Cases

Run or manually verify:

- same idempotency key + same body returns same logical response
- same idempotency key + different body returns `409`
- different idempotency key + same phone/email creates business duplicate
- rate limit returns `429` and is tenant/site scoped
- retryable provider failure increments attempt count and moves `available_at`
- retry exhaustion creates dead-letter records
- manual requeue preserves history and can complete after the failure condition is removed
- completed logical delivery does not send a second email
- WhatsApp link uses normalized phone: `https://wa.me/905551112233`
- phone link uses normalized phone: `tel:+905551112233`
- XSS payloads do not execute in dashboard or email
- runtime logs do not contain raw body, Turnstile token, HMAC signature, credential secret, worker secret, Resend API key, or raw IP

## 10. Cleanup

Cleanup is explicit and destructive only for acceptance-prefixed fixtures:

```bash
npm run acceptance:phase1 -- cleanup
```

Keep failed acceptance state when debugging is needed.

## 11. Release Decision

`PHASE 1 RELEASE READY: YES` is allowed only after the real staging chain, dashboard workflow, security rejection cases, delivery idempotency, retry/dead-letter, RBAC, cross-tenant isolation, optimistic concurrency, XSS safety, PII/secret boundary, and CI all pass.
