# Interaction Collector

`POST /api/v1/collect`

Public endpoint called directly from customer pages. See
[interaction-events.md](interaction-events.md) for the terminology contract and
PII boundary this endpoint enforces.

## Trust model

This endpoint carries **no signature**. A browser cannot hold a signing secret,
so nothing arriving here is verified. Everything it writes lands in the anonymous
interaction tables and never in `public.leads`.

Origin checks, rate limits and risk scoring reduce noise. None of them establish
trust: an interaction never becomes a Verified Lead, however clean it looks.

This is the opposite of `/api/v1/leads`, which is HMAC signed, server-to-server,
and does create verified records.

## Request

```json
{
  "schemaVersion": "2.0",
  "siteKey": "vtk_...",
  "events": [
    {
      "eventId": "...",
      "eventType": "whatsapp_clicked",
      "sessionId": "...",
      "occurredAt": "2026-08-09T11:59:30.000Z",
      "page": { "url": "...", "referrer": "..." },
      "attribution": { "utmSource": "...", "utmMedium": "..." },
      "trackerVersion": "0.1.0",
      "integrationVersion": "1.0.0"
    }
  ]
}
```

Batch size 1 to 20. Body limit `VERIDIA_COLLECT_BODY_LIMIT_BYTES`, default 32 KB.

The body never carries `organizationId` or `siteId`. Tenancy is derived server
side from the site key, so a client cannot address another tenant.

`source_category` is likewise never accepted from the client and is always
derived server side — a client that could assert its own category could relabel
paid traffic as organic.

## Response

`202 Accepted` with counts only:

```json
{ "accepted": 3, "duplicate": 1, "quarantined": 0, "rejected": 0 }
```

No database ids, no per-event risk reasons. Telling a caller which signal caught
it is a tuning guide for evading the filter.

| Condition                                                                | Status                               |
| ------------------------------------------------------------------------ | ------------------------------------ |
| valid batch                                                              | `202`                                |
| malformed JSON, unknown field, backend-only type, batch empty or over 20 | `400`                                |
| unknown, malformed, revoked key, or paused site                          | `404`                                |
| body over limit                                                          | `413`                                |
| quota exceeded past the hard multiplier                                  | `429`                                |
| storage failure                                                          | counted as `rejected` inside a `202` |
| `GET`/`PUT`/`PATCH`/`DELETE`                                             | `405`                                |

Query-string payloads are never accepted: URLs are recorded by proxies and
browser history, and this endpoint handles page context.

## Partial batches

The envelope is all-or-nothing. If any event fails schema validation the whole
request is refused, because a tracker emitting a malformed event is
misconfigured and silently dropping it would hide that.

Once a batch is structurally valid, each event is scored and stored
independently: one high-risk event never discards its valid siblings.

Duplicate ids **inside** a batch are collapsed rather than rejected — a retrying
tracker legitimately resends, and the caller should not lose the batch over it.

## Site key

`site_tracker_keys.public_key`, format `vtk_` + 32 lowercase hex.

Public by definition; it is embedded in page source. Unpredictable only so that
sites cannot be enumerated. It is **not** the Phase 1 HMAC credential, which
lives in a separate table and must never reach a browser.

Unknown, malformed, revoked and paused-site keys all return an identical `404`.
Distinguishing them would let a caller probe which sites exist.

## Origin and CORS

`Origin` and `Referer` are normalized with the Phase 1 `normalizeDomain` helper —
the same function that populated `site_domains` — and compared against the site's
active domains.

| Verdict    | Meaning                                             |
| ---------- | --------------------------------------------------- |
| `match`    | host is a configured domain                         |
| `missing`  | header absent                                       |
| `mismatch` | header present, not configured                      |
| `invalid`  | present but unusable, e.g. the opaque origin `null` |

Only a configured origin is echoed in `Access-Control-Allow-Origin`. Credentials
are never allowed. A wildcard would let any page read collector responses, and
reflecting an arbitrary origin is the same thing with extra steps.

`OPTIONS` preflight is answered without resolving the site key: a preflight has
no body, so there is no key to resolve, and answering differently per site would
leak which sites exist. The real check happens on the `POST`.

## IP handling

Raw IP is never written to the database, logs or Sentry. It is hashed with
`VERIDIA_EVENT_IP_RISK_KEY` for rate limiting only.

This is a **separate key** from the Phase 1 `VERIDIA_IP_RISK_KEY`, and the input
is namespaced (`veridia:event-ip:v1`). Sharing one key across both purposes would
let a hash computed for lead rate limiting be matched against one computed for
interaction analytics, linking a named lead to an anonymous browsing session.
Separate keys keep those spaces disjoint.

## Idempotency

`(site_id, event_id)` is unique. The same event delivered once, twice or twenty
times yields exactly one stored interaction, and redelivery returns `duplicate`
rather than an error — duplicate delivery is normal `sendBeacon` behaviour.

## Storage decisions

| Decision    | conversion_events             | quarantined_events | risk assessment |
| ----------- | ----------------------------- | ------------------ | --------------- |
| accepted    | yes, `risk_status=accepted`   | no                 | no              |
| suspicious  | yes, `risk_status=suspicious` | no                 | yes             |
| quarantined | **no**                        | yes                | yes             |
| rejected    | no                            | no                 | yes             |

A quarantined interaction deliberately gets no `conversion_events` row. One event
must never be countable as two logical records, and a quarantined row in
`conversion_events` could reach a clean metric through a forgotten
`risk_status` filter.

Clean accepted events write no assessment row: assessments exist to explain why
something was _not_ clean.

All of this happens inside `ingest_interaction_event`, so an event is never left
half-stored.

## Performance

Per request, regardless of batch size:

- one site key resolution, including its domains
- four quota writes, one per scope
- one `last_seen_at` touch, throttled to five minutes per site

Per event: one `ingest_interaction_event` call. A 20 event batch therefore costs
one lookup and 20 writes, not 20 lookups.

`last_seen_at` is throttled because updating it on every event would turn one row
per site into a contention point under exactly the traffic this endpoint exists
to handle.

## Logging

Allowed: correlation id, site id, event counts, safe failure category, risk band
counts.

Forbidden: raw IP, full URL, unsafe referrer path, form content, email, phone,
site credential, service role key, raw body.
