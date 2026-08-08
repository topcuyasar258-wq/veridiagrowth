# Turnstile

The route uses `BotChallengeProvider`; the Cloudflare implementation is `CloudflareTurnstileProvider`.

Turnstile secret is server-only via `TURNSTILE_SECRET_KEY`. The route fails closed if the secret is absent.

Provider behavior:

- `success`: continue ingestion
- `invalid`, `expired`, `duplicate`: reject without lead creation
- `timeout`, `provider_error`: reject fail-closed

The adapter has a timeout and does not log token values or full provider responses.

## Test keys vs real configuration

Cloudflare's testing keys do **not** behave like a real widget. With a real
configuration the token determines the outcome, so a single run can send both a
passing and a failing token. With testing keys the **secret** determines the
outcome and the token is ignored:

| Secret                                | Outcome       |
| ------------------------------------- | ------------- |
| `1x0000000000000000000000000000000AA` | always passes |
| `2x0000000000000000000000000000000AA` | always fails  |

Because the secret lives in the application environment, one application process
cannot produce both outcomes. Any assertion that expects a "failure token" to be
rejected passes silently under an always-passes secret.

The acceptance harness models this explicitly through `ACCEPTANCE_TURNSTILE_MODE`:

- `real` — token-driven. `submit-security` asserts the failure token yields `403`.
  `guardEnvironment` refuses to run when a Cloudflare test secret is configured,
  because that assertion would be vacuous.
- `test_keys` — secret-driven. `submit-security` skips the in-run rejection
  assertion and prints why. The rejection path is verified by a separate run of
  the `turnstile-reject` command against an application started with the
  always-fails secret. That command refuses to run unless the secret matches.

Staging validation:

1. Start the app with the always-passes secret and `ACCEPTANCE_TURNSTILE_MODE=test_keys`.
2. Run `seed`, `submit-happy`, `submit-security`.
3. Verify one lead, one attribution, one status history row, one domain event, and two outbox jobs.
4. Restart the app with the always-fails secret and run `turnstile-reject`.
   It asserts `403` and that neither lead nor outbox counts changed.
5. Repeat with expired, duplicate, timeout, and provider-error mocks before production rollout.
