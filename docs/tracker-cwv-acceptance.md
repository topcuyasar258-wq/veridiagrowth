# Tracker Core Web Vitals Acceptance

## Status

**MEASURED.** Real Chromium, five interleaved runs, medians compared.

| Metric              | Baseline | With tracker | Delta       | Budget   |
| ------------------- | -------- | ------------ | ----------- | -------- |
| LCP                 | 20.0 ms  | 20.0 ms      | **0.0 ms**  | ≤ 100 ms |
| interaction latency | 7.80 ms  | 9.60 ms      | **1.80 ms** | ≤ 20 ms  |
| CLS                 | 0.0000   | 0.0000       | **0.0000**  | < 0.01   |

Environment-dependent engineering guards, not a production SLA. The absolute
numbers describe the machine that ran them; the delta between two runs of the
same page in the same browser is what the tracker is responsible for.

## Method

`tests/browser/cwv.spec.ts`. The same fixture page is loaded twice — once with
the tracker artifact served, once with it 404ing — and the two are compared.

Runs are **interleaved**, not grouped, so a machine that gets busy partway
through affects both arms equally. Five runs, median rather than mean, because a
single sample on a shared runner measures the runner's mood as much as the code.

LCP and CLS come from `PerformanceObserver`. Interaction latency is measured as
click dispatch to second animation frame, which is where synchronous work in the
click path would appear; it is a proxy for INP, not INP itself.

## Unmeasured is not passing

The test asserts LCP was actually observed in at least one run. Without that,
an observer that silently produced nothing would report a delta of zero and pass
— the vacuous-pass shape this repo has been bitten by three times.

## Gate policy

Not a hard CI gate. CWV numbers are environment-dependent and would flake on a
shared runner. They are run in CI and reported; a serious regression fails
because the budgets are asserted, but the budgets are deliberately generous.

Bundle budgets stay a hard gate: they are deterministic, and they are the input
that actually drives this metric.

## Related structural evidence

happy-dom measurements from slice 3 show the property behind these numbers: a
100× larger page costs 2.5× initialisation, two listeners are attached whatever
the page contains, and there is no DOM scan or `MutationObserver` at startup.
