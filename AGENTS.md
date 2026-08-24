# Veridia Lead Layer — Agent Rules

## Mission

Build Lead Recovery incrementally on top of the existing multi-tenant Lead Layer. Preserve the current ingestion, tracker, outbox, dashboard, security, and audit guarantees.

## Required context

Before changing code, read:

1. `docs/execution/MASTER-PLAN.md`
2. `docs/execution/STATE.md`
3. `docs/execution/PHASE-GATE.md`
4. The prompt file for the active phase under `prompts/lead-recovery/`
5. Relevant existing architecture documents under `docs/`

Do not treat old phase names in commit history as the new Lead Recovery phase numbers. The active roadmap is the one in `docs/execution/MASTER-PLAN.md`.

## Non-negotiable phase gate

- Work on only the active phase and its current slice.
- Never begin a later phase because the current implementation looks complete.
- A phase passes only after every required automated check and every required staging acceptance check has actually run and passed.
- An unrun, skipped, unavailable, mocked-only, or assumed check is not a pass.
- If a check fails, remain in the same phase, diagnose the cause, fix it, add a regression test, and rerun the full required gate.
- If a required credential, external account, deployment, or approval is missing, record `BLOCKED`, list the exact missing item, and stop. Do not bypass or weaken the check.
- Do not mark `docs/execution/STATE.md` as `PASS` without commands, environment, commit SHA, results, and evidence.
- Do not start, implement, scaffold, or partially prepare the next phase before the current phase is `PASS`.

## Git workflow

- Never develop directly on `main`.
- Use one branch per phase: `codex/lead-recovery-phase-N`.
- Keep each commit scoped to one coherent slice.
- Do not rewrite shared history or force-push.
- Preserve unrelated user changes.
- Open a PR only after the local gate is green. Keep it draft while staging acceptance is pending.
- Do not merge a phase PR until the phase gate is `PASS` and the user has approved the merge.

## Required verification commands

Run relevant focused tests during development. Before claiming a local gate pass, run from the repository root:

```bash
npm ci
npm run format
npm run check:sql-arity
npm run tracker:build
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build
npm run test:client-bundle-secret
```

When Supabase/Docker is available, also run:

```bash
supabase start
supabase db reset
supabase db test
```

When a command is irrelevant, explain why in the acceptance report. Do not silently omit it.

## Database and tenant safety

- Every tenant-owned row must carry or derive an organization boundary.
- Enforce isolation in PostgreSQL/RLS or controlled RPCs, not UI filtering alone.
- Service-role credentials remain server-only.
- Customer roles must not receive unrestricted table writes.
- Add positive and negative RLS tests for owner, agent, viewer, unauthenticated, service-role, and a second tenant where relevant.
- Migrations are forward-only. Never edit an applied migration; add a new migration.
- Never run `supabase db reset` against a linked staging or production project.
- Never apply a migration to production automatically.

## Security and privacy

- Never commit credentials, tokens, production URLs, phone numbers, emails, message bodies, or real customer data.
- Use synthetic fixtures only.
- Preserve raw-body signature verification where signatures depend on exact bytes.
- External webhooks must be authenticated, idempotent, replay-safe, observable, and safe under concurrent delivery.
- Raw IP addresses must not be stored or logged.
- Conversation content and contact PII must not enter anonymous analytics/tracker tables.
- Logs, Sentry, audit metadata, and error messages must be sanitized.
- Any outbound automation must honor opt-out, quiet hours, maximum attempts, cooldowns, human replies, terminal lead states, and idempotency.
- AI output must require human approval until a later explicitly approved phase changes that rule.

## Engineering expectations

- Inspect existing patterns before introducing new abstractions.
- Prefer controlled RPCs for multi-table invariants and concurrency-sensitive writes.
- Use database constraints for invariants that must hold regardless of caller.
- Add regression tests for every bug found during implementation or acceptance.
- Avoid new production dependencies unless clearly justified.
- Preserve backward compatibility for existing lead ingestion and tracker contracts.
- Keep customer-facing language non-technical and Turkish where the current dashboard does so.
- Update relevant documentation when behavior changes.

## Completion response

For each slice report: files changed, migrations added, tests added, commands run, exact results, known risks, and next allowed action. End with exactly one state: `PASS`, `FAIL`, or `BLOCKED`.

## Code review rules

- Flag any cross-tenant read/write path that relies only on application filters.
- Flag any unsigned or non-idempotent webhook processing path.
- Flag any outbound message path that can send twice after retry or concurrent worker execution.
- Flag any automation path that can ignore opt-out, quiet hours, human replies, or terminal lead states.
- Flag any AI path that can send externally without the required human approval.
- Flag any claimed acceptance result that lacks executable evidence.
