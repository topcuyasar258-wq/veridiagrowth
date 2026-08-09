import { describe, expect, it } from "vitest"

import { classifySourceCategory } from "@veridia/shared"
import { classifySourceCategory as leadIngestionClassify } from "../../apps/dashboard/src/server/lead-ingestion/attribution"

/**
 * Regression suite for the shared classification engine.
 *
 * These cases encode the Phase 1 behaviour that existed before the function
 * moved into @veridia/shared. They exist so a future edit cannot silently
 * change how historical traffic is categorised.
 */
describe("classifySourceCategory", () => {
  it("treats paid mediums as paid search by default", () => {
    for (const medium of ["cpc", "ppc", "paid", "paid_search", "display"]) {
      expect(classifySourceCategory({ utmMedium: medium })).toBe("paid_search")
    }
  })

  it("treats paid mediums from social sources as paid social", () => {
    for (const source of [
      "facebook",
      "instagram",
      "meta",
      "linkedin",
      "tiktok",
    ]) {
      expect(
        classifySourceCategory({ utmMedium: "cpc", utmSource: source }),
      ).toBe("paid_social")
    }
  })

  it("is case and whitespace insensitive", () => {
    expect(
      classifySourceCategory({ utmMedium: "  CPC  ", utmSource: " Facebook " }),
    ).toBe("paid_social")
  })

  it("honours an explicit organic medium", () => {
    expect(classifySourceCategory({ utmMedium: "organic" })).toBe("organic")
  })

  it("classifies known search engine referrers as organic", () => {
    for (const referrer of [
      "https://www.google.com/",
      "https://bing.com/search?q=x",
      "https://duckduckgo.com/",
      "https://yandex.com.tr/",
    ]) {
      expect(classifySourceCategory({ referrer })).toBe("organic")
    }
  })

  it("classifies other referrers as referral", () => {
    expect(
      classifySourceCategory({ referrer: "https://blog.example.com/post" }),
    ).toBe("referral")
  })

  it("classifies explicit direct as direct", () => {
    expect(classifySourceCategory({ utmMedium: "direct" })).toBe("direct")
    expect(classifySourceCategory({ utmSource: "direct" })).toBe("direct")
  })

  it("falls back to unknown with no signal", () => {
    expect(classifySourceCategory({})).toBe("unknown")
    expect(classifySourceCategory({ referrer: "not a url" })).toBe("unknown")
  })

  it("accepts a bare host, which interaction events carry instead of a URL", () => {
    expect(classifySourceCategory({ referrer: "google.com" })).toBe("organic")
    expect(classifySourceCategory({ referrer: "blog.example.com" })).toBe(
      "referral",
    )
  })

  it("is the same function the lead ingestion path uses", () => {
    // Guards against a second engine reappearing in the app layer.
    expect(leadIngestionClassify).toBe(classifySourceCategory)
  })
})
