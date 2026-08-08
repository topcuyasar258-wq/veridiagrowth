# Sentry Skeleton

Sentry is initialized only when `NEXT_PUBLIC_SENTRY_DSN` is present. Missing DSN must not fail build or runtime.

Current guardrails:

- `NEXT_PUBLIC_SENTRY_DSN` is the only client-visible Sentry value.
- `SENTRY_AUTH_TOKEN` remains server-only and is not imported by Sentry runtime config.
- `sendDefaultPii` is disabled.
- `beforeSend` redacts cookies, authorization-style headers, secret keys, and request body data.
- Environments are restricted to `development`, `staging`, or `production`.
