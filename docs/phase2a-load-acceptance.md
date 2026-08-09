# Phase 2A Load Acceptance

## Status

**BLOCKED_EXTERNAL_ENV** — no dedicated staging project exists.

The harness is written, its guards are tested, and it refuses to run. Nothing
here has been executed against a hosted database, so nothing here is a PASS.

## Why it is blocked, and why that is correct

The only hosted Supabase project is the one labelled PRODUCTION. Running 10,000
synthetic events into it would write fabricated traffic into the numbers a
customer will be shown, and the fixtures would sit in the same tables as real
data.

The harness therefore refuses. There is no override flag, on purpose: an
override is the thing someone reaches for at 2am.

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

## Unblocking

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
npm run load:phase2a verify
npm run load:phase2a cleanup
```

Defaults: 30 sites, 10,000 events, concurrency 20. Overridable through
`VERIDIA_LOAD_SITES`, `VERIDIA_LOAD_EVENTS`, `VERIDIA_LOAD_CONCURRENCY`, up to
the 100,000 ceiling.

Event mix is 60% `session_started`, 20% `whatsapp_clicked`, 10%
`phone_clicked`, 10% `form_started` — most visits start a session, fewer convert.

## Acceptance targets

Engineering targets, not a production SLA.

| Metric                          | Target |
| ------------------------------- | ------ |
| collector 5xx                   | < 0.5% |
| valid accepted events lost      | 0      |
| duplicate rows for one event id | 0      |
| cross-tenant leakage            | 0      |
| PII sentinels in storage        | 0      |

Reported: requests, events, accepted, duplicate, quarantined, rejected, 429,
4xx, 5xx, and p50/p95/p99 latency.

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

The only thing still blocked is hosted load and concurrency.
