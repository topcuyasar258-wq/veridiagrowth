# Phase 3 Prompt — Follow-up Automation

## Goal

Recover unanswered or overdue leads through deterministic, auditable follow-up rules while preventing duplicate, excessive, mistimed, unwanted, or contextually wrong messages.

AI is not part of this phase. Automation uses approved templates and deterministic rules.

## Entry gate

- Phase 2 is `PASS` with real WhatsApp evidence.
- Provider delivery, status callbacks, kill switch, and dead-letter operations are reliable.
- Pilot business has explicitly approved test recipients, quiet hours, templates, maximum attempts, and opt-out wording.

## Required slices

### 3A — Rule and template model

Implement tenant/site-scoped follow-up policies:

- trigger condition
- delay/window
- eligible lead/conversation states
- message template/version
- maximum attempts
- cooldown
- quiet hours and timezone
- active/draft/paused state
- effective dates/version history
- pilot scope

Templates must be versioned and immutable once used. Editing creates a new version. Validate placeholders against an allowlist; never allow arbitrary code/expression execution or accidental PII expansion.

### 3B — Consent, opt-out, and suppression

Create a durable suppression model supporting:

- explicit opt-out phrases/events
- manual block
- provider block/failure where applicable
- legal/operational do-not-contact reason
- channel and tenant scope
- recorded source/time/actor

Suppression must be checked at job creation and immediately before provider send. A race between opt-out and worker send must resolve safely toward not sending.

### 3C — Eligibility engine

Compute whether a conversation is eligible using server/database truth.

Mandatory stop conditions:

- customer replied after the triggering message
- human agent replied or took ownership according to policy
- lead won/lost or conversation closed
- appointment booked when rule should stop
- follow-up already sent for the same rule occurrence
- maximum attempts reached
- cooldown active
- outside allowed hours
- suppression/opt-out active
- connection disabled/unhealthy
- missing or invalid recipient

Return machine-readable reason codes for observability without exposing sensitive content.

### 3D — Scheduler and worker

Build a bounded scheduler that creates durable jobs and a worker that claims them safely.

Requirements:

- deterministic occurrence/idempotency key
- `FOR UPDATE SKIP LOCKED` or equivalent safe claim pattern
- lock timeout/reclaim
- bounded batches
- retry/backoff/dead-letter consistent with provider errors
- immediate pre-send eligibility recheck
- atomic state transition around send intent
- no duplicate send after crash between provider response and local commit; define reconciliation strategy
- per-tenant and provider throughput limits
- global and tenant kill switches
- dry-run mode that records decisions but never calls provider

### 3E — Employee SLA alerts

Implement internal alerts for leads that have not received a human response within configured SLA.

Requirements:

- distinguish customer follow-up from employee alert
- deduplicate alerts
- assign to the correct owner/agent
- escalation policy and cooldown
- resolved when human action occurs
- no customer PII in unsafe notification channels
- measurable alert-to-action timing

### 3F — Customer controls and audit

Provide safe UI for owner roles to:

- view rules/templates
- enable/pause within allowed pilot constraints
- inspect scheduled/sent/skipped/cancelled jobs
- understand skip reason in customer language
- activate kill switch

Agents may inspect operational state as appropriate; viewers remain read-only. Every rule/template/kill-switch change and every automation decision is auditable.

### 3G — Reporting

Measure without overstating causality:

- eligible conversations
- follow-ups scheduled/sent/delivered/read/replied
- appointments/wins after follow-up within a documented window
- skipped/cancelled by reason
- opt-outs
- duplicate-prevention count
- employee SLA breaches and resolution time

Label “recovered” using an explicit attribution rule and document its limitations.

## Mandatory staging/pilot scenarios

1. Eligible unanswered lead schedules exactly one follow-up.
2. Scheduler runs twice concurrently and still creates one occurrence.
3. Customer reply before send cancels/prevents the follow-up.
4. Opt-out racing with send prevents the provider call.
5. Won, lost, appointment, closed, missing recipient, and disabled connection all stop correctly.
6. Quiet-hours job moves to the next valid local time, including DST/timezone fixture cases.
7. Maximum attempts and cooldown cannot be bypassed by concurrent workers.
8. Worker crash/reclaim fixture does not double-send.
9. Retryable provider failure retries; permanent failure dead-letters.
10. Global and tenant kill switches stop new sends immediately.
11. Dry-run generates decisions and zero provider calls.
12. Employee SLA alert deduplicates and resolves on human action.
13. Reporting matches deterministic fixtures.
14. Real provider test sends only to approved pilot recipient.
15. Logs/bundle/audit privacy checks and fixture cleanup pass.

## Phase 3 exit criteria

- Every stop rule has positive and negative tests.
- Concurrency and crash/retry tests prove at-most-once logical send intent and documented provider reconciliation.
- Real pilot dry-run is reviewed before live test sends.
- `docs/acceptance/lead-recovery-phase-3.md` is `PASS` on exact SHA.
- User approves merge/advance. Otherwise remain in Phase 3.
