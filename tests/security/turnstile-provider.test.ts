import { describe, expect, it, vi } from "vitest"

import { CloudflareTurnstileProvider } from "../../apps/dashboard/src/server/lead-ingestion/turnstile"

describe("CloudflareTurnstileProvider", () => {
  it("returns success without leaking the token", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        success: true,
        challenge_ts: "2026-08-08T00:00:00Z",
        hostname: "example.test",
      }),
    )
    const provider = new CloudflareTurnstileProvider({
      secretKey: "secret",
      timeoutMs: 1000,
      fetcher,
    })

    await expect(
      provider.verify({ token: "token", remoteIp: "192.0.2.1" }),
    ).resolves.toEqual({
      success: true,
      provider: "cloudflare-turnstile",
      challengeTimestamp: "2026-08-08T00:00:00Z",
      hostname: "example.test",
    })
  })

  it.each([
    [["invalid-input-response"], "invalid"],
    [["expired-input-response"], "expired"],
    [["timeout-or-duplicate"], "duplicate"],
  ] as const)("maps provider error %s", async (errors, reason) => {
    const provider = new CloudflareTurnstileProvider({
      secretKey: "secret",
      timeoutMs: 1000,
      fetcher: async () =>
        Response.json({ success: false, "error-codes": errors }),
    })

    await expect(provider.verify({ token: "token" })).resolves.toEqual({
      success: false,
      reason,
    })
  })

  it("fails closed on provider 500, timeout, and malformed response", async () => {
    const provider500 = new CloudflareTurnstileProvider({
      secretKey: "secret",
      timeoutMs: 1000,
      fetcher: async () => new Response("error", { status: 500 }),
    })
    await expect(provider500.verify({ token: "token" })).resolves.toEqual({
      success: false,
      reason: "provider_error",
    })

    const malformed = new CloudflareTurnstileProvider({
      secretKey: "secret",
      timeoutMs: 1000,
      fetcher: async () => Response.json({ ok: true }),
    })
    await expect(malformed.verify({ token: "token" })).resolves.toEqual({
      success: false,
      reason: "provider_error",
    })

    const timeout = new CloudflareTurnstileProvider({
      secretKey: "secret",
      timeoutMs: 1,
      fetcher: async (_url, init) => {
        await new Promise((resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          )
          setTimeout(resolve, 50)
        })
        return Response.json({ success: true })
      },
    })

    await expect(timeout.verify({ token: "token" })).resolves.toEqual({
      success: false,
      reason: "timeout",
    })
  })
})
