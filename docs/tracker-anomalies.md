# Interaction Anomalies

Internal signal only. No customer UI in Phase 2A, and customers never see raw
anomaly records.

## What this is not

Not a bot classifier and not a security control. It flags traffic that looks
unlike a site's own recent history, so a human can look. No machine learning: an
opaque detector cannot be explained to a customer whose traffic it flagged, and
cannot be pinned by a test.

## Detectors

| Type               | Trigger                                 |
| ------------------ | --------------------------------------- |
| `volume_burst`     | window volume ≥ 3× the rolling baseline |
| `quarantine_spike` | ≥ 30% of a window quarantined           |
| `duplicate_flood`  | ≥ 30% of a window suspicious            |

Current window is 5 minutes; the baseline is the mean of the preceding 12
windows.

## False positives

Two guards, both necessary:

**Minimum sample of 20.** Ratios are meaningless on small numbers. Without this,
one event against a baseline of zero is an infinite spike and a quiet site would
be flagged constantly.

**No baseline, no finding.** A site with no history is never flagged. There is
nothing to compare it against, and a new site's first traffic is not an anomaly.

## Idempotency

`unique (site_id, anomaly_type, window_started_at)`, and the insert is
`ON CONFLICT DO NOTHING`. Running the worker twice over the same window — or
overlapping two runs — writes nothing the second time.

## Contents

Organization, site, type, severity, window bounds, observed count, baseline
count, detection time.

No IP, no IP hash, no session id, no event id, no user agent, no free-form
metadata. A pgTAP assertion checks the table has no such column, so a future
migration cannot quietly add one.

## Customer visibility

Phase 2B may show an aggregate such as "filtrelenen şüpheli trafik: 12". Never
the type, the severity or the threshold — publishing those is a guide to staying
underneath them.
