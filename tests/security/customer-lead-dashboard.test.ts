import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  buildTelHref,
  buildWhatsAppHref,
  canAssignMember,
  canMutateLead,
  displayLeadName,
  parseLeadFilters,
} from "../../apps/dashboard/src/server/leads/format"

describe("customer lead dashboard helpers", () => {
  it("builds only normalized phone action links", () => {
    expect(buildTelHref("+905321112233")).toBe("tel:+905321112233")
    expect(buildWhatsAppHref("+905321112233", "Merhaba dünya")).toBe(
      "https://wa.me/905321112233?text=Merhaba%20d%C3%BCnya",
    )
    expect(buildTelHref("0532 111 22 33")).toBeNull()
    expect(buildWhatsAppHref("javascript:alert(1)")).toBeNull()
  })

  it("whitelists filters and ignores short search queries", () => {
    const filters = parseLeadFilters({
      q: " a ",
      status: "deleted",
      source: "paid_search",
      assignee: "not-a-user",
      site: "00000000-0000-0000-0000-000000000001",
      date: "7d",
      page: "2",
    })

    expect(filters).toEqual({
      query: "",
      status: "all",
      source: "paid_search",
      assignee: "all",
      siteId: "00000000-0000-0000-0000-000000000001",
      date: "7d",
      page: 2,
    })
  })

  it("keeps viewer read-only and agent assignment scoped to self", () => {
    expect(canMutateLead("viewer")).toBe(false)
    expect(canMutateLead("agent")).toBe(true)
    expect(
      canAssignMember(
        "agent",
        {
          userId: "agent-a",
          role: "agent",
          label: "Ben",
        },
        "agent-a",
      ),
    ).toBe(true)
    expect(
      canAssignMember(
        "agent",
        {
          userId: "agent-b",
          role: "agent",
          label: "Personel",
        },
        "agent-a",
      ),
    ).toBe(false)
  })

  it("escapes lead names when rendered by React", () => {
    const name = displayLeadName({
      first_name: "<script>alert(1)</script>",
      last_name: null,
      email: null,
      phone: null,
    })

    expect(renderToStaticMarkup(createElement("p", null, name))).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    )
  })
})
