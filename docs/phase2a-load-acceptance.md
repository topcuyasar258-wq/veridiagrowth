# Phase 2A Load Acceptance

## Status

**Correctness PASS. Throughput ceiling found: ~7 events/sec.**

A dedicated staging project now exists and the harness has been executed against
it. Correctness under concurrency holds without qualification. Capacity does not:
the collector saturates at roughly 7 events per second and does not go faster no
matter how much concurrency is applied.

See [Measured results](#measured-results). Nothing in this document describes
production; staging is a smaller instance and the absolute numbers will differ.

## Why the guards exist

For most of this phase the only hosted Supabase project was the one labelled
PRODUCTION. Running 10,000 synthetic events into it would have written fabricated
traffic into the numbers a customer is shown, with fixtures sitting in the same
tables as real data.

The harness refuses to do that. There is no override flag, on purpose: an
override is the thing someone reaches for at 2am. Now that a staging project
exists the guards still stand — they are what makes it safe to point the harness
at a URL without reading it twice.

### Guards, all verified refusing

| Condition                                      | Result  |
| ---------------------------------------------- | ------- |
| `VERIDIA_ENV` not staging/acceptance           | REFUSED |
| target Supabase URL equals production          | REFUSED |
| target app URL equals production               | REFUSED |
| `VERIDIA_PRODUCTION_SUPABASE_URL` not declared | REFUSED |
| placeholder URL                                | REFUSED |
| events above the 100,000 ceiling               | REFUSED |
| fixture slug missing its prefix                | REFUSED |

The fourth is the subtle one. Without an explicit declaration of what production
is, the "am I pointed at production" check has nothing to compare against and
passes silently — the same vacuous-pass shape as a secret scanner that skips
when its binary is missing.

## Setting up a target

1. Create a second Supabase project for staging.
2. Apply migrations: `supabase db push` against it.
3. Set `VERIDIA_ENV=staging`, `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `VERIDIA_LOAD_APP_URL`, and
   `VERIDIA_PRODUCTION_SUPABASE_URL` pointing at the real production project.
4. Deploy the app against staging.

Creating the project is an account action; it cannot be automated from here.

## Running it

```bash
npm run load:phase2a preflight
npm run load:phase2a seed
npm run load:phase2a run
npm run load:phase2a concurrency-duplicate
npm run load:phase2a concurrency-quota
npm run load:phase2a burst
npm run load:phase2a verify
npm run load:phase2a cleanup
```

| Command                 | What it proves                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `run`                   | 30 sites, 10,000 events, latency and status distribution                                                  |
| `concurrency-duplicate` | 20 simultaneous requests carrying one event id yield exactly one stored interaction, with no 5xx          |
| `concurrency-quota`     | 50 simultaneous requests increment the quota counter exactly 50 times — a lost update would count fewer   |
| `burst`                 | ten times the base concurrency for a short window                                                         |
| `verify`                | judges the last recorded `run` against the error and latency budgets, and scans stored rows for sentinels |

The concurrency commands start every request before awaiting any of them. A loop
with `await` inside would serialise them and prove nothing about a race.

Defaults: 30 sites, 10,000 events, concurrency 20, duplicate concurrency 20,
quota concurrency 50. Overridable through `VERIDIA_LOAD_SITES`,
`VERIDIA_LOAD_EVENTS`, `VERIDIA_LOAD_CONCURRENCY`,
`VERIDIA_LOAD_DUPLICATE_CONCURRENCY`, `VERIDIA_LOAD_QUOTA_CONCURRENCY`, up to the
100,000 ceiling.

Also overridable: `VERIDIA_LOAD_P95_BUDGET_MS` (default 12,000) and
`VERIDIA_LOAD_RESULT_PATH` (default `.load-phase2a.json`, gitignored).

At the measured ~7 events/sec a default 10,000-event run takes roughly 25
minutes. Note that concurrency 20 already saturates the collector, so raising
concurrency does not shorten it — lower `VERIDIA_LOAD_EVENTS` instead.

Event mix is 60% `session_started`, 20% `whatsapp_clicked`, 10%
`phone_clicked`, 10% `form_started` — most visits start a session, fewer convert.

## Acceptance targets

Engineering targets, not a production SLA.

| Metric                          | Target | Gate                      |
| ------------------------------- | ------ | ------------------------- |
| collector 5xx + network errors  | < 0.5% | `ERROR_BUDGET_EXCEEDED`   |
| p95 latency                     | ≤ 12 s | `LATENCY_BUDGET_EXCEEDED` |
| valid accepted events lost      | 0      | run summary               |
| duplicate rows for one event id | 0      | `concurrency-duplicate`   |
| cross-tenant leakage            | 0      | run summary               |
| PII sentinels in storage        | 0      | `PII_LEAK_DETECTED`       |

Reported: requests, events, accepted, duplicate, quarantined, rejected, 429,
4xx, 5xx, p50/p95/p99 latency, and events per second.

The p95 bound is a collapse detector, not a performance target. The collector is
a fire-and-forget beacon, so a slow response costs no visitor anything; what the
bound catches is saturation, where latency climbs without a single 5xx and the
error budget therefore sees nothing wrong. It is set wide on purpose — see
[Measured results](#measured-results) for why 12 s and not 5 s. Override with
`VERIDIA_LOAD_P95_BUDGET_MS`.

`verify` reads the last `run` from `.load-phase2a.json`. With no recorded run it
exits non-zero with `NO_RUN_TO_VERIFY` rather than reporting a 0% error rate
against an empty result — the vacuous-pass shape described above, which this
harness previously had.

## Measured results

Staging, 2026-08-10. 30 fixture sites, single-event requests.

### Concurrency ladder

| concurrency | events | duration | events/sec | p50     | p95     | 5xx | net err |
| ----------- | ------ | -------- | ---------- | ------- | ------- | --- | ------- |
| 20          | 200    | 29.2 s   | 6.85       | 2.76 s  | 3.29 s  | 0   | 0       |
| 50          | 500    | 69.4 s   | 7.20       | 6.78 s  | 8.37 s  | 0   | 0       |
| 100         | 1 000  | 147.0 s  | 6.80       | 13.93 s | 19.71 s | 0   | 0       |
| 200         | 1 998  | 545.1 s  | 3.67       | 26.92 s | 33.84 s | 0   | 2       |

Throughput does not move between concurrency 20 and 100. Latency instead rises
in exact proportion — at concurrency 100, 6.8 events/sec × 14.7 s ≈ 100 requests
in flight. That is Little's Law describing a queue, not a server doing more work:
the collector is already saturated at concurrency 20 and everything above it is
waiting. Past 100 it tips into congestion collapse, where throughput halves and
the first network errors appear.

The knee is around concurrency 50. Above it, extra concurrency buys latency only.

Run-to-run spread is wide: two runs at the default concurrency of 20 measured p95
3.29 s and 6.40 s. Any threshold near 5 s would flap on noise, which is why the
gate sits at 12 s — in the empty gap between healthy (≤ 6.4 s) and collapsed
(≥ 19.7 s).

### Correctness under concurrency

Both pass at concurrency 200, ten times their documented defaults.

| Test                    | Result                                                     |
| ----------------------- | ---------------------------------------------------------- |
| `concurrency-duplicate` | 200 simultaneous requests, one event id → **1** stored row |
| `concurrency-quota`     | 200 simultaneous requests → quota counted **exactly 200**  |

Zero 5xx and zero 429 across roughly 4 100 events. Under pressure the collector
gets slower; it does not get wrong. That is the correct failure mode.

### Where the ceiling comes from

A single-event POST costs seven sequential PostgREST round-trips:

| #   | Call                              | Source                  |
| --- | --------------------------------- | ----------------------- |
| 1   | `resolveSiteKey` SELECT           | `site-resolution.ts:49` |
| 2   | `consumeQuota` scope `site`       | `service.ts:120`        |
| 3   | `consumeQuota` scope `site_ip`    | `service.ts:129`        |
| 4   | `consumeQuota` scope `session`    | `service.ts:138`        |
| 5   | `consumeQuota` scope `event_type` | `service.ts:145`        |
| 6   | `ingest_interaction_event`        | `service.ts:172`        |
| 7   | `touch_site_tracker_deployment`   | `service.ts:186`        |

Calls 2–5 are written as one array literal but each element carries an inline
`await`, so they run one after another rather than together. Call 7 pays a
round-trip on every request even though `throttle_seconds: 300` means it usually
does nothing.

2.8 s ÷ 7 ≈ 400 ms per round-trip, and 7 requests/sec × 7 calls ≈ 49 PostgREST
calls/sec — which is where the instance appears to saturate.

The batching comment at `service.ts:117` ("four counter writes instead of
eighty") is correct for a 20-event batch, but never engages: real tracker traffic
arrives as single-event requests.

### Is ~7 events/sec enough?

For now, yes — it is roughly 600 000 events/day, well beyond current need. It is
recorded here as a known ceiling with a known cause, not as an open defect. The
fix, when it is wanted, is to collapse the four quota calls into one RPC and to
stop paying a round-trip for the throttled deployment touch.

Sentinels planted in fixture data: `phase2-load-secret@example.com`,
`+905551111111`, `LOAD_PRIVATE_MESSAGE`.

## Cleanup

`cleanup` deletes only the prefixed fixture organization, checking the prefix
twice — once against the constant and once against the row the database
returned — then verifies no residue remains. Same pattern as the Phase 1
acceptance cleanup, which is the one that found the trigger bug preventing any
organization from being deleted at all.

## Covered elsewhere

Real browser acceptance, network PII capture, CSP behaviour and Core Web Vitals
are complete and run in CI against real Chromium. See
[tracker-cwv-acceptance.md](tracker-cwv-acceptance.md) and
`tests/browser/`. They need no staging: the fixture server is local.

Hosted load and concurrency were the last piece still blocked. They now run
against staging; the results are above.
