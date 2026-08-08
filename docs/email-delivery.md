# Email Delivery

The provider interface is:

```ts
interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>
}
```

The first adapter is Resend. Server-only env:

- `RESEND_API_KEY`
- `VERIDIA_EMAIL_FROM`
- `VERIDIA_EMAIL_REPLY_TO`

Resend receives a stable provider idempotency key based on the logical delivery key, for example `notify-business:{lead_id}`.

Delivery tables store recipient fingerprint only. Raw recipient email is read from `notification_settings` when needed and is not copied into `delivery_attempts`.

Provider timeout ambiguity: if the provider accepted the email but the network timed out, the attempt is marked `delivery_unknown`. Retries keep the same logical idempotency key so provider-side idempotency can suppress duplicate sends.
