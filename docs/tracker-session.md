# Tracker Session and Attribution

## Session

An anonymous, first-party, short-lived identifier scoped to one site.

| Property           | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| Inactivity timeout | 30 minutes                                                   |
| Id source          | `crypto.randomUUID()`, else `getRandomValues`                |
| Stored fields      | `sessionId`, `createdAt`, `lastActivityAt`, `startedEmitted` |
| Storage key        | `veridia.session.v1`                                         |

Any activity refreshes the window. A session that has been idle longer than the
timeout is replaced.

A stored timestamp **in the future** is treated as expired. A clock that moved
backwards would otherwise pin one session open indefinitely.

Corrupt or partially-shaped stored state is discarded and rebuilt rather than
repaired.

### session_started

Exactly one per session. `startedEmitted` is written **before** the network call,
so a failed send never produces a second `session_started` for the same session.

SPA navigation does not create a session. Loading the snippet twice does not
create a second one.

## Storage

`localStorage`, probed with a real write at startup — `typeof localStorage` is
not enough, because Safari private mode exposes the object and throws on use.

Every read and write is individually guarded, since quota can be exhausted at any
time, not only at startup. On failure the tracker falls back to memory.

Without persistent storage, analytics is less accurate across page loads: each
load starts a new session. The customer's site is unaffected. That is the correct
trade in both directions.

## Attribution

Merge rules come from `@veridia/shared` `applyTouch` — the same function Phase 1
lead attribution uses. A second implementation would drift and make a lead and
the interactions preceding it disagree about the same visit.

| Rule        | Behaviour                                      |
| ----------- | ---------------------------------------------- |
| Window      | 30 days                                        |
| First touch | first valid non-direct touch, immutable        |
| Last touch  | updated by each later valid non-direct touch   |
| Direct      | never overwrites an existing non-direct source |
| Expiry      | state is discarded whole, never partially      |

Storage key `veridia.attribution.v1`, with an explicit `expiresAt`.

Expired state is dropped entirely rather than partially kept, so first and last
touch can never come from different windows.

Attribution is re-observed on SPA navigation, so a campaign click mid-session is
recorded without a full page load.

### UTM

Only the five standard parameters are read: `utm_source`, `utm_medium`,
`utm_campaign`, `utm_term`, `utm_content`. Every other query parameter is
discarded in the browser.

### Source category

The browser never sends one. It reports the touch it observed; the collector
derives the category server side using the shared classification engine.
