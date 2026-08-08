# Lead API

`POST /api/v1/leads` accepts only `application/json` and rejects query parameters.

Required headers:

- `X-Veridia-Key-Id`
- `X-Veridia-Timestamp`
- `X-Veridia-Nonce`
- `X-Veridia-Signature`
- `Idempotency-Key`
- `Content-Type`

The server reads the raw body once, enforces a 32 KB default limit, hashes those exact bytes, verifies the existing HMAC module, then parses JSON. Reformatting semantically identical JSON changes the signature.

Responses:

- `201`: `{ "success": true, "leadId": "...", "duplicate": false }`
- `201`: same shape with `duplicate: true` for business duplicates
- `200/201`: idempotent replay returns the stored safe response
- `400`: validation, JSON, honeypot, or deterministic bad input
- `401`: HMAC/authentication failure
- `409`: idempotency key conflict or in-flight processing
- `429`: rate limit
- `503`: missing runtime security dependency or provider/server failure

Production errors use `{ "error": "invalid_request" }` and do not expose SQL, stack traces, credential state, signatures, raw body, nonce, Turnstile token, phone, email, or IP.

Nonce semantics: once a valid HMAC request claims a nonce, that nonce is not reusable even if validation or Turnstile later fails.
