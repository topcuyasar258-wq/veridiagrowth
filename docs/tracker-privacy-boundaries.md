# Tracker Privacy Boundaries

The tracker runs inside pages containing real personal data: contact forms,
phone numbers, WhatsApp links. This document states what it may observe, and why
each boundary is drawn where it is.

## Never collected

Names, email addresses, phone numbers, message bodies, any form field value,
WhatsApp numbers, `tel:` targets, passwords, addresses, raw IP, and any
cross-site identifier.

Query-string parameters are dropped except the five UTM keys and the four
advertising click ids named under [Marketing identity](#marketing-identity).

## No fingerprinting

Explicitly not implemented, and not to be added without a policy decision:
canvas, audio and font fingerprinting, device signatures, cross-site
identifiers.

The distinction that matters is not persistent versus temporary, but whether
the visitor can end it. A fingerprint is recomputed from the device, so it
returns whether the visitor wants it to or not. Every identifier here is
random, stored in the browser, and gone for good once cleared.

A session id is random and short-lived. It cannot recognise the same person on
another site, and it cannot survive its own expiry.

## Marketing identity

Two kinds of field can outlive a single visit. Both are governed by
`marketingConsent`, a switch separate from `shouldTrack`, because counting
anonymous interactions and building an advertising audience are different
purposes. Omitting the callback means denied: a site that never sets it behaves
exactly as it did before these fields existed.

| Field                       | What it is                                      |
| --------------------------- | ----------------------------------------------- |
| `visitorId`                 | random per-site identity in browser storage     |
| `gclid`, `gbraid`, `wbraid` | Google Ads click ids, read from the landing URL |
| `fbclid`                    | Meta click id, read from the landing URL        |

A click id identifies an ad click rather than a person, and only the platform
that issued it can resolve it. It is still an advertising identifier, so it sits
behind the same consent as the visitor id.

### The visitor id is per site

`localStorage` is origin-scoped, so a value written on one customer's site
cannot be read on another's — a property of the browser, not a promise made by
this code. The storage key also carries the site key, so two sites sharing one
origin still hold separate identities.

The consequence is deliberate: a Veridia-wide visitor graph cannot happen by
accident. Building one would take a new mechanism, written on purpose. Nothing
here grows into one on its own.

### Consent is read per event, not at startup

A visitor who accepts or withdraws consent mid-visit is honoured from that
moment. Withdrawal is not a filter applied over stored data — it erases the
visitor id and the click ids, so a later grant starts a new identity rather than
resurrecting the old one. A consent callback that throws counts as a refusal.

An identity is also withheld when browser storage cannot persist it, as in
private mode. A value regenerated on every page load would look like a stream of
one-visit strangers and would quietly corrupt any audience built from it.

### Still refused

- Marketing identity is stored on accepted events only. A quarantined event is
  one the risk model did not trust, and suspected bot traffic must not enter an
  audience.
- No demographic inference. Age, gender and similar attributes cannot be derived
  from click behaviour and are not guessed from it.
- No cross-customer pooling, per the scope rule above.

## Page context

Only origin + pathname. The query string is dropped in the browser, before
anything is sent:

```
https://example.com/form?email=ada@example.com&token=abc
  →  https://example.com/form
```

The referrer is reduced to its origin. A referring page's path can itself be
identifying and is not needed for attribution.

Non-http schemes (`whatsapp:`, `tel:`, `mailto:`, `javascript:`) are rejected
rather than parsed, because those are exactly the values that carry an
identifier.

### Page context is a snapshot

Captured at page load and at SPA navigation, never inside a click handler.

This is not a micro-optimisation. Reading `location.href` during a click can
return the _link target_ if navigation has already begun — and for a WhatsApp
link that target is a phone number. An early version of this tracker did exactly
that and leaked `wa.me/905551234567` into a payload; the DOM test now pins the
correct behaviour. It is also semantically right: the interaction happened on the
page the visitor was on, not on the destination.

## Link detection without link data

Detection matches on URL shape and then discards the URL. `wa.me/905551234567`
is recognised as a WhatsApp link; the number never enters a payload. The same
applies to `tel:`.

## Forms

Only `[data-veridia-form]` forms are observed. Detection uses `focusin`, which
fires before the visitor types anything.

**No field value is ever read.** Not `input.value`, not `FormData`, not on
submit. The detector does not need a value to know a form was engaged.

Forms containing `<input type="password">` are skipped entirely. Login, payment
and credential forms are not lead capture, and no analytics code should run next
to a credential — even code that reads nothing.

Third-party iframes are never inspected.

## Identifiers

Session and event ids come from `crypto.randomUUID()` or `getRandomValues`. If
neither exists the tracker refuses to generate an id and disables itself rather
than falling back to `Math.random`, which would let anyone forge or collide
another visitor's session. The built bundle is asserted to contain no
`Math.random`.

## What the browser does not decide

The tracker sends no risk score and no `sourceCategory`. Risk lives in the
collector; the category is derived server side. A client that could assert its
own category could relabel paid traffic as organic.

Tenancy is likewise never client-supplied: the payload carries the public site
key, and the collector resolves organization and site from it.

## Verification

- [dom-behaviour.test.ts](../tests/tracker/dom-behaviour.test.ts) runs against a
  fixture containing live sentinels — an email, a phone number, a message body, a
  WhatsApp number, a `tel:` target and query parameters — and asserts every
  captured request body against all of them.
- The capture decodes the real `Blob` the transport sends. An earlier version
  recorded a placeholder string, and every assertion passed without inspecting a
  payload; that failure mode is now impossible.
- [bundle-security.test.ts](../tests/tracker/bundle-security.test.ts) asserts the
  built artifact carries no signing logic, no secret names and no server SDK.
