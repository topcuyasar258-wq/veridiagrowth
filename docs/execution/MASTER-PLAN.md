# Lead Recovery Master Plan

## Product objective

Turn the existing Veridia Lead Layer foundation into a lead recovery product that helps a service business receive, answer, follow up, and measure leads without losing tenant isolation, security, privacy, or delivery guarantees.

## Existing verified foundation

The repository already contains:

- organization/site/member tenancy and RLS foundations
- verified lead ingestion through `POST /api/v1/leads`
- HMAC, timestamp, nonce, Turnstile, honeypot, rate limiting, idempotency, duplicate detection, attribution, and audit events
- transactional outbox, worker claiming, retry/backoff, dead-letter handling, Resend adapter, and queue operations
- customer lead list/detail UI with status, assignment, and notes
- browser tracker, anonymous interaction collector, risk/quarantine logic, retention, tracker releases, canary/pinning/rollback, and load acceptance tooling

These are foundations, not proof that the Lead Recovery phases below are complete.

## Ordered phases

| Phase | Name | Prompt | Depends on |
| --- | --- | --- | --- |
| 1 | Core CRM and follow-up | `prompts/lead-recovery/01-core-crm.md` | Current main baseline |
| 2 | Single-business WhatsApp pilot | `prompts/lead-recovery/02-whatsapp-pilot.md` | Phase 1 PASS |
| 3 | Follow-up automation | `prompts/lead-recovery/03-automation.md` | Phase 2 PASS |
| 4 | Human-approved AI assistant | `prompts/lead-recovery/04-ai-assistant.md` | Phase 3 PASS plus evaluation fixtures |
| 5 | Multi-customer SaaS | `prompts/lead-recovery/05-saas.md` | Pilot evidence from phases 1–4 |

## Absolute ordering rule

Only one phase may be active. Later phases remain untouched until the active phase has an acceptance report with `Result: PASS`, a tested commit SHA, a named environment, and evidence for every mandatory criterion.

## Phase lifecycle

1. **Preflight** — confirm clean branch, base SHA, environment, migration state, available credentials, and baseline checks.
2. **Plan** — map requirements to existing files and invariants. Identify migration, API, UI, tests, docs, and operational work.
3. **Slices** — implement one bounded slice at a time. Run focused checks after each slice.
4. **Local gate** — run the complete repository gate and PostgreSQL tests where available.
5. **Review** — inspect the full diff for tenant leakage, replay races, PII leakage, unsafe logging, compatibility, missing rollback/cleanup, and test gaps.
6. **Staging gate** — deploy the exact candidate SHA to a dedicated non-production environment and run the phase acceptance scenarios with synthetic data.
7. **Repair loop** — on any failure, return to the implementation step, fix the root cause, add a regression test, and rerun the complete gate.
8. **Evidence** — add `docs/acceptance/lead-recovery-phase-N.md`, then update `STATE.md`.
9. **Human decision** — ask for merge/next-phase approval. Passing does not grant automatic permission to merge or start the next phase.

## Results vocabulary

- `PASS`: every required automated and staging criterion actually ran and passed on the recorded SHA.
- `FAIL`: a required criterion ran and failed. The active phase remains active.
- `BLOCKED`: a required check could not run because a credential, environment, account action, deployment, or approval is missing. The phase remains active.
- `NOT_STARTED`: no phase implementation work has begun.

Never use “mostly pass”, “code complete”, “release ready”, or “should work” as substitutes for a gate result.

## Production boundary

Production is never an acceptance sandbox. No synthetic load, fake contacts, test WhatsApp messages, schema resets, or experimental automation may be directed at production. Production rollout requires a separate explicit user decision after the phase PR is accepted.

## Branches and PRs

- Phase 1: `codex/lead-recovery-phase-1`
- Phase 2: `codex/lead-recovery-phase-2`
- Phase 3: `codex/lead-recovery-phase-3`
- Phase 4: `codex/lead-recovery-phase-4`
- Phase 5: `codex/lead-recovery-phase-5`

Each phase PR must link its roadmap issue, acceptance report, migrations, test commands, known risks, and rollback/disable path.

## Roadmap issues

- Roadmap: GitHub issue #9
- Phase 1: GitHub issue #5
- Phase 2: GitHub issue #4
- Phase 3: GitHub issue #7
- Phase 4: GitHub issue #8
- Phase 5: GitHub issue #6

## Definition of product success

The product must eventually measure at least:

- first response time
- unanswered lead rate
- overdue follow-up count
- lead-to-appointment rate
- appointment-to-sale rate
- recovered lead count attributable to follow-up
- open conversations and SLA violations per agent

Metrics must have documented denominators, tenant boundaries, timezone behavior, exclusion rules, and reproducible test fixtures.
