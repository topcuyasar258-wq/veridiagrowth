# Interaction Events

## Terminology contract

Two things are counted in this system and they are not the same thing.

|              | Interaction                                                            | Verified Lead                |
| ------------ | ---------------------------------------------------------------------- | ---------------------------- |
| Source       | anonymous browser tracker                                              | Phase 1 HMAC-signed Lead API |
| Verified     | no                                                                     | yes, cryptographically       |
| Stored in    | `public.conversion_events`                                             | `public.leads`               |
| Types        | `session_started`, `whatsapp_clicked`, `phone_clicked`, `form_started` | one row per submitted form   |
| Contains PII | never                                                                  | yes, by design               |

An interaction is a signal that someone showed intent. It is not a lead, and it
never becomes one. A browser can be scripted, so nothing it reports is verified.

**Never write, in code, docs, UI copy or a report:**

- "WhatsApp lead" for `whatsapp_clicked`
- "phone lead" for `phone_clicked`
- "form lead" for `form_started`
- any arithmetic that adds interactions to verified leads

Customer-facing wording is "Etkileşimler" (interactions) and "Doğrulanmış
Talepler" (verified leads), reported separately and never summed.

This separation is enforced structurally, not only by convention:

- `conversion_events_event_type_check` permits exactly the four interaction
  types, so `lead_created` cannot physically be stored there.
- `validateInteractionEvent` rejects `lead_created`, `lead_won`, `lead_lost` and
  `purchase` with the dedicated reason `backend_only_event_type`, so an attempt
  is visible in telemetry rather than silently dropped.
- `lead_created` remains a Phase 1 domain event, emitted server-side inside the
  lead-creation transaction.

## PII boundary

The tracker runs inside customer pages that contain real personal data. The
boundary is an **allowlist**: a field is dropped unless explicitly permitted.

Permitted keys, and nothing else:

| Level         | Keys                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| event         | `eventId`, `eventType`, `sessionId`, `occurredAt`, `page`, `attribution`, `trackerVersion`, `integrationVersion` |
| `page`        | `url`, `referrer`                                                                                                |
| `attribution` | `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent`                                                 |

Nested objects and arrays are rejected in leaf positions. There is no free-form
metadata field anywhere in the contract, and no `jsonb` payload column on any
event table — arbitrary JSON is the usual route by which personal data reaches
an analytics endpoint.

Never accepted or stored: names, email, phone, message bodies, form field
values, WhatsApp numbers, `tel:` targets, passwords, addresses, raw IP.

### URL sanitization

Full URLs are never stored. A page URL is reduced to host + path; the query
string is discarded except for the five UTM parameters, which are read into
their own columns.

- `https://example.com/form?email=ada@example.com&utm_source=google`
  → host `example.com`, path `/form`, `utm_source=google`
- Referrers are reduced to a host. A referring page's path can itself leak.
- `whatsapp:`, `tel:`, `mailto:` and `javascript:` targets are rejected rather
  than parsed, because those are exactly the values that carry an identifier.

`conversion_events.page_path` has a CHECK constraint forbidding `?` and `#`, so
a sanitization bug cannot silently persist a query string.

## Data model

| Table                      | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `conversion_events`        | accepted and suspicious interactions             |
| `event_risk_assessments`   | score, band and enumerated signal codes          |
| `quarantined_events`       | held suspicious traffic, enumerated reason codes |
| `event_quotas`             | fixed-window rate-limit counters                 |
| `event_anomalies`          | safe aggregate anomaly records                   |
| `tracker_releases`         | immutable versioned tracker artifacts            |
| `site_tracker_deployments` | which release a site runs, and whether pinned    |
| `site_tracker_keys`        | public per-site tracker identifiers              |

### Event identity

`event_id` is unique per **site**, not globally. Global uniqueness would let any
site burn another site's identifier space by replaying guessed ids, which is a
cross-tenant denial of service. Per-site uniqueness gives the same idempotency
guarantee without that vector: the same event delivered once, twice or twenty
times yields exactly one row.

### Site identification

The tracker is embedded in customer pages, so its identifier is public by
definition. `site_tracker_keys.public_key` (`vtk_` + 32 hex chars) resolves to
site, organization and allowed origins. It is **not** a secret and carries no
authority beyond identifying a site.

The Phase 1 HMAC signing secret in `public.site_credentials` must never reach a
browser. The two live in separate tables specifically so that handing out the
wrong one is not a plausible mistake.

Because browser events are not cryptographically verified, origin and referer
checks raise or lower a risk score — they do not confer trust. An interaction
never becomes a Verified Lead regardless of how clean its origin looks.

## Attribution

Shared with Phase 1 so a lead and the interactions preceding it attribute
identically. There is one classification engine,
`@veridia/shared` `classifySourceCategory`; the lead-ingestion path re-exports it
rather than keeping a copy.

- 30 day window
- the first valid non-direct touch is immutable
- a later valid non-direct touch updates last touch
- a direct touch never overwrites an existing non-direct source
- expired state is dropped whole, so first and last touch always come from the
  same window

Categories are the Phase 1 six: `organic`, `paid_search`, `paid_social`,
`referral`, `direct`, `unknown`.

## Retention

| Data                    | Default |
| ----------------------- | ------- |
| accepted interactions   | 90 days |
| suspicious interactions | 30 days |
| quarantined events      | 30 days |

`expires_at` is set by trigger on insert, so a row is never written without a
retention deadline. The sweep job itself is Slice 4.

## Access

Customers cannot read any table in this document. Every Phase 2 table has RLS
enabled and no grants to `anon` or `authenticated`; only `service_role` has
access. Phase 2B will expose safe aggregates through SECURITY DEFINER RPCs.

Customers will see counts such as "filtrelenen şüpheli trafik: 12". They will
not see risk scores, signal codes or quarantine reasons — those are internal
technical detail.

## Observability

Loggable: event id, site id, safe error category, risk band.

Never loggable: raw IP, full URL with query parameters, form values, phone,
email.
