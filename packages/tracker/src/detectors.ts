/**
 * Click and form detectors.
 *
 * Detection answers one question only: did the visitor interact with a WhatsApp
 * link, a phone link, or a marked form. It never reads what the link points at
 * or what the form contains.
 *
 * `wa.me/905551234567` and `tel:+905551234567` are phone numbers. The detector
 * matches on the URL shape and then discards the URL entirely; the number never
 * reaches a payload.
 */

import { isCredentialForm } from "./sanitize"

export type InteractionKind = "whatsapp" | "phone"

const WHATSAPP_HOSTS = ["wa.me", "api.whatsapp.com", "web.whatsapp.com"]

/** Explicit opt-in for links the host patterns cannot recognise. */
export const TRACK_ATTRIBUTE = "data-veridia-track"
export const FORM_ATTRIBUTE = "data-veridia-form"

export function classifyHref(href: string | null): InteractionKind | null {
  if (!href) {
    return null
  }

  const value = href.trim().toLowerCase()

  if (value.startsWith("whatsapp:")) {
    return "whatsapp"
  }

  if (value.startsWith("tel:")) {
    return "phone"
  }

  try {
    const url = new URL(href, "https://placeholder.invalid")

    if (url.protocol === "http:" || url.protocol === "https:") {
      const host = url.hostname.toLowerCase().replace(/^www\./, "")
      if (WHATSAPP_HOSTS.includes(host)) {
        return "whatsapp"
      }
    }
  } catch {
    return null
  }

  return null
}

/**
 * Walks up from the clicked node to find a trackable ancestor.
 *
 * A click usually lands on a `<span>` or `<img>` inside the anchor, so the
 * event target itself is rarely the link.
 */
export function findInteraction(
  target: EventTarget | null,
): InteractionKind | null {
  let node = target as Element | null
  let depth = 0

  // Bounded so a pathological DOM cannot turn one click into a long task.
  while (node && depth < 10) {
    if (node.getAttribute) {
      const explicit = node.getAttribute(TRACK_ATTRIBUTE)

      if (explicit === "whatsapp" || explicit === "phone") {
        return explicit
      }

      if (node.tagName === "A") {
        const kind = classifyHref(node.getAttribute("href"))
        if (kind) {
          return kind
        }
      }
    }

    node = node.parentElement
    depth += 1
  }

  return null
}

/**
 * Finds the marked form an element belongs to.
 *
 * Only forms carrying `data-veridia-form` are observed. Watching every form on
 * the page would put analytics code next to logins and checkouts that have
 * nothing to do with lead capture.
 */
export function findTrackedForm(
  target: EventTarget | null,
): { form: HTMLFormElement; formKey: string } | null {
  let node = target as Element | null
  let depth = 0

  while (node && depth < 10) {
    if (node.tagName === "FORM" && node.hasAttribute?.(FORM_ATTRIBUTE)) {
      const form = node as HTMLFormElement

      // Password fields mean credential entry. Skipped outright, even though no
      // detector reads values anywhere.
      if (isCredentialForm(form)) {
        return null
      }

      const raw = form.getAttribute(FORM_ATTRIBUTE) ?? ""
      return { form, formKey: normalizeFormKey(raw) }
    }

    node = node.parentElement
    depth += 1
  }

  return null
}

/**
 * The developer-supplied form name, reduced to a short safe token.
 *
 * Bounded and character-restricted so the attribute cannot be used to smuggle
 * arbitrary text out of the page.
 */
function normalizeFormKey(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
  return cleaned.slice(0, 32) || "default"
}
