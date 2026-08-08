# Security Boundaries

Client-side code credential secret'a, encryption master key'e veya service-role anahtarına erişemez.

Server-only values:

- `SUPABASE_SERVICE_ROLE_KEY`
- `VERIDIA_CREDENTIAL_ENCRYPTION_KEYS`
- `VERIDIA_CREDENTIAL_ENCRYPTION_KEY_VERSION`
- plaintext credential secrets

Client-visible values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SENTRY_DSN`
- `NEXT_PUBLIC_VERCEL_ENV`

Rules:

- Service-role Supabase client remains in a `server-only` module.
- Credential creation, rotation, revocation, HMAC verification, nonce claim, and idempotency claim are server-side operations.
- Audit and Sentry sanitizers redact secrets, ciphertext, IVs, authentication tags, signatures, raw nonces, idempotency keys, phone numbers, emails, and lead messages.
- Public Lead API route is not implemented in 02A.
- Production migrations must run through CI/release workflow, not manual ad hoc SQL.
