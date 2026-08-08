# Lead Data Model

Tables added in `20260806160000_lead_model_credentials_hmac.sql`:

- `leads`
- `lead_attributions`
- `lead_status_history`
- `lead_notes`
- `site_credentials`
- `used_nonces`
- `idempotency_records`

Lead constraints:

- `site_id` must belong to `organization_id`.
- At least one of phone or email is required.
- `assigned_to` must be an owner or agent in the same organization.
- Viewers cannot be assigned.
- `duplicate_of` must reference another lead in the same organization and cannot point to itself.
- Customer roles cannot directly insert/update/delete leads; controlled backend/service-role operations own lead creation.

Index decisions:

- `(organization_id, created_at desc)`: tenant recent lead lists.
- `(site_id, created_at desc)`: backend site-scoped lead workflows.
- `(organization_id, status, created_at desc)`: status queues.
- `(organization_id, assigned_to, status)`: agent work queues.
- `(organization_id, phone_normalized, created_at desc)`: duplicate detection without raw phone indexing.
- `(organization_id, email_normalized, created_at desc)`: duplicate detection without raw email indexing.

Raw PII columns such as `phone`, `email`, and `message` are not indexed.

Attribution is one row per lead and immutable to customer users after creation. UTM and URL fields have length constraints.

Status history is append-only to customer roles. Notes are append-only in v0.1; corrections should be represented by a new note or controlled soft-delete audit in a later task.
