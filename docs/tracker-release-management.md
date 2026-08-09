# Tracker Release Management

## Lifecycle

```
draft ──► canary ──► active ──► deprecated
                       │
                       └──► rolled_back
```

Enforced in the database, not in application code, so no caller can reach an
invalid state and a rollback is a single atomic step.

| State         | Meaning                                           |
| ------------- | ------------------------------------------------- |
| `draft`       | built, not published; may have no artifact hash   |
| `canary`      | published, served only to explicitly pinned sites |
| `active`      | the default every unpinned site loads             |
| `deprecated`  | superseded by a newer active release              |
| `rolled_back` | withdrawn because it was faulty                   |

`deprecated` and `rolled_back` are kept distinct on purpose: one records a normal
succession, the other records that a release failed. That difference is the
first thing anyone asks during an incident review.

## Immutability

A published version's artifact hash and version string cannot be changed. A
trigger rejects the update.

Shipping different bytes under a version customers may already have cached is
indistinguishable from an attack, and impossible to reason about afterwards. New
code means a new version.

A release cannot be activated without an artifact hash, so nothing unverifiable
becomes the default.

## Single active release

`unique index on (status) where status = 'active'`. Activation demotes the
outgoing release **before** promoting the new one — the index is checked
immediately, so the other order would collide with itself.

## Operations

| Function                       | Purpose                             |
| ------------------------------ | ----------------------------------- |
| `publish_tracker_release`      | register a build as draft or canary |
| `activate_tracker_release`     | make it the default                 |
| `rollback_tracker_release`     | return to a previous release        |
| `resolve_site_tracker_release` | which artifact a site should load   |

All service-role only. A customer cannot change what code their own site
serves, let alone anyone else's.

## Pinning

`site_tracker_deployments.pinned` with a `tracker_release_id`. A pinned site
keeps its version when the global default moves.

That is the whole point: a customer mid-incident, or one validating a specific
version, must not be moved by an unrelated rollout.

`resolve_site_tracker_release` returns the pinned release if there is one, and
the active release otherwise.

## Rollback

```
active = 0.2.0, previous stable = 0.1.0
rollback_tracker_release('0.1.0')
  → 0.2.0 becomes rolled_back
  → 0.1.0 becomes active
```

No customer edits their snippet. The loader asks the config endpoint which
version to load, so the change propagates on its own.

Worst-case propagation is the config cache TTL — five minutes.

## Cache policy

| Resource                 | Cache                 |
| ------------------------ | --------------------- |
| `tracker-v0.1.0.js`      | immutable, long-lived |
| `loader.js`              | short, minutes        |
| `/api/v1/tracker-config` | `max-age=300`         |

The versioned artifact is immutable by contract, so it can be cached
indefinitely. The config is the indirection that makes rollback possible and
must therefore expire quickly. Five minutes is the deliberate trade between
rollback speed and querying the database on every page view.

## Config endpoint

`GET /api/v1/tracker-config?siteKey=vtk_...`

```json
{ "trackerVersion": "0.1.0", "artifactSha256": "...", "pinned": false }
```

Nothing else. No organization id, no site id, no domain list, no risk
configuration — everything here is readable by anyone viewing a customer page's
source.

Unknown, malformed, revoked keys and paused sites all return an identical `404`,
so site existence cannot be probed.
