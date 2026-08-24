# Phase 1 Prompt — Core CRM and Follow-up

## Goal

Extend the existing customer lead dashboard into a complete manual Lead Recovery workflow. Authorized staff must be able to create a lead, see a conversation timeline, record manual communication, schedule follow-up, close the lead with an appointment/sale/loss outcome, and view trustworthy basic recovery reports.

This phase contains no live WhatsApp provider integration, outbound automation, or AI.

## Entry gate

- `docs/execution/STATE.md` must identify Phase 1 as active.
- Existing ingestion, outbox, tracker, auth, RLS, lead list/detail, status, assignment, and notes behavior must be inventoried.
- Baseline checks must run before implementation. Record pre-existing failures separately.
- Work only on `codex/lead-recovery-phase-1` or an explicitly approved equivalent phase branch.

## Required slices

### 1A — Baseline audit and implementation plan

Inspect, at minimum:

- all Supabase migrations and pgTAP tests
- dashboard lead pages and server actions
- lead repository/types/formatting
- auth and tenant context
- audit log sanitizer
- existing status history, notes, assignment, duplicate, attribution, and notification behavior
- CI, browser tests, acceptance harness, and environment guards

Produce a file-level plan. Identify existing capabilities that satisfy a requirement and do not duplicate them. Record schema naming decisions and compatibility risks. Do not change code until the plan is coherent.

### 1B — Contact, conversation, and message model

Design a channel-neutral data model suitable for later WhatsApp and Instagram support.

Minimum concepts:

- contact identity belonging to an organization
- conversation belonging to an organization, site, contact, and optionally a lead
- channel identifier with a safe initial manual/internal channel
- message direction: inbound/outbound/internal where appropriate
- message author/source: customer, human agent, system, later provider/AI
- message body and structured metadata with strict limits
- provider identifiers nullable in Phase 1 but constrained for later idempotency
- timestamps for occurred, received, sent, created, and updated only where semantically distinct
- delivery state fields that do not falsely claim provider delivery in the manual phase
- soft archival/closure rules

Requirements:

- Every tenant-owned table has a database-enforced organization boundary.
- Foreign keys cannot connect rows across organizations or sites.
- Raw message content and contact PII are not written to anonymous analytics tables.
- Customer users do not receive unrestricted insert/update/delete privileges.
- Timeline ordering is deterministic when timestamps tie.
- Provider event idempotency can be added later without redesigning the whole table.
- Lead ingestion can attach to a contact/conversation without changing the public lead API response contract.
- Existing leads remain readable after migration.

Add forward-only migrations, generated database types, controlled RPCs/repository methods, indexes based on actual query paths, and positive/negative pgTAP coverage.

### 1C — Manual lead creation

Add an owner/agent-only dashboard flow to create a lead manually.

Minimum fields:

- site
- first/last name where available
- at least phone or email
- requested service
- city where relevant
- initial message/note
- source category fixed to an honest manual source or a documented equivalent
- optional assignee

Rules:

- Normalize phone/email using existing helpers.
- Reuse duplicate detection; do not invent a conflicting model.
- Do not require HMAC or Turnstile for an authenticated server action.
- Do not allow the browser to use service-role credentials.
- Validate length, enum, and tenant ownership server-side and in the database.
- Record audit and status history.
- Make concurrent repeated submissions idempotent or safely duplicate-aware.
- Viewer cannot create.
- Creating for another tenant/site is impossible even with forged form values.

Provide accessible UI validation, success/error states, and browser tests.

### 1D — Manual conversation timeline

On the lead detail page, show a chronological timeline containing:

- lead creation/source event
- customer and agent messages recorded manually
- notes, visually distinct from messages
- status changes
- assignment changes
- follow-up scheduling/completion events
- outcome events

Add an owner/agent action to record a manual inbound or outbound interaction without claiming it was delivered through WhatsApp. Viewer remains read-only. Prevent stale/concurrent updates from silently overwriting state.

Do not expose raw audit metadata or internal security terminology in the customer UI.

### 1E — Follow-up scheduling

Implement:

- one current next-follow-up time per active lead/conversation
- timezone-safe storage in UTC and display using organization/site timezone policy
- optional assignee and reason
- scheduled, completed, cancelled, and overdue states or an equivalent event model
- queue/filter for due today and overdue follow-ups
- reschedule flow that preserves history
- completion action that records who completed it and when
- terminal-state behavior for won/lost leads

Database constraints must prevent impossible states. Concurrent schedule/complete actions must not lose history. Define whether a new inbound message completes, cancels, or leaves a follow-up unchanged in this manual phase and test the chosen behavior.

### 1F — Outcomes

Preserve compatible existing statuses while adding explicit business outcomes:

- appointment booked
- sale won
- lost

An appointment must not be represented ambiguously as a sale. Model appointment information separately or with an explicit outcome/event design.

Minimum outcome data:

- outcome type
- occurred_at
- recorded_by
- optional appointment time
- optional value/currency for a won sale only if safely scoped
- loss reason from a controlled set plus optional sanitized note
- audit/history

Define reopen/correction behavior. Do not destroy prior outcome history. Terminal outcomes must interact correctly with pending follow-ups.

### 1G — Basic reporting

Add a tenant-scoped report for a selected date range and optional site/assignee filter:

- new leads
- contacted leads
- appointments booked
- won sales
- lost leads
- open leads
- overdue follow-ups
- median/average first response time only if the underlying manual event model can calculate it honestly
- conversion rates with documented denominators

Requirements:

- Compute through controlled SQL/RPC or bounded server queries.
- Do not download unrestricted tenant data to calculate in the browser.
- Define timezone/date-boundary behavior.
- Exclude or label duplicates and suspicious leads consistently.
- Empty datasets return zeros, not division errors or misleading 100% rates.
- A second tenant cannot influence or read the report.
- Add deterministic fixtures and exact expected-value tests.

### 1H — Full acceptance and repair loop

Run the complete phase gate. Deploy the exact candidate SHA to dedicated staging. Use synthetic owner, agent, viewer, and second-tenant users.

## Mandatory staging scenarios

1. Owner creates a manual lead with phone only.
2. Agent creates a manual lead with email only.
3. Duplicate contact/lead behavior matches the documented rule.
4. Viewer creation attempt is denied.
5. Forged site/organization identifiers cannot cross tenant boundaries.
6. Agent records inbound and outbound manual interactions; timeline order is correct.
7. Follow-up is scheduled, appears due, becomes overdue using controlled fixture time, is rescheduled, then completed with preserved history.
8. Appointment is booked without marking the lead won.
9. Sale is won and pending follow-up behavior matches policy.
10. Lead is lost with a reason and can only be corrected using the documented path.
11. Concurrent stale updates produce a visible conflict rather than silent overwrite.
12. Report totals and conversion rates match seeded fixture values exactly.
13. Cross-tenant report and detail access return no data.
14. Logs, Sentry, audit metadata, URLs, and browser bundle contain no secrets or unintended PII.
15. Cleanup removes only prefixed synthetic fixtures and verifies no residue.

## Phase 1 exit criteria

- All slices complete.
- All migration, RLS, unit, integration, browser, build, format, lint, typecheck, and secret-scan gates pass.
- Mandatory staging scenarios pass on the recorded candidate SHA.
- `docs/acceptance/lead-recovery-phase-1.md` exists and records exact evidence.
- `docs/execution/STATE.md` says Phase 1 `PASS`.
- PR remains unmerged until explicit user approval.

If anything is unrun or fails, return `FAIL` or `BLOCKED`, repair within Phase 1, and do not touch Phase 2.
