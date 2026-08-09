# Tracker Fail-Open Contract

The tracker runs on sites Veridia does not own, next to a customer's revenue.
The governing rule follows from that:

> **A tracker failure must never become a customer-site failure.**

Analytics is worth strictly less than the page working. Every design decision
below resolves that trade the same way.

## Two invariants

**1. No interaction is ever delayed or cancelled.**

The click listener is registered `passive`, which makes `preventDefault`
impossible at the browser level — not merely absent from the code. Events are
queued and never awaited. A WhatsApp click opens WhatsApp whether or not the
collector answers.

The built bundle is asserted to contain no `preventDefault` at all.

**2. No exception escapes into the page.**

`init` never throws; it returns `null`. Listener bodies, storage access,
serialization and transport are each guarded at the boundary.

Guards sit at the runtime boundary, not wrapped around internal logic, so a
programming error still fails loudly in tests rather than being swallowed.

## Failure matrix

Every row is covered by
[dom-behaviour.test.ts](../tests/tracker/dom-behaviour.test.ts) and
[transport.test.ts](../tests/tracker/transport.test.ts), asserting the page keeps
working.

| Failure                         | Tracker                  | Page  |
| ------------------------------- | ------------------------ | ----- |
| Collector offline / DNS failure | event dropped            | works |
| Collector 500                   | one retry, then dropped  | works |
| Collector 503                   | one retry, then dropped  | works |
| Collector 429                   | dropped, no retry        | works |
| Collector 4xx                   | dropped, no retry        | works |
| Request timeout                 | aborted, dropped         | works |
| CORS rejection                  | dropped                  | works |
| `sendBeacon` missing            | falls back to `fetch`    | works |
| `sendBeacon` returns false      | falls back to `fetch`    | works |
| `sendBeacon` throws             | falls back to `fetch`    | works |
| `fetch` missing                 | event dropped            | works |
| `AbortController` missing       | request not time-bounded | works |
| `localStorage` throws           | memory session           | works |
| Payload not serializable        | dropped                  | works |
| Init throws                     | tracker disabled         | works |
| Listener throws                 | that event lost          | works |
| Tracker script 404 / CSP block  | never loads              | works |

## Retry policy

At most **one** retry, reusing the same `eventId` so the collector deduplicates
it into a single interaction.

No persistent queue and no exponential backoff. A queue that survived reloads
would keep retrying against an outage and turn a collector problem into a
customer-site problem — the exact failure this contract exists to prevent.

A 4xx is never retried: identical bytes cannot become valid.

## Loader

`async`, so it never blocks parsing or rendering. `document.write` and
synchronous XHR are not used.

A 404, a CSP block, an offline network or a syntax error in the tracker artifact
all land in `onerror`, which does nothing. The page renders exactly as it would
without the snippet.

## What is deliberately not done

- No `MutationObserver` and no DOM scan at startup. One delegated listener covers
  dynamically rendered links and forms without ongoing cost.
- No console output in production. A tracker logging on every failure would fill
  a customer's console during a collector outage.
- No synchronous work in the click path beyond a bounded ancestor walk.
