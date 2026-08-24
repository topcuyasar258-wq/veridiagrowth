# Phase 4 Prompt — Human-approved AI Sales Assistant

## Goal

Add AI that helps staff understand and answer conversations. It may classify service, summarize context, detect intent/objections, retrieve approved business knowledge, and draft a reply. It must not autonomously send external messages in this phase.

## Entry gate

- Phase 3 is `PASS`.
- A sanitized, consent-compatible evaluation fixture set exists.
- Provider/model, data retention, regional/privacy, latency, and cost constraints are explicitly chosen.
- Manual operation continues safely when the AI provider is unavailable.

## Required slices

### 4A — AI boundary and data contract

Create a provider-neutral server-side AI adapter with:

- explicit structured input/output schemas
- model and prompt version
- timeout, retry, circuit breaker, and cancellation
- token/cost/latency accounting without content leakage
- tenant-scoped request identity
- sanitized error classes
- feature flag and global/tenant kill switch

Minimize data sent to the provider. Do not send unrelated tenant data, raw secrets, hidden audit metadata, or unnecessary PII. Document retention and redaction decisions.

### 4B — Taxonomy and structured analysis

Implement structured outputs for:

- service classification
- intent stage
- objection types, allowing multiple and unknown
- urgency/safety escalation flags
- concise conversation summary
- confidence per field or a documented aggregate confidence

Validate all model output against strict schemas. Invalid output is a safe failure, never trusted application state. Store analysis with source conversation version, model, prompt version, timestamps, and human correction history.

### 4C — Knowledge base

Implement tenant/site-scoped approved knowledge content:

- services
- prices/ranges only when explicitly approved and current
- hours/location
- appointment rules
- contraindication/safety disclaimers where applicable
- promotions with effective dates
- policies and escalation contacts

Requirements:

- drafts require owner approval before retrieval
- retrieval never crosses tenant boundaries
- content is versioned and attributable
- expired content is excluded
- answer draft cites internal source identifiers in the UI
- absence/conflict produces abstention, not invention

### 4D — Reply suggestion

Generate a draft reply using conversation context plus retrieved approved knowledge.

Requirements:

- never call the send provider automatically
- owner/agent must approve, edit, or reject
- UI clearly labels AI-generated text
- low-confidence, missing-source, policy conflict, health/safety, harassment, legal, or unsupported cases escalate to a human-only state
- no fabricated price, availability, appointment, guarantee, or medical claim
- suggestions respect opt-out and closed/terminal conversation states
- preserve the exact final human-edited text separately from the model draft

### 4E — Feedback and evaluation

Record:

- accepted unchanged
- accepted after edit
- rejected
- correction labels for classification/intent/objection
- time saved proxy
- latency/cost
- abstention/escalation

Build a deterministic offline evaluation harness with versioned fixtures covering common services, ambiguity, multiple objections, Turkish language variations, slang/typos, prompt injection in customer messages, hostile content, missing knowledge, expired promotions, cross-tenant traps, and safety escalation.

Define thresholds before running final evaluation. Do not tune thresholds after seeing failures merely to pass; fix prompt/retrieval/schema or document a blocker.

### 4F — Prompt injection and privacy hardening

Treat customer messages and knowledge content as untrusted data, not instructions.

Test:

- requests to reveal system prompts/secrets
- instructions to ignore business policy
- embedded fake tool calls/JSON
- requests for another customer/tenant data
- malicious knowledge-base content
- oversized/repeated content
- PII in logs/traces

AI output cannot invoke tools, change database permissions, modify rules, or trigger send by text alone.

## Mandatory acceptance scenarios

1. Service/intent/objection structured output validates on the fixed evaluation set.
2. Summary references only supplied conversation content.
3. Knowledge retrieval returns only active same-tenant approved sources.
4. Missing knowledge causes abstention/escalation.
5. Draft includes source references visible to staff.
6. Low-confidence and safety cases cannot be approved accidentally without the documented escalation flow.
7. AI provider outage leaves manual chat fully functional.
8. Customer prompt injection cannot reveal secrets, cross tenant, call tools, or auto-send.
9. Viewer cannot generate/approve/send suggestions.
10. Concurrent conversation update marks stale AI output and requires regeneration/review.
11. Accept/edit/reject feedback is captured accurately.
12. Cost and latency budgets are measured, not estimated.
13. Real staging provider call uses synthetic content and logs remain sanitized.
14. There is zero autonomous external send.

## Phase 4 exit criteria

- Predeclared evaluation thresholds pass on a versioned fixture set.
- Human approval is enforced in backend/provider path, not only UI.
- Manual fallback and kill switches are verified.
- `docs/acceptance/lead-recovery-phase-4.md` records model/prompt/fixture versions and is `PASS`.
- User approves merge/advance.
