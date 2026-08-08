import { describe, expect, it } from "vitest"

import {
  enforceAuditMetadataLimit,
  sanitizeAuditMetadata,
} from "@veridia/security"

describe("sanitizeAuditMetadata", () => {
  it("masks token and secret fields recursively", () => {
    const sanitized = sanitizeAuditMetadata({
      action: "site.created",
      token: "raw-token",
      nested: {
        api_secret: "raw-secret",
        value: "safe",
      },
      events: [{ sessionCookie: "cookie-value" }, { count: 2 }],
    })

    expect(sanitized).toEqual({
      action: "site.created",
      token: "[REDACTED]",
      nested: {
        api_secret: "[REDACTED]",
        value: "safe",
      },
      events: [{ sessionCookie: "[REDACTED]" }, { count: 2 }],
    })
  })

  it("masks required secret and signature key variants", () => {
    const sanitized = sanitizeAuditMetadata({
      password: "raw",
      secret: "raw",
      client_secret: "raw",
      site_secret: "raw",
      token: "raw",
      access_token: "raw",
      refresh_token: "raw",
      authorization: "Bearer raw",
      cookie: "raw",
      "set-cookie": "raw",
      signature: "raw",
      "x-veridia-signature": "raw",
      supabase_service_role_key: "raw",
      ciphertext: "raw",
      iv: "raw",
      tag: "raw",
      message: "raw",
    })

    expect(Object.values(sanitized)).toEqual(
      new Array(Object.keys(sanitized).length).fill("[REDACTED]"),
    )
  })

  it("handles circular objects without exposing raw metadata", () => {
    const circular: Record<string, unknown> = { safe: "value" }
    circular.self = circular

    expect(sanitizeAuditMetadata(circular)).toEqual({
      safe: "value",
      self: { circular: true },
    })
  })

  it("limits oversized metadata payloads after sanitization", () => {
    const sanitized = enforceAuditMetadataLimit({
      value: "x".repeat(40 * 1024),
      token: "raw-token",
    })

    expect(sanitized).toEqual({ truncated: true })
  })
})
