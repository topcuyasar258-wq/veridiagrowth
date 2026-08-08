# Retry Policy

Default max attempts: `5`.

Backoff:

- attempt 1: immediate
- attempt 2: 1 minute
- attempt 3: 5 minutes
- attempt 4: 15 minutes
- attempt 5: 60 minutes

Retryable:

- `provider_timeout`
- `provider_429`
- `provider_5xx`
- `temporary_database_error`
- `network_error`

Non-retryable:

- `invalid_recipient`
- `notification_disabled`
- `missing_required_configuration`
- `invalid_template_data`

Non-retryable failures go to dead-letter instead of looping forever.
