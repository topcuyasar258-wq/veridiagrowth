# Phase 2 Prompt — Single-Business WhatsApp Pilot

## Goal

Connect exactly one authorized beauty business to Meta WhatsApp Cloud API so inbound messages are stored in the correct conversation, authorized staff can reply from the panel, and provider delivery/read/failure events update message state reliably.

This is a controlled pilot, not self-service SaaS onboarding. No follow-up automation or AI sending is allowed.

## Entry gate

- Phase 1 acceptance result is `PASS` on a merged or explicitly approved base SHA.
- A dedicated staging deployment and Supabase project exist.
- A Meta test or pilot business account, test number, webhook verify token, app secret, access token, phone number ID, and approved recipient are available through secret storage.
- At execution time, consult current official Meta documentation and pin/document the Graph API version. Do not guess provider fields from memory.

## Required slices

### 2A — Provider boundary and configuration

Create a WhatsApp provider adapter boundary rather than spreading Meta HTTP calls through routes/UI.

Define:

- encrypted server-only credential storage or a pilot-only environment configuration with an explicit later migration path
- connection identity tied to exactly one organization/site
- phone number ID and business account identifiers
- API version and base URL
- token lifecycle/health state without logging the token
- safe timeout, retry classification, and normalized provider errors
- connection disabled/revoked behavior

Never send credentials, app secret, raw webhook payloads, or customer message content to the browser, logs, Sentry, analytics, or audit metadata.

### 2B — Webhook verification and authentication

Implement the provider verification GET flow and authenticated POST webhook endpoint.

Requirements:

- Compare verify token in constant-time where practical and return only the required challenge behavior.
- Verify the Meta signature against the exact raw request bytes before parsing or mutating data.
- Enforce body limits and content type.
- Reject missing/invalid signatures without revealing secrets or account existence.
- Acknowledge provider deliveries within the required time budget; defer heavier processing safely.
- Store a sanitized webhook receipt/event identity for idempotency and operations.
- Unknown event types are safely ignored or recorded without breaking valid siblings.

Add tests for valid signature, invalid signature, modified body, replay, oversized body, malformed JSON, unknown fields/events, and concurrent duplicate delivery.

### 2C — Inbound messages

Normalize supported inbound text messages into the Phase 1 contact/conversation/message model.

Requirements:

- Resolve the connection server-side from provider identifiers.
- Normalize the sender phone safely.
- Link to an existing contact/lead where deterministic; otherwise create the minimum tenant-scoped contact/conversation state according to a documented rule.
- Use provider message ID plus connection scope for uniqueness.
- Preserve provider timestamp semantics and received-at separately.
- Store only required payload fields. Avoid indefinite raw-payload retention.
- Unsupported media/system types render as a safe placeholder or explicit unsupported event without losing the conversation.
- Concurrent duplicate webhooks produce exactly one logical message.
- Inbound messages never create anonymous tracker conversion events.

The panel must display the new message without requiring unsafe client credentials. Polling or realtime is acceptable if documented and tenant-safe.

### 2D — Outbound panel replies

Allow owner/agent to send a text reply from the conversation UI.

Requirements:

- Validate tenant, connection, conversation, recipient, message length, authorization, and connection health server-side.
- Viewer cannot send.
- Insert an outbound message and durable delivery job atomically.
- Reuse/extend the transactional outbox and worker patterns.
- Use a stable idempotency key so retries and concurrent clicks cannot send twice.
- Track queued, submitted/sent, delivered, read, and failed without overstating provider acknowledgement.
- Render safe retryable/permanent errors to the user.
- Preserve reply history when a send fails.
- Respect Meta conversation-window/template rules. If a template is required, block unsupported free-text instead of attempting an invalid send.

### 2E — Delivery status webhooks

Process sent/delivered/read/failed provider events idempotently.

Requirements:

- Status progression is monotonic where appropriate; late/out-of-order events cannot regress a message.
- Duplicate status events are harmless.
- Failure reason is normalized and sanitized.
- Unknown message IDs do not mutate another tenant and are observable without leaking payloads.
- Status updates are visible in the panel.

### 2F — Operations and kill switch

Add:

- connection health view for internal operators or safe customer status
- queue depth/failure metrics
- dead-letter inspection/requeue using existing authorization patterns
- connection disable/kill switch that prevents new sends but preserves inbound/history policy
- correlation identifiers safe for provider support
- runbook for token revocation, webhook outage, provider throttling, duplicate flood, and rollback

### 2G — Full acceptance and repair loop

Run complete local gates, deploy exact SHA to staging, and verify with the real Meta test/pilot account.

## Mandatory real-provider scenarios

1. Webhook verification succeeds with the configured token and fails with a wrong token.
2. A real inbound text appears once in the correct tenant conversation.
3. Replaying the exact signed webhook creates no duplicate.
4. A real panel reply reaches the approved phone once.
5. Sent/delivered/read states update from real callbacks.
6. Invalid recipient or forced provider failure becomes visible and retry classification is correct.
7. Viewer send is denied.
8. Cross-tenant forged conversation/connection IDs are denied.
9. Rapid double-submit produces one provider send.
10. Out-of-order and duplicate status fixtures do not regress state.
11. Disabled connection prevents outbound sends.
12. Secret/PII scan of logs, Sentry, browser bundle, and audit metadata is clean.
13. Pilot synthetic data cleanup is verified without deleting connection configuration unless explicitly intended.

Mock-only results cannot pass Phase 2. If Meta credentials, public webhook deployment, approved recipient, or provider callbacks are unavailable, record `BLOCKED` and stop.

## Phase 2 exit criteria

- All automated and real-provider staging checks pass on the recorded SHA.
- One beauty business connection works end to end.
- `docs/acceptance/lead-recovery-phase-2.md` records timestamps, provider test identifiers safe to retain, and exact results.
- Phase 2 is `PASS`; no Phase 3 code exists yet.
- User approves merge/advance.
