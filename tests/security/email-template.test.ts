import { describe, expect, it } from "vitest"

import { renderBusinessLeadEmail } from "../../apps/dashboard/src/server/email/templates"

describe("business lead email template", () => {
  it("escapes user-provided HTML and includes text alternative", () => {
    const rendered = renderBusinessLeadEmail({
      siteName: "Site",
      leadPanelUrl: "https://app.example.test/dashboard",
      contact: {
        firstName: "<script>alert(1)</script>",
        phone: "+905321234567",
      },
      lead: {
        message: "<img src=x onerror=alert(1)>",
        createdAt: "2026-08-08T00:00:00.000Z",
      },
      sourceCategory: "paid_search",
    })

    expect(rendered.html).not.toContain("<script>")
    expect(rendered.html).not.toContain("<img")
    expect(rendered.html).toContain("&lt;script&gt;")
    expect(rendered.text).toContain("Telefon")
  })

  it("truncates very long messages", () => {
    const rendered = renderBusinessLeadEmail({
      siteName: "Site",
      leadPanelUrl: "https://app.example.test/dashboard",
      contact: {},
      lead: {
        message: "x".repeat(3000),
        createdAt: "2026-08-08T00:00:00.000Z",
      },
      sourceCategory: "direct",
    })

    expect(rendered.text.length).toBeLessThan(2300)
    expect(rendered.text).toContain("...")
  })
})
