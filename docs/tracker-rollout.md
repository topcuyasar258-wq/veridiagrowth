# Tracker Rollout Runbook

## Sequence

Each step must hold for its stated soak time before the next begins.

| Step | Scope                     | Soak                 |
| ---- | ------------------------- | -------------------- |
| 1    | Veridia's own site        | 24h                  |
| 2    | dedicated staging fixture | full load acceptance |
| 3    | one internal test site    | 24h                  |
| 4    | one consenting customer   | 48h                  |
| 5    | 20% of sites              | 48h                  |
| 6    | 50% of sites              | 48h                  |
| 7    | all sites                 | —                    |

Steps 1–4 use pinning: the release stays `canary` and only pinned sites load it.
The global default does not move until step 5.

## Rollback conditions

**Immediate, no discussion:**

- any PII in a collector payload or in storage
- any customer-site breakage — a link, a form or a page that stopped working
- cross-tenant data exposure
- valid interactions being lost

**Investigate, roll back if not explained within one hour:**

- collector 5xx above 0.5%
- quarantine rate materially above the pre-rollout baseline
- uncaught tracker errors in browser consoles
- LCP regression above 100ms or INP above 20ms
- duplicate interactions for a single event id

The first group is not a judgement call. Rolling back costs one command; leaving
a leak in place while it is discussed does not have a bounded cost.

## Procedure

```sql
select public.rollback_tracker_release('0.1.0');
```

Propagation is bounded by the config cache TTL, five minutes. No customer action
and no snippet edit.

Afterwards: confirm the failing release shows `rolled_back`, confirm pinned sites
are unaffected, and confirm the error signal that triggered the rollback has
returned to baseline.

## Before starting

- CI green, including pgTAP against real PostgreSQL
- bundle budgets within limits
- load acceptance passed on dedicated staging
- artifact hash recorded in `tracker_releases`
- previous stable release still present and activatable

## What is not automated

Percentage rollout is manual pinning in Phase 2A. There is no traffic-splitting
service, and none is needed at this scale — a wrong automatic split is harder to
diagnose than a deliberate list of sites.
