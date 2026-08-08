# Credential Lifecycle

Creation flow:

1. Generate a 32-byte cryptographically secure random secret.
2. Encode it URL-safe.
3. Compute a short SHA-256 fingerprint.
4. Encrypt with AES-256-GCM.
5. Store only ciphertext envelope and fingerprint.
6. Return the plaintext secret once.
7. Write `credential.created` audit metadata without secret, ciphertext, IV, tag, raw nonce, signature, phone, email, or lead message.

The ciphertext envelope stores algorithm version, encryption key version, IV, authentication tag, and ciphertext. The master key is loaded from `VERIDIA_CREDENTIAL_ENCRYPTION_KEYS` and must remain server-only.

Rotation:

- A site can have at most one `active` credential and one `rotating` credential.
- Default transition window is 24 hours.
- The old active credential receives a `valid_until`.
- The new credential starts as `rotating`.
- Promotion to active and expiration of the old credential should be completed by a controlled backend operation in the API task.

Revocation:

- `revoked_at` and `revoked_by` are set.
- HMAC verification rejects revoked credentials immediately.
- `credential.revoked` audit metadata contains only safe identifiers.

Rollback strategy:

- Do not manually edit production credentials.
- If a migration must be rolled back, revoke affected credentials first and generate replacements after schema restoration.
- Never re-display a stored secret; rotate instead.
