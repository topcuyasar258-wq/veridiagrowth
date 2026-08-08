import { describe, expect, it } from "vitest"

import { normalizeEmail, normalizeTurkishPhone } from "@veridia/shared"

describe("contact normalization", () => {
  it.each([
    "0532 123 45 67",
    "5321234567",
    "+90 532 123 45 67",
    "0090 532 123 45 67",
  ])("normalizes Turkish phone %s", (phone) => {
    expect(normalizeTurkishPhone(phone)).toBe("+905321234567")
  })

  it("returns null for ambiguous phone numbers", () => {
    expect(normalizeTurkishPhone("12345")).toBeNull()
  })

  it("normalizes only the email domain", () => {
    expect(normalizeEmail(" Ada.Example+tag@EXAMPLE.COM ")).toBe(
      "Ada.Example+tag@example.com",
    )
  })

  it("returns null for invalid email format", () => {
    expect(normalizeEmail("not-an-email")).toBeNull()
  })
})
