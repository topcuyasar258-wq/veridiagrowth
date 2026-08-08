import { describe, expect, it } from "vitest"

import {
  buildCanonicalString,
  hmacTestVector,
  signLeadRequest,
} from "@veridia/security"
import { classifySourceCategory } from "../../apps/dashboard/src/server/lead-ingestion/attribution"
import { readLimitedRawBody } from "../../apps/dashboard/src/server/lead-ingestion/raw-body"
import { evaluateSpamSignals } from "../../apps/dashboard/src/server/lead-ingestion/spam"
import {
  hashIpForRisk,
  normalizeIp,
} from "../../apps/dashboard/src/server/security/request-ip"
import { validBody } from "./lead-request-schema.test"

describe("lead ingestion helpers", () => {
  it("keeps HMAC bound to the exact raw body bytes", () => {
    const compact = '{"email":"ada@example.com"}'
    const spaced = '{ "email": "ada@example.com" }'
    const signature = signLeadRequest({
      method: "POST",
      path: "/api/v1/leads",
      rawBody: compact,
      keyId: "site_test",
      secret: hmacTestVector.secret,
      timestamp: hmacTestVector.timestamp,
      nonce: hmacTestVector.nonce,
      idempotencyKey: "idem",
    })["X-Veridia-Signature"]
    const spacedSignature = signLeadRequest({
      method: "POST",
      path: "/api/v1/leads",
      rawBody: spaced,
      keyId: "site_test",
      secret: hmacTestVector.secret,
      timestamp: hmacTestVector.timestamp,
      nonce: hmacTestVector.nonce,
      idempotencyKey: "idem",
    })["X-Veridia-Signature"]

    expect(signature).not.toBe(spacedSignature)
    expect(
      buildCanonicalString({
        method: "POST",
        path: "/api/v1/leads?ignored=true",
        timestamp: hmacTestVector.timestamp,
        nonce: hmacTestVector.nonce,
        rawBody: compact,
      }),
    ).toContain("/api/v1/leads\n")
  })

  it("enforces a raw HTTP body limit before JSON parsing", async () => {
    const request = new Request("https://example.test/api/v1/leads", {
      method: "POST",
      body: "x".repeat(33),
    })

    await expect(readLimitedRawBody(request, 32)).resolves.toEqual({
      ok: false,
      code: "body_too_large",
    })
  })

  it.each([
    [{ utmSource: "google", utmMedium: "cpc" }, "paid_search"],
    [{ utmSource: "facebook", utmMedium: "paid_social" }, "paid_social"],
    [{ referrer: "https://www.google.com/search?q=x" }, "organic"],
    [{ referrer: "https://partner.example/path" }, "referral"],
    [{ utmSource: "direct", utmMedium: "direct" }, "direct"],
  ] as const)("classifies attribution source %#", (input, expected) => {
    expect(classifySourceCategory(input)).toBe(expected)
  })

  it("rejects honeypot but marks fast valid forms as suspicious", () => {
    expect(
      evaluateSpamSignals({
        body: {
          ...validBody(),
          form: { ...validBody().form, honeypot: "filled" },
        },
        minCompletionMs: 2000,
      }),
    ).toEqual({ accepted: false, code: "spam_honeypot" })

    expect(
      evaluateSpamSignals({
        body: {
          ...validBody(),
          form: {
            ...validBody().form,
            startedAt: "2026-08-08T00:30:00.000Z",
            submittedAt: "2026-08-08T00:30:01.000Z",
          },
        },
        minCompletionMs: 2000,
      }),
    ).toEqual({
      accepted: true,
      suspicious: true,
      reasons: ["form_completed_too_quickly"],
    })
  })

  it("normalizes and hashes IP risk buckets without exposing raw IP", () => {
    const key = "0123456789abcdef0123456789abcdef"
    const normalized = normalizeIp(" ::ffff:192.0.2.10 ")

    expect(normalized).toBe("192.0.2.10")
    expect(hashIpForRisk({ ip: normalized!, key })).toMatch(/^[a-f0-9]{64}$/)
    expect(hashIpForRisk({ ip: normalized!, key })).not.toContain("192.0.2")
  })
})
