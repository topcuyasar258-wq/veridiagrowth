# Domain Lifecycle

`site_domains` now uses explicit lifecycle fields:

- `status`: `active`, `inactive`, or `deleted`
- `deleted_at`: populated only when `status = 'deleted'`

Only active, non-deleted records participate in uniqueness:

```sql
unique (normalized_domain) where status = 'active' and deleted_at is null
```

This lets a domain be deactivated or deleted and then reassigned later in a controlled way.

Normalization rules:

- Lowercase and trim.
- Strip `http://` or `https://`.
- Strip a leading `www.`.
- Strip path, query string, fragment, and trailing slash.
- Strip ports. `example.com:8443` normalizes to `example.com`.

Internationalized domains are not converted to punycode in this migration. Store IDNs in their canonical DNS form before insert, preferably punycode, until an explicit IDN policy is added.
