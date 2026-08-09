import { normalizeDomain } from "@veridia/security"

/**
 * Origin and referer evaluation.
 *
 * A browser can be scripted and headers can be forged, so a matching origin
 * does not make an event trustworthy. This produces a risk input, never a trust
 * decision: an interaction is never a Verified Lead regardless of how clean its
 * origin looks.
 *
 * Domain normalization is reused from Phase 1 (`normalizeDomain`) rather than
 * reimplemented, so `www.`, protocol and path variants resolve identically in
 * both systems.
 */

export type OriginVerdict = "match" | "missing" | "mismatch" | "invalid"

export interface OriginEvaluation {
  origin: OriginVerdict
  referer: OriginVerdict
}

/**
 * Normalizes a header value to a comparable hostname.
 *
 * Returns `invalid` for anything that is present but unusable, which is a
 * different signal from a header that is simply absent.
 */
function normalizeHeaderHost(
  value: string | null,
): { verdict: "present"; host: string } | { verdict: "missing" | "invalid" } {
  if (value === null || value.trim() === "") {
    return { verdict: "missing" }
  }

  // "null" is what browsers send for opaque origins (sandboxed iframes,
  // file://). It is a real value, not a missing header.
  if (value.trim().toLowerCase() === "null") {
    return { verdict: "invalid" }
  }

  try {
    return { verdict: "present", host: normalizeDomain(value) }
  } catch {
    return { verdict: "invalid" }
  }
}

function compare(
  value: string | null,
  allowedDomains: readonly string[],
): OriginVerdict {
  const normalized = normalizeHeaderHost(value)

  if (normalized.verdict !== "present") {
    return normalized.verdict
  }

  return allowedDomains.includes(normalized.host) ? "match" : "mismatch"
}

/**
 * @param allowedDomains already-normalized hostnames from `site_domains`.
 */
export function evaluateOrigin(
  headers: { origin: string | null; referer: string | null },
  allowedDomains: readonly string[],
): OriginEvaluation {
  return {
    origin: compare(headers.origin, allowedDomains),
    referer: compare(headers.referer, allowedDomains),
  }
}

/**
 * The value to echo in `Access-Control-Allow-Origin`.
 *
 * Only a configured origin is echoed. A wildcard would let any page on the
 * internet read collector responses, and reflecting an arbitrary origin is the
 * same thing with extra steps.
 */
export function resolveAllowedOrigin(
  origin: string | null,
  allowedDomains: readonly string[],
): string | null {
  const normalized = normalizeHeaderHost(origin)

  if (normalized.verdict !== "present") {
    return null
  }

  return allowedDomains.includes(normalized.host) ? origin : null
}
