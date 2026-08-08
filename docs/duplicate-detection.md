# Duplicate Detection

Idempotency and business duplicates are separate.

The duplicate rule is:

- same `organization_id`
- matching `phone_normalized` or `email_normalized`
- existing active lead inside the previous 24 hours

Duplicates are not deleted. A new lead is created with:

- `is_duplicate = true`
- `duplicate_of = original_lead_id`

The original lead is deterministic: the oldest matching non-deleted lead in the organization.

Cross-tenant matches are never considered.
