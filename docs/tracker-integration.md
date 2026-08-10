# Tracker Integration

## Install

One tag, before `</body>` or in `<head>`:

```html
<script
  async
  src="https://veridiagrowth-growth.vercel.app/t/loader.js"
  data-veridia-site="vtk_..."
></script>
```

`async` is required. The loader never blocks parsing, never calls
`document.write` and never issues a synchronous request.

## Where the files are served from

`npm run tracker:build` publishes both artifacts into
`apps/dashboard/public/t/`, so they ship with the application and sit behind the
same origin as the collector — which is also why `data-veridia-collector` can
default to the loader's own origin. The root `build` script runs it first, which
is what puts them on a deployment.

| File            | Cache             | Why                                                              |
| --------------- | ----------------- | ---------------------------------------------------------------- |
| `loader.js`     | 5 minutes         | the indirection a rollback travels through                       |
| `tracker-v*.js` | 1 year, immutable | the version is in the filename, so the contents can never change |

The loader resolves `tracker-v{version}.js` **relative to its own `src`**, so
the two files must stay siblings. Serving the loader from one host and the
versioned bundle from another silently breaks version pinning.

The five-minute loader cache is not a tuning choice: `rollback_tracker_release`
reaches customer pages only as fast as that entry expires. It matches the config
cache TTL in [tracker-rollout.md](tracker-rollout.md) so the two propagate
together.

### Attributes

| Attribute                  | Required | Default                                    |
| -------------------------- | -------- | ------------------------------------------ |
| `data-veridia-site`        | yes      | —                                          |
| `data-veridia-collector`   | no       | `/api/v1/collect` on the loader's origin   |
| `data-veridia-version`     | no       | `0.1.0`                                    |
| `data-veridia-tracker`     | no       | `tracker-v<version>.js` next to the loader |
| `data-veridia-integration` | no       | `1.0.0`                                    |

### Site key

`data-veridia-site` is the **public** tracker key from `site_tracker_keys`. It is
embedded in page source by design and identifies a site; it grants nothing else.

It is not the Phase 1 HMAC credential. That secret lives in a separate table,
never reaches a browser, and the tracker bundle contains no signing code at all —
[bundle-security.test.ts](../tests/tracker/bundle-security.test.ts) asserts this
on the built artifact.

## Events

Four, and only four:

| Event              | Trigger                          |
| ------------------ | -------------------------------- |
| `session_started`  | once per session                 |
| `whatsapp_clicked` | click on a WhatsApp link         |
| `phone_clicked`    | click on a `tel:` link           |
| `form_started`     | first focus inside a marked form |

These are **Interactions**, not Verified Leads. See
[interaction-events.md](interaction-events.md) for the terminology contract that
this distinction is held to.

There is no `page_view` in Phase 2A.

## WhatsApp links

Detected automatically:

- `https://wa.me/...`
- `https://api.whatsapp.com/...`
- `https://web.whatsapp.com/...`
- `whatsapp://...`

Or mark any element explicitly:

```html
<button data-veridia-track="whatsapp">WhatsApp</button>
```

The phone number in the link is never sent. Only the event type and the current
page context leave the browser.

## Phone links

`tel:` links are detected automatically, or mark explicitly:

```html
<button data-veridia-track="phone">Ara</button>
```

## Forms

Only forms you mark are observed:

```html
<form data-veridia-form="contact">
  <input name="email" />
</form>
```

The attribute value is a short developer-chosen name, reduced to
`[a-z0-9_-]{1,32}`. One `form_started` per form per session.

**Field values are never read.** Not on focus, not on submit, not ever. A form
containing a `<input type="password">` is skipped entirely — see
[tracker-privacy-boundaries.md](tracker-privacy-boundaries.md).

Unmarked forms are invisible to the tracker. Marking every form on a site would
put analytics code next to logins and checkouts that have nothing to do with
lead capture.

## Single-page apps

`pushState`, `replaceState` and `popstate` are hooked to refresh page context and
attribution. SPA navigation does **not** start a new session and emits no event.

Links and forms rendered after load work without any extra step: detection uses
one delegated listener on the document, so there is no DOM scan and no
`MutationObserver`.

## Programmatic use

```ts
VeridiaTracker.init({
  siteKey: "vtk_...",
  collectorUrl: "https://collector.example.com/api/v1/collect",
  trackerVersion: "0.1.0",
  integrationVersion: "1.0.0",
  shouldTrack: () => userHasConsented(),
})
```

`init` never throws and returns `null` when the tracker cannot start.

Loading the snippet twice is safe: the second call returns the existing instance
rather than attaching a second set of listeners.

`tracker.destroy()` removes every listener and restores the patched history
methods. Intended for tests and for SPA teardown.

## Consent

There are two switches, because analytics and advertising are different purposes
and most consent regimes treat them separately.

`shouldTrack()` governs the tracker as a whole. Whether tracking is lawful
without consent is a decision for the site operator and their counsel, so no
cookie banner behaviour and no Do Not Track policy is hardcoded here. Return
`false` and the tracker stays inert — no listeners, no storage, no requests.

`marketingConsent()` governs the persistent visitor id and the advertising click
ids (`gclid`, `gbraid`, `wbraid`, `fbclid`), and nothing else. Omit it and those
fields are never collected, which is exactly how the tracker behaved before they
existed.

```ts
VeridiaTracker.init({
  siteKey: "vtk_...",
  collectorUrl: "https://collector.example.com/api/v1/collect",
  shouldTrack: () => consent.analytics,
  marketingConsent: () => consent.marketing,
})
```

Both are read fresh every time they matter, so a banner that resolves after page
load is honoured without a reload. Withdrawing marketing consent also erases the
visitor id and click ids already stored, so granting it again starts a new
identity. A callback that throws counts as a refusal.

See [tracker-privacy-boundaries.md](tracker-privacy-boundaries.md) for what each
field is, and why the visitor id cannot span two sites.

## Browser support

Modern evergreen Chrome, Safari, Firefox and Edge. No IE.

Missing `sendBeacon`, `fetch`, `AbortController`, `crypto.randomUUID` or
`localStorage` are all handled: the tracker degrades or disables itself and the
page is unaffected.

## Bundle sizes

| Artifact            | Budget (gzip) |
| ------------------- | ------------- |
| `loader.js`         | 5 KB          |
| `tracker-v0.1.0.js` | 25 KB         |

Enforced by `npm run tracker:build`, which fails CI when exceeded. Bundle growth
is incremental — no single change looks expensive — so this is a gate, not a
review item.

## Debugging

`debug: true` enables development-only console warnings. Production is silent:
a tracker that logged on every failure would fill a customer's console during a
collector outage, turning an invisible problem into a visible one.
