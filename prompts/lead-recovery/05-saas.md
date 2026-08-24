# Phase 5 Prompt — Multi-customer SaaS

## Goal

Turn the validated single-business pilot into a self-service, metered multi-customer SaaS with customer WhatsApp onboarding, packages/limits, billing, Instagram channel support, privacy-safe benchmarks, and explainable lead scoring.

Do not begin this phase without measured pilot evidence showing the earlier product is used and improves a defined operational metric.

## Entry gate

- Phases 1–4 are `PASS` and approved.
- Pilot metrics, failure history, support burden, per-tenant cost, and retention assumptions are documented.
- Billing provider, Meta onboarding method, package definitions, data controller/processor responsibilities, deletion/export policy, and benchmark privacy policy are explicit.
- Legal/account actions that cannot be automated are listed as blockers, not guessed.

## Required slices

### 5A — SaaS tenancy hardening

Audit every new table, RPC, route, worker, cache, queue key, object storage path, log, and metric label added in Phases 1–4.

Prove:

- no cross-tenant reads/writes
- credentials encrypted and scoped
- background jobs carry verified tenant context
- cache/idempotency keys include necessary tenant/provider scope
- support/admin impersonation is explicit, time-bound, audited, and least privilege if implemented
- data export/deletion includes all tenant-owned product data without deleting shared system definitions

Add adversarial multi-tenant tests and a documented threat model.

### 5B — Self-service WhatsApp onboarding

Implement current official Meta embedded signup/onboarding flow or explicitly chosen supported alternative.

Requirements:

- OAuth/state/redirect protection
- account, business, phone, and permission verification
- encrypted token storage and rotation/revocation lifecycle
- connection status and actionable repair UI
- webhook subscription verification
- reconnect without duplicating connection/message history
- disconnect stops sending and follows retention policy
- failed/partial onboarding is resumable and cleanable
- no customer can attach an account already owned by another tenant without explicit safe transfer handling

Real account acceptance is mandatory.

### 5C — Packages, metering, and enforcement

Define billable units and package limits precisely:

- seats
- connections/channels
- messages or conversations
- automation sends
- AI usage
- retention/reporting tier

Meter atomically under concurrency. Enforcement must be server-side and consistent across API, worker, UI, and provider paths. Define soft warning, hard limit, grace, upgrade, downgrade, reset period, and overage behavior. Never lose inbound customer messages solely because a billing limit is reached; define safe degraded behavior.

### 5D — Billing

Integrate the chosen billing provider through an adapter.

Requirements:

- signed webhook verification on raw bytes
- event idempotency and out-of-order handling
- customer/subscription/invoice mapping scoped to tenant
- trial, active, past due, cancelled, grace, refund, dispute, and webhook retry behavior
- no card data stored directly
- billing failure does not cause destructive data deletion
- entitlements derived from trusted billing state with explicit override/audit path
- reconciliation job for missed webhooks

Use sandbox/test mode for acceptance.

### 5E — Instagram channel

Extend the channel-neutral model rather than cloning WhatsApp logic.

Implement current official provider flow for:

- account connection
- signed/authenticated webhook
- inbound messages
- outbound staff reply
- provider message/status identity where available
- permission/token lifecycle
- channel-specific limits and unsupported content

Conversation UI must clearly identify channel. Cross-channel contact linking must be conservative and auditable; do not merge identities solely on weak similarity.

### 5F — Anonymous benchmark

Define allowed aggregate metrics and privacy thresholds before implementation.

Requirements:

- explicit opt-in/contractual policy as required
- no raw messages, phone/email, business name, exact low-volume category, or reversible identifiers
- minimum cohort size and suppression
- bounded dimensions to prevent differencing attacks
- no customer access to another customer's row-level data
- deletion/recalculation policy
- deterministic privacy tests using small-cohort attack fixtures
- clear wording that benchmark is aggregated and may be unavailable for small cohorts

Do not call simple pseudonymization “anonymous.”

### 5G — Explainable lead score

Define outcome, training/evaluation window, leakage controls, and baseline before choosing a model.

Requirements:

- begin with an interpretable rules/statistical baseline
- features available at scoring time only
- exclude protected/sensitive attributes and unsafe proxies
- tenant/time split evaluation preventing future leakage
- calibration and threshold metrics relevant to business action
- reason codes visible to staff
- missing-data behavior
- versioning, monitoring, rollback, and human override
- scoring failure never blocks manual operations

Do not ship a score that lacks measured lift over a simple baseline or a documented operational use.

### 5H — Operations and release

Add:

- tenant-level health/cost/usage dashboards
- provider/billing webhook queue health
- support-safe diagnostics
- backup/restore and disaster-recovery checks
- migration rollout and rollback/disable plan
- staged tenant rollout with canary cohort
- status/incident runbooks
- export and account closure acceptance

## Mandatory acceptance scenarios

1. Two or more real test tenants independently onboard WhatsApp without cross-access.
2. Disconnect/reconnect preserves correct history and prevents sends while disconnected.
3. Concurrent metering cannot exceed the hard limit silently.
4. Limit exhaustion degrades safely and preserves inbound history.
5. Billing webhook duplicate/out-of-order/retry fixtures produce one correct entitlement state.
6. Sandbox purchase, past-due, cancellation, grace, and reactivation flows work end to end.
7. Instagram inbound/outbound real test works for an approved test account.
8. Cross-channel conversations remain correctly labelled and weak identity matches are not auto-merged.
9. Benchmark hides small cohorts and resists documented differencing fixtures.
10. Lead score beats or justifies itself against baseline and provides stable reason codes.
11. Export contains all expected tenant data; deletion removes/retains exactly according to policy.
12. Tenant security matrix, logs/PII scan, provider failure, queue recovery, backup/restore, and canary rollback pass.

## Phase 5 exit criteria

- Real provider and billing sandbox acceptance passes on exact SHA.
- Multi-tenant adversarial suite passes.
- Privacy benchmark and lead-score evaluation reports are versioned and reproducible.
- Operational runbooks and kill switches are verified.
- `docs/acceptance/lead-recovery-phase-5.md` is `PASS`.
- Production launch still requires an explicit separate authorization.
