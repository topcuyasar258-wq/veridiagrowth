import { describe, expect, it } from "vitest"

import { sanitizeSentryEvent } from "@veridia/security"

describe("sanitizeSentryEvent", () => {
  it("redacts secrets and removes full request bodies", () => {
    const sanitized = sanitizeSentryEvent({
      request: {
        cookies: "session=raw",
        data: { password: "raw" },
        headers: {
          authorization: "Bearer raw",
          cookie: "raw",
          "x-veridia-signature": "raw",
          "x-safe": "ok",
        },
      },
      extra: {
        client_secret: "raw",
        nested: { access_token: "raw", ciphertext: "raw", safe: "ok" },
      },
      user: {
        email: "user@example.test",
        id: "user-id",
      },
    })

    expect(sanitized.request).toEqual({
      cookies: "[REDACTED]",
      data: undefined,
      headers: {
        authorization: "[REDACTED]",
        cookie: "[REDACTED]",
        "x-veridia-signature": "[REDACTED]",
        "x-safe": "ok",
      },
    })
    expect(sanitized.extra).toEqual({
      client_secret: "[REDACTED]",
      nested: {
        access_token: "[REDACTED]",
        ciphertext: "[REDACTED]",
        safe: "ok",
      },
    })
    expect(sanitized.user).toEqual({
      email: "[REDACTED]",
      id: "user-id",
    })
  })
})
