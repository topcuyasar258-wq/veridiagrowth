# Rate Limiting

02B uses a PostgreSQL-backed starting model. No Redis or new queue system is introduced.

Buckets:

- site plus IP-risk hash: 10 attempts per 5 minutes by default
- site: 60 attempts per minute by default

Raw IP is not stored. `VERIDIA_IP_RISK_KEY` is used to create:

```text
HMAC-SHA256(VERIDIA_IP_RISK_KEY, normalized_ip)
```

This key must be separate from credential encryption keys. If an IP is available but the risk key is missing, ingestion fails closed.

Trusted proxy model:

- `x-forwarded-for` first hop is used only in the deployed proxy environment.
- `x-real-ip` is a fallback.
- The selected raw IP is used only transiently for Turnstile remote IP and risk hashing.

Rotation strategy:

- introduce a new risk key version
- accept old buckets until their short windows expire
- then remove the old key from runtime configuration
