# Tracker Privacy Boundaries

The tracker runs inside pages containing real personal data: contact forms,
phone numbers, WhatsApp links. This document states what it may observe, and why
each boundary is drawn where it is.

## Never collected

Names, email addresses, phone numbers, message bodies, any form field value,
WhatsApp numbers, `tel:` targets, passwords, addresses, query-string parameters,
raw IP, and any cross-site or advertising identifier.

## No fingerprinting

Explicitly not implemented, and not to be added without a policy decision:
canvas, audio and font fingerprinting, device signatures, cross-site identifiers,
persistent advertising-style profiles.

A session id is random and short-lived. It cannot recognise the same person on
another site, and it cannot survive its own expiry.

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
