# Tracker Core Web Vitals Acceptance

## Status

**NOT IMPLEMENTED.** No real-browser or CWV measurement has been run.

## What exists

Slice 3 tests run under happy-dom, which does not lay out or paint. It cannot
produce LCP, INP or CLS. What it does prove is the property that would cause a
regression:

| Measurement                | Result                     |
| -------------------------- | -------------------------- |
| init, 50 links             | 0.073 ms                   |
| init, 5000 links           | 0.180 ms                   |
| listeners attached         | 2, regardless of page size |
| click handling, 2000 links | 0.933 ms                   |

A 100× larger page costs 2.5× the initialisation time, not 100×. There is no DOM
scan at startup, no per-link listener and no `MutationObserver`, so the tracker's
cost does not scale with the customer's page.

## What is missing

Real Chromium (and ideally WebKit) measurement of:

- LCP regression ≤ 100 ms
- INP regression ≤ 20 ms
- CLS delta < 0.01
- zero uncaught tracker errors in a real console
- real network capture of collector request bodies
- CSP acceptance: correct policy, blocked `connect-src`, blocked `script-src`
- real WhatsApp and `tel:` navigation not being prevented

The PII and fail-open properties these would confirm are already asserted under
happy-dom, including real `Blob` payload decoding. A real browser would raise
confidence; it is not currently the only evidence.

## Why it is not done

It needs a browser runner — Playwright or equivalent — plus browser binaries in
CI, a served fixture page and a CSP fixture server. That is a meaningful piece of
infrastructure and it was not built rather than being half-built and reported as
if it had run.

## When it is added

CWV numbers are environment-dependent and flaky as a hard CI gate. They should be
a documented acceptance measurement taken before a rollout, recorded in the
rollout record.

Bundle budgets stay a hard CI gate: they are deterministic, and they are the
input that actually drives the metric.
