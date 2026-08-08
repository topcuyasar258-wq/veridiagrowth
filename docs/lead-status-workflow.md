# Lead Status Workflow

Supported customer lead statuses:

| Status       | UI Label          |
| ------------ | ----------------- |
| `new`        | Yeni              |
| `contacted`  | İletişime Geçildi |
| `offer_sent` | Teklif Gönderildi |
| `won`        | Kazanıldı         |
| `lost`       | Kaybedildi        |

Status changes use `update_customer_lead_status`.

The function atomically:

- verifies the authenticated user is an owner or agent in the lead organization
- verifies the submitted `expected_version`
- updates `leads.status`
- increments `leads.version`
- updates `leads.last_activity_at`
- inserts `lead_status_history`
- inserts a sanitized `audit_logs` event

If another user updated the lead first, the function raises a stale-version error. The UI shows:

`Bu talep başka bir kullanıcı tarafından güncellendi. En güncel halini tekrar yükleyin.`
