import { describe, expect, it } from "vitest"

import { validateLeadRequestBody } from "../../apps/dashboard/src/server/lead-ingestion/schema"

describe("lead request schema", () => {
  it("accepts the versioned strict lead contract", () => {
    expect(validateLeadRequestBody(validBody()).success).toBe(true)
  })

  it("rejects unknown schema versions and unknown fields", () => {
    expect(
      validateLeadRequestBody({ ...validBody(), schemaVersion: "2.0" }),
    ).toMatchObject({ success: false })

    expect(
      validateLeadRequestBody({ ...validBody(), unexpected: true }),
    ).toMatchObject({ success: false })
  })

  it("rejects oversized fields, invalid email, and missing contact channels", () => {
    expect(
      validateLeadRequestBody({
        ...validBody(),
        lead: { ...validBody().lead, message: "x".repeat(5001) },
      }),
    ).toMatchObject({ success: false })

    expect(
      validateLeadRequestBody({
        ...validBody(),
        contact: { email: "not-email" },
      }),
    ).toMatchObject({ success: false })

    expect(
      validateLeadRequestBody({
        ...validBody(),
        contact: {},
      }),
    ).toMatchObject({ success: false })
  })
})

export function validBody() {
  return {
    schemaVersion: "1.0",
    form: {
      formId: "offer-form",
      startedAt: "2026-08-08T00:30:00.000Z",
      submittedAt: "2026-08-08T00:30:08.000Z",
      honeypot: "",
    },
    contact: {
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "+905321234567",
      email: "ada@example.com",
    },
    lead: {
      service: "kentsel-donusum",
      city: "Istanbul",
      message: "Bilgi almak istiyorum.",
    },
    attribution: {
      landingPage: "/landing",
      conversionPage: "/form",
      referrer: "https://www.google.com/",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "campaign",
      utmContent: null,
      utmTerm: null,
      firstTouch: {
        source: "google",
        medium: "organic",
        campaign: null,
        referrer: "https://www.google.com/",
        occurredAt: "2026-08-06T12:00:00.000Z",
      },
      lastTouch: {
        source: "google",
        medium: "cpc",
        campaign: "campaign",
        referrer: null,
        occurredAt: "2026-08-08T00:29:00.000Z",
      },
    },
    security: {
      turnstileToken: "token",
    },
  }
}
