import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { ResendEmailProvider } from "../../apps/dashboard/src/server/email/resend-provider"

const input = {
  to: "ops@example.test",
  subject: "Subject",
  html: "<p>Hello</p>",
  text: "Hello",
  idempotencyKey: "notify-business:lead",
}

describe("ResendEmailProvider", () => {
  it("maps success and sends stable idempotency key", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "msg_123" }))
    const provider = new ResendEmailProvider({
      apiKey: "secret",
      from: "from@example.test",
      timeoutMs: 1000,
      fetcher,
    })

    await expect(provider.send(input)).resolves.toEqual({
      success: true,
      providerMessageId: "msg_123",
    })
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": "notify-business:lead",
    })
  })

  it.each([
    [429, { success: false, retryable: true, code: "provider_429" }],
    [500, { success: false, retryable: true, code: "provider_5xx" }],
    [400, { success: false, retryable: false, code: "invalid_recipient" }],
  ] as const)("maps HTTP %s", async (status, expected) => {
    const provider = new ResendEmailProvider({
      apiKey: "secret",
      from: "from@example.test",
      timeoutMs: 1000,
      fetcher: async () => new Response("{}", { status }),
    })

    await expect(provider.send(input)).resolves.toEqual(expected)
  })

  it("maps timeout as retryable without exposing API key", async () => {
    const provider = new ResendEmailProvider({
      apiKey: "secret",
      from: "from@example.test",
      timeoutMs: 1,
      fetcher: async (_url, init) => {
        await new Promise((resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          )
          setTimeout(resolve, 50)
        })
        return Response.json({ id: "late" })
      },
    })

    await expect(provider.send(input)).resolves.toEqual({
      success: false,
      retryable: true,
      code: "provider_timeout",
    })
  })
})
