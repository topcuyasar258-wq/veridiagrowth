# Turnstile

The route uses `BotChallengeProvider`; the Cloudflare implementation is `CloudflareTurnstileProvider`.

Turnstile secret is server-only via `TURNSTILE_SECRET_KEY`. The route fails closed if the secret is absent.

Provider behavior:

- `success`: continue ingestion
- `invalid`, `expired`, `duplicate`: reject without lead creation
- `timeout`, `provider_error`: reject fail-closed

The adapter has a timeout and does not log token values or full provider responses.

Staging validation:

1. Configure Cloudflare Turnstile test keys in staging only.
2. Send a valid HMAC-signed request with a valid test token.
3. Verify one lead, one attribution, one status history row, one domain event, and two outbox jobs.
4. Repeat with invalid, expired, duplicate, timeout, and provider-error mocks before production rollout.
