# Interaction Risk Model

Internal engineering document. Not customer facing — see the customer wording
rules in [interaction-events.md](interaction-events.md).

## What this is and is not

`evaluateInteractionRisk` is a pure function that filters obviously bad data from
a public endpoint. It is **not** authentication. Public browser analytics is
trivially forgeable, and no score makes an interaction a Verified Lead.

Deliberately excluded:

- **Fingerprinting** (canvas, audio, device). A privacy boundary this product
  does not cross.
- **Machine learning.** An opaque model cannot be explained to a customer whose
  traffic it filtered, and cannot be pinned by a boundary test.

The function takes no clock, no network and no randomness, so the same input
always yields the same decision.

## Bands

| Score  | Decision      | Effect                                                     |
| ------ | ------------- | ---------------------------------------------------------- |
| 0–29   | `accepted`    | stored, counted in clean metrics                           |
| 30–59  | `suspicious`  | stored and flagged, excluded from clean metrics            |
| 60–79  | `quarantined` | held in `quarantined_events`, not stored as an interaction |
| 80–100 | `rejected`    | not stored                                                 |

Boundaries are pinned by tests. Changing one changes what is filtered from a
customer's data.

## Weights

| Signal                     | Weight |
| -------------------------- | ------ |
| `origin_mismatch`          | 60     |
| `origin_invalid`           | 55     |
| `site_ip_rate_elevated`    | 25     |
| `session_rate_elevated`    | 25     |
| `site_rate_elevated`       | 20     |
| `event_type_rate_elevated` | 20     |
| `future_timestamp`         | 20     |
| `origin_missing`           | 15     |
| `stale_timestamp`          | 15     |
| `user_agent_missing`       | 15     |
| `referer_mismatch`         | 10     |
| `invalid_sequence`         | 10     |
| `duplicate_event_id`       | 5      |

Score is the sum, clamped to 0–100. Reason codes are sorted by weight, so the
primary quarantine reason is the signal that actually drove the decision.

## Calibration reasoning

**`origin_mismatch` reaches the quarantine band alone.** An event claiming to
come from a site whose origin matches none of its configured domains is not
usable data. It is held rather than discarded, because the likeliest innocent
cause is a domain nobody configured yet.

**Every rate signal stays below the suspicious band alone.** A real visitor on a
busy site must never be filtered for being one of many. This matters most for
`site_ip`: corporate networks, mobile carrier NAT and shared exits put many
genuine visitors behind one address, so an IP-derived signal is the likeliest to
catch innocent traffic. Rate signals only escalate when they accumulate — two
together reach `suspicious`, three reach `quarantined`.

**`duplicate_event_id` is near zero.** Duplicate delivery is normal `sendBeacon`
behaviour, not evidence of abuse. Idempotency already handles it correctly.

**`invalid_sequence` is a weak signal.** An interaction arriving before its
`session_started` usually means a beacon was lost or reordered, which is routine
on mobile networks. A strict state machine here would discard real conversions.

**A referer mismatch is not counted when the origin already mismatched**, so one
underlying cause is not scored twice.

## Rate limit interaction

Quota outcomes feed the risk engine rather than blocking directly:

- **over the limit** → risk signal, request proceeds
- **over `limit × VERIDIA_EVENT_RATE_HARD_MULTIPLIER`** → whole request refused
  with `429`

This keeps a burst of genuine traffic from being dropped while still bounding
what a scripted flood can write. See
[interaction-rate-limits.md](interaction-rate-limits.md).

## Reject telemetry

Rejected events write only a risk assessment row and no interaction. This is
bounded by the same quota that produced the rejection: a flood extreme enough to
matter trips the hard multiplier and is refused at `429` before reaching
storage, so reject telemetry cannot itself become the denial of service.

## Customer visibility

Customers never see scores, signal codes or quarantine reasons. They will see an
aggregate such as "filtrelenen şüpheli trafik: 12". The technical reason is
internal, both because it is meaningless to them and because publishing it is a
guide to evading the filter.
