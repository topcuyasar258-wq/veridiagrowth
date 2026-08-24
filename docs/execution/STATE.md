# Lead Recovery Execution State

This file is the single durable phase pointer. Update it only with evidence.

## Current state

- Active phase: `1`
- Active phase name: `Core CRM and follow-up`
- Active slice: `1A — baseline audit and detailed implementation plan`
- Result: `NOT_STARTED`
- Base branch: `main`
- Phase branch: `codex/lead-recovery-phase-1`
- Last tested commit: `none`
- Local gate: `NOT_RUN`
- PostgreSQL/pgTAP gate: `NOT_RUN`
- Browser gate: `NOT_RUN`
- Staging gate: `NOT_RUN`
- Production release: `NOT_AUTHORIZED`

## Known baseline

- Existing lead statuses include `new`, `contacted`, `offer_sent`, `won`, and `lost`.
- Existing customer actions include status update, note addition, and assignment.
- Existing lead creation is controlled backend ingestion; manual customer lead creation is not yet part of the dashboard.
- Conversation/message storage, follow-up scheduling, appointment result, recovery reporting, and WhatsApp transport are not yet proven present.
- Existing Phase 2A interaction collector staging acceptance reported correctness PASS with a known throughput ceiling around 7 events/second. This is unrelated to Lead Recovery Phase 2.

## Open blockers

- None recorded for Phase 1 preflight. The executor must verify the actual environment before changing this statement.

## Evidence log

No Lead Recovery phase evidence recorded yet.

## Update rules

When a slice changes, record:

- slice identifier
- commit SHA
- commands actually run
- pass/fail counts
- environment name and URLs only when safe to record
- linked acceptance report
- unresolved risks or blockers

Do not delete failed attempts. Append a dated entry so the repair history remains visible.
