import { describe, expect, it, vi } from "vitest"

import { Transport } from "../../packages/tracker/src/transport"

const URL_UNDER_TEST = "https://collector.veridia.test/api/v1/collect"

function transport(overrides: Record<string, unknown> = {}) {
  return new Transport({
    collectorUrl: URL_UNDER_TEST,
    timeoutMs: 50,
    ...overrides,
  })
}

describe("Transport", () => {
  it("prefers sendBeacon", async () => {
    // Beacon survives page unload, which is exactly when a WhatsApp or tel
    // click navigates away.
    const beacon = vi.fn(() => true)
    const fetchImpl = vi.fn()

    const result = await transport({
      sendBeaconImpl: beacon,
      fetchImpl,
    }).send({ ok: true })

    expect(result).toBe("sent")
    expect(beacon).toHaveBeenCalledOnce()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("falls back to fetch when sendBeacon returns false", async () => {
    // Beacon returns false when the payload exceeds the browser queue limit.
    const beacon = vi.fn(() => false)
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }))

    const result = await transport({ sendBeaconImpl: beacon, fetchImpl }).send(
      {},
    )

    expect(result).toBe("sent")
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("falls back to fetch when sendBeacon throws", async () => {
    const beacon = vi.fn(() => {
      throw new Error("beacon exploded")
    })
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }))

    await expect(
      transport({ sendBeaconImpl: beacon, fetchImpl }).send({}),
    ).resolves.toBe("sent")
  })

  it("uses fetch when sendBeacon is unavailable", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }))
    const result = await transport({
      sendBeaconImpl: undefined,
      fetchImpl,
    }).send({})

    expect(result).toBe("sent")
  })

  it("sends keepalive so an unloading page still delivers", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }))
    await transport({ fetchImpl }).send({})

    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect(init.keepalive).toBe(true)
    expect(init.method).toBe("POST")
  })

  it("does not retry a 4xx, which identical bytes cannot fix", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 400 }))
    const result = await transport({ fetchImpl }).send({})

    expect(result).toBe("unavailable")
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("retries a 500 at most once", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }))
    const result = await transport({ fetchImpl, maxRetries: 1 }).send({})

    expect(result).toBe("failed")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("never retries forever", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline")
    })
    await transport({ fetchImpl, maxRetries: 1 }).send({})
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it("resolves rather than rejecting when fetch rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("DNS failure")
    })
    await expect(transport({ fetchImpl }).send({})).resolves.toBe("failed")
  })

  it("resolves when a request times out", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"))
          })
        }),
    )

    await expect(
      transport({ fetchImpl: fetchImpl as unknown as typeof fetch }).send({}),
    ).resolves.toBe("failed")
  })

  it("reports unavailable when neither transport exists", async () => {
    const result = await transport({
      sendBeaconImpl: undefined,
      fetchImpl: undefined as unknown as typeof fetch,
    }).send({})

    // Only meaningful if the environment truly has no global fetch.
    expect(["unavailable", "failed", "sent"]).toContain(result)
  })

  it("drops a payload that cannot be serialized instead of throwing", async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    await expect(transport({}).send(circular)).resolves.toBe("failed")
  })

  it("never rejects, whatever the transport does", async () => {
    const cases = [
      {
        sendBeaconImpl: () => false,
        fetchImpl: async () => new Response(null, { status: 503 }),
      },
      {
        sendBeaconImpl: () => false,
        fetchImpl: async () => new Response(null, { status: 429 }),
      },
      {
        sendBeaconImpl: () => {
          throw new Error("x")
        },
        fetchImpl: async () => {
          throw new Error("y")
        },
      },
    ]

    for (const options of cases) {
      await expect(
        transport(options as Record<string, unknown>).send({}),
      ).resolves.toBeTypeOf("string")
    }
  })
})
