# Interaction Rate Limits

## Scopes

Four counters, all fixed-window, all environment driven.

| Scope        | Key        | Default | Window |
| ------------ | ---------- | ------- | ------ |
| `site`       | site id    | 1000    | 60s    |
| `site_ip`    | hashed IP  | 120     | 60s    |
| `session`    | session id | 60      | 60s    |
| `event_type` | event type | 500     | 60s    |

Environment variables:

```
VERIDIA_EVENT_SITE_RATE_LIMIT_MAX / _WINDOW_SECONDS
VERIDIA_EVENT_SITE_IP_RATE_LIMIT_MAX / _WINDOW_SECONDS
VERIDIA_EVENT_SESSION_RATE_LIMIT_MAX / _WINDOW_SECONDS
VERIDIA_EVENT_TYPE_RATE_LIMIT_MAX / _WINDOW_SECONDS
VERIDIA_EVENT_RATE_HARD_MULTIPLIER
```

These defaults are engineering starting points, not business truth. They are set
high enough that ordinary visitors are never lost.

The `site_ip` key is a keyed hash, never an address. See the IP section of
[interaction-collector.md](interaction-collector.md).

## Graded response

Exceeding a limit is not binary:

| Condition                                  | Result                        |
| ------------------------------------------ | ----------------------------- |
| under limit                                | no signal                     |
| over limit                                 | risk signal, request proceeds |
| over `limit × hard multiplier` (default 5) | whole request refused, `429`  |

A busy real site must not lose visitors to a threshold. A scripted flood must not
be able to grow the database without bound. The multiplier is the gap between
those two requirements.

Because a single rate signal stays below the suspicious band, being briefly over
a limit does not by itself remove an event from a customer's clean metrics.

## Atomicity

Counting happens inside `consume_event_quota` as one
`INSERT ... ON CONFLICT DO UPDATE`. Concurrent callers serialise on the row.

The obvious alternative — read the counter, decide, then write — loses under
concurrency: twenty parallel requests all read the same value and all conclude
they are under the limit. That shape is not used anywhere in this path.

## Fixed windows

Fixed windows rather than a sliding log, because storage stays bounded: one row
per `(site, scope, key, window)`. A sliding log stores one row per event, which
is the wrong shape for an endpoint expected to come under abuse.

The tradeoff is boundary burstiness — a caller can spend a full window's budget
at the end of one window and again at the start of the next. The hard multiplier
absorbs this; a sliding window is only worth revisiting if that becomes a real
problem.

## Per request, not per event

Quotas are consumed once per request with the batch size as the increment. A 20
event batch costs four counter writes, not eighty.

## Failure behaviour

If the quota RPC itself fails, the collector **fails open** and proceeds. Losing
real interactions because a counter row could not be written is worse than
briefly not enforcing a limit, and the risk engine still sees every other signal.

## Isolation

Counters are keyed by site, so one site's traffic can never consume another's
budget. This is asserted in both the pipeline tests and `interaction_collector.test.sql`.
