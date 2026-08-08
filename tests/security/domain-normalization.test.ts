import { describe, expect, it } from "vitest"

import { normalizeDomain } from "@veridia/security"

describe("normalizeDomain", () => {
  it("normalizes protocol, www, paths, query strings, ports, and trailing slashes", () => {
    expect(normalizeDomain("https://www.Example.com/path?a=1")).toBe(
      "example.com",
    )
    expect(normalizeDomain("example.com")).toBe("example.com")
    expect(normalizeDomain("http://example.com:8443/")).toBe("example.com")
  })

  it("rejects empty normalized domains", () => {
    expect(() => normalizeDomain("https://www./")).toThrow(
      "Domain cannot be normalized.",
    )
  })
})
