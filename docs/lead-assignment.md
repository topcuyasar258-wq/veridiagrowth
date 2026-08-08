# Lead Assignment

Lead assignment is stored on `leads.assigned_to`.

Rules:

- Owner can assign any owner or agent in the same organization.
- Owner can clear an assignment.
- Agent can self-assign.
- Agent cannot assign another person.
- Viewer cannot assign.
- A viewer cannot be the assignment target.
- A member from another organization cannot be the assignment target.

Assignments use `assign_customer_lead`, which checks tenant membership and optimistic concurrency before updating the lead. Successful assignment updates increment `leads.version`, update `last_activity_at`, and write a sanitized audit event.
