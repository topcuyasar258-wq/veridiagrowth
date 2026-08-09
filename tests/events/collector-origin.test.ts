import { describe, expect, it } from "vitest"

import {
  evaluateOrigin,
  resolveAllowedOrigin,
} from "../../apps/dashboard/src/server/interaction-collector/origin"
import { isWellFormedSiteKey } from "../../apps/dashboard/src/server/interaction-collector/site-resolution"

// Already normalized, as stored in site_domains.
const allowed = ["example.com", "shop.example.com"]

function headers(origin: string | null, referer: string | null = null) {
  return { origin, referer }
}

describe("evaluateOrigin", () => {
  it("matches a configured origin", () => {
    expect(evaluateOrigin(headers("https://example.com"), allowed).origin).toBe(
      "match",
    )
  })

  it("matches through the shared Phase 1 normalization", () => {
    // www, protocol, port, trailing path all collapse to the same host, using
    // the same normalizer site_domains was populated with.
    for (const origin of [
      "https://www.example.com",
      "http://example.com",
      "https://example.com/",
      "example.com",
    ]) {
      expect(evaluateOrigin(headers(origin), allowed).origin).toBe("match")
    }
  })

  it("flags an unconfigured origin as a mismatch", () => {
    expect(evaluateOrigin(headers("https://evil.com"), allowed).origin).toBe(
      "mismatch",
    )
  })

  it("does not treat a suffix as a match", () => {
    // notexample.com must not pass because it ends with example.com.
    expect(
      evaluateOrigin(headers("https://notexample.com"), allowed).origin,
    ).toBe("mismatch")
  })

  it("distinguishes a missing header from an invalid one", () => {
    expect(evaluateOrigin(headers(null), allowed).origin).toBe("missing")
    expect(evaluateOrigin(headers(""), allowed).origin).toBe("missing")
    expect(evaluateOrigin(headers("null"), allowed).origin).toBe("invalid")
    expect(evaluateOrigin(headers("://"), allowed).origin).toBe("invalid")
  })

  it("evaluates the referer independently", () => {
    const result = evaluateOrigin(
      headers("https://example.com", "https://evil.com/page"),
      allowed,
    )
    expect(result.origin).toBe("match")
    expect(result.referer).toBe("mismatch")
  })

  it("treats a site with no configured domains as always mismatching", () => {
    expect(evaluateOrigin(headers("https://example.com"), []).origin).toBe(
      "mismatch",
    )
  })
})

describe("resolveAllowedOrigin", () => {
  it("echoes only a configured origin", () => {
    expect(resolveAllowedOrigin("https://example.com", allowed)).toBe(
      "https://example.com",
    )
  })

  it("never echoes an unconfigured origin", () => {
    // Reflecting an arbitrary origin is a wildcard with extra steps.
    expect(resolveAllowedOrigin("https://evil.com", allowed)).toBeNull()
    expect(resolveAllowedOrigin(null, allowed)).toBeNull()
    expect(resolveAllowedOrigin("null", allowed)).toBeNull()
  })
})

describe("isWellFormedSiteKey", () => {
  it("accepts the documented format", () => {
    expect(isWellFormedSiteKey("vtk_abcdef0123456789abcdef0123456789")).toBe(
      true,
    )
  })

  it("rejects anything else", () => {
    for (const value of [
      "vtk_short",
      "abcdef0123456789abcdef0123456789",
      "vtk_ABCDEF0123456789ABCDEF0123456789",
      "vtk_abcdef0123456789abcdef01234567890",
      "",
      null,
      undefined,
      42,
      { key: "vtk_abcdef0123456789abcdef0123456789" },
    ]) {
      expect(isWellFormedSiteKey(value)).toBe(false)
    }
  })
})
