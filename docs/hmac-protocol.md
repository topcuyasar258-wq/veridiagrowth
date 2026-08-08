# HMAC Protocol

Canonical string format is exactly:

```text
{HTTP_METHOD}
{NORMALIZED_PATH}
{TIMESTAMP}
{NONCE}
{SHA256_RAW_BODY_HEX}
```

Encoding is UTF-8. Line separator is `\n`. Method is uppercased. Path contains only the pathname; query strings are not signed and `/api/v1/leads/` normalizes to `/api/v1/leads`.

Required headers are case-insensitive:

- `X-Veridia-Key-Id`
- `X-Veridia-Timestamp`
- `X-Veridia-Nonce`
- `X-Veridia-Signature`
- `Idempotency-Key`

Body hash is SHA-256 over raw request bytes. JSON must not be parsed and re-stringified for signing. Signature encoding is lowercase hex HMAC-SHA256.

Test vector:

```text
method: POST
path: /api/v1/leads
timestamp: 1786021200
nonce: f6e82a72-1782-4d3a-9c95-2b8bb55ed130
raw body: {"email":"Ada@example.com","phone":"0532 123 45 67"}
secret: test_signing_fixture_32_bytes_minimum_value
body hash: 89b18951c38a1108f8040411c8e4056355f2f372969d44d33c4824c428b9eeeb
signature: f3939ea3c22c7a6d3054628345e860aa0797457dd51bdd59e2fc7f027b62d66d
```

Default timestamp tolerance is plus or minus 5 minutes. Future timestamps outside tolerance are rejected.

Replay protection happens after signature verification:

1. Find credential by key id.
2. Validate timestamp and credential lifecycle.
3. Decrypt credential secret.
4. Verify signature with timing-safe comparison.
5. Hash nonce.
6. Insert `(credential_id, nonce_hash)` into `used_nonces`.

The unique constraint makes the nonce claim atomic. Invalid signatures do not consume nonces; valid duplicate signatures fail on nonce uniqueness.

Rotation behavior: `active` and `rotating` credentials can verify while they are inside `valid_from`/`valid_until` and not revoked. `revoked` and `expired` credentials are rejected immediately.
