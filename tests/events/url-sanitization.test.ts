import { describe, expect, it } from "vitest"

import {
  extractUtm,
  sanitizePageUrl,
  sanitizeReferrer,
  sanitizeUrl,
} from "@veridia/shared"

describe("sanitizePageUrl", () => {
  it("keeps host and path only", () => {
    expect(sanitizePageUrl("https://Example.COM/iletisim?a=1#frag")).toEqual({
      host: "example.com",
      path: "/iletisim",
    })
  })

  it("drops query parameters that can carry personal data", () => {
    const result = sanitizePageUrl(
      "https://example.com/form?email=ada@example.com&phone=%2B905551112233&token=abc",
    )

    expect(result.path).toBe("/form")
    expect(JSON.stringify(result)).not.toContain("ada@example.com")
    expect(JSON.stringify(result)).not.toContain("905551112233")
    expect(JSON.stringify(result)).not.toContain("abc")
  })

  it("rejects non-http schemes rather than parsing them", () => {
    // These are exactly the targets that carry a phone number.
    for (const value of [
      "whatsapp://send?phone=905551112233",
      "tel:+905551112233",
      "mailto:ada@example.com",
      "javascript:alert(1)",
    ]) {
      expect(sanitizePageUrl(value)).toEqual({ host: null, path: null })
    }
  })

  it("returns nulls for unparseable input instead of throwing", () => {
    expect(sanitizePageUrl("not a url")).toEqual({ host: null, path: null })
    expect(sanitizePageUrl(null)).toEqual({ host: null, path: null })
    expect(sanitizePageUrl(undefined)).toEqual({ host: null, path: null })
  })

  it("truncates an over-long path", () => {
    const long = `https://example.com/${"a".repeat(900)}`
    expect(sanitizePageUrl(long).path?.length).toBe(512)
  })

  it("never returns a path containing a query or fragment marker", () => {
    // Mirrors the database CHECK constraint on conversion_events.page_path.
    const result = sanitizePageUrl("https://example.com/a/b?c=d#e")
    expect(result.path).not.toMatch(/[?#]/)
  })
})

describe("sanitizeReferrer", () => {
  it("reduces a referrer URL to its host", () => {
    expect(sanitizeReferrer("https://www.google.com/search?q=secret")).toBe(
      "www.google.com",
    )
  })

  it("accepts a bare host", () => {
    expect(sanitizeReferrer("Blog.Example.com")).toBe("blog.example.com")
  })

  it("returns null for junk", () => {
    expect(sanitizeReferrer("not a host")).toBeNull()
    expect(sanitizeReferrer("")).toBeNull()
    expect(sanitizeReferrer(null)).toBeNull()
  })
})

describe("extractUtm", () => {
  it("extracts exactly the five UTM parameters", () => {
    const utm = extractUtm(
      "https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=c&utm_term=t&utm_content=x&gclid=leak&email=ada@example.com",
    )

    expect(utm).toEqual({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "c",
      utm_term: "t",
      utm_content: "x",
    })
    expect(JSON.stringify(utm)).not.toContain("leak")
    expect(JSON.stringify(utm)).not.toContain("ada@example.com")
  })

  it("truncates over-long values", () => {
    const utm = extractUtm(`https://example.com/?utm_source=${"a".repeat(400)}`)
    expect(utm.utm_source?.length).toBe(128)
  })

  it("returns nulls when absent", () => {
    expect(extractUtm("https://example.com/")).toEqual({
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
    })
  })
})

describe("sanitizeUrl", () => {
  it("combines page reduction and UTM extraction", () => {
    expect(
      sanitizeUrl("https://example.com/x?utm_source=google&secret=1"),
    ).toEqual({
      host: "example.com",
      path: "/x",
      utm: {
        utm_source: "google",
        utm_medium: null,
        utm_campaign: null,
        utm_term: null,
        utm_content: null,
      },
    })
  })
})
