# Tracker CSP Requirements

## Directives

| Directive     | Needs                                                      |
| ------------- | ---------------------------------------------------------- |
| `script-src`  | the loader/tracker origin, e.g. `https://cdn.example.com`  |
| `connect-src` | the collector origin, e.g. `https://collector.example.com` |

Example:

```
Content-Security-Policy:
  script-src 'self' https://cdn.example.com;
  connect-src 'self' https://collector.example.com;
```

`connect-src` covers both `navigator.sendBeacon` and `fetch`. Missing it is the
usual cause of a tracker that loads but reports nothing.

## If CSP blocks the tracker

The site works; the tracker does not. That is the intended outcome, not a
degraded one — see [tracker-fail-open.md](tracker-fail-open.md).

A blocked script never executes, so no listener is attached. A blocked
`connect-src` makes `sendBeacon` return `false` or throw and `fetch` reject; both
are handled, and the click still navigates.

## Nonces

Automatic nonce propagation is not implemented in v0.1. If a strict
`script-src 'nonce-...'` policy is in force, add the nonce to the loader tag:

```html
<script
  async
  nonce="{{cspNonce}}"
  src="..."
  data-veridia-site="vtk_..."
></script>
```

The loader creates the tracker `<script>` element dynamically. Under a
nonce-based policy that injected element inherits no nonce and will be blocked,
so a nonce-only policy requires allowlisting the tracker origin as well.

## Inline code

The tracker adds no inline script and no inline style, so `unsafe-inline` is
never required on its account.

## Subresource integrity

Not used. The tracker artifact is versioned and immutable
(`tracker-v0.1.0.js`), so pinning a version already fixes the bytes. SRI on the
loader is possible if the loader is also pinned per release.

## Reporting

If a customer reports the tracker not working, check the browser console for a
CSP violation naming either the script origin or the connect origin. The tracker
itself stays silent by design and will not tell you.
