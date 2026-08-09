/**
 * Browser-side data minimisation.
 *
 * The collector sanitizes everything again -- it is the authoritative boundary.
 * This exists so that personal data never leaves the visitor's machine in the
 * first place. Data that is never transmitted cannot leak from a log, a proxy,
 * a crash report or a misconfigured CDN.
 */

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const

export type UtmKey = (typeof UTM_KEYS)[number]
export type UtmValues = Partial<Record<UtmKey, string>>

const MAX_HOST = 253
const MAX_PATH = 512
const MAX_UTM = 128

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}

/**
 * Reduces a location to origin + pathname.
 *
 * The query string is dropped entirely. A customer page can carry personal data
 * there (`?email=`, `?phone=`, `?token=`), and the five UTM parameters are read
 * separately into their own fields.
 */
export function safePageUrl(href: string): string | null {
  try {
    const url = new URL(href)

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null
    }

    return `${url.origin}${truncate(url.pathname || "/", MAX_PATH)}`
  } catch {
    return null
  }
}

/**
 * Reduces a referrer to its origin.
 *
 * The path of a referring page can itself be identifying, and it is not needed
 * for attribution.
 */
export function safeReferrer(referrer: string): string | null {
  try {
    const url = new URL(referrer)

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null
    }

    return truncate(url.origin, MAX_HOST + 8)
  } catch {
    return null
  }
}

/** Reads only the five UTM parameters; every other query parameter is dropped. */
export function readUtm(href: string): UtmValues {
  const result: UtmValues = {}

  try {
    const params = new URL(href).searchParams

    for (const key of UTM_KEYS) {
      const raw = params.get(key)?.trim()
      if (raw) {
        result[key] = truncate(raw, MAX_UTM)
      }
    }
  } catch {
    // A page URL that will not parse yields no attribution rather than an error.
  }

  return result
}

/**
 * Whether an element is inside a form that should never be observed.
 *
 * A password field means login, payment or credential entry. Those forms are
 * skipped entirely so that no analytics code runs near a credential, even
 * though the detectors never read field values anywhere.
 */
export function isCredentialForm(form: HTMLFormElement): boolean {
  try {
    return form.querySelector("input[type='password']") !== null
  } catch {
    // A selector failure means we cannot prove the form is safe, so treat it as
    // a credential form and skip it.
    return true
  }
}
