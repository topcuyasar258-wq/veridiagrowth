# Lead Permissions

Customer roles:

- `organization_owner`
- `agent`
- `viewer`

Permissions:

| Capability                                | Owner | Agent | Viewer |
| ----------------------------------------- | ----- | ----- | ------ |
| List own organization leads               | Yes   | Yes   | Yes    |
| Read own organization lead detail and PII | Yes   | Yes   | Yes    |
| Read notes and status history             | Yes   | Yes   | Yes    |
| Change lead status                        | Yes   | Yes   | No     |
| Add lead notes                            | Yes   | Yes   | No     |
| Self-assign                               | Yes   | Yes   | No     |
| Assign another owner or agent             | Yes   | No    | No     |
| Read technical audit/admin/job data       | No    | No    | No     |

Cross-tenant lead IDs must behave as not found in the customer UI. RPCs raise a not-found condition when the current authenticated user is not a member of the lead organization.

Audit metadata for customer mutations excludes raw PII, note bodies, secrets, tokens, cookies, request signatures, and operational credentials.
