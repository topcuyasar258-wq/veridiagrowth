import { describe, expect, it } from "vitest"

import {
  claimIdempotencyKey,
  type IdempotencyRecord,
  type IdempotencyStore,
} from "@veridia/security"

describe("claimIdempotencyKey", () => {
  it("allows only one concurrent processing claim", async () => {
    const store = createMemoryIdempotencyStore()
    const now = new Date("2026-08-06T12:00:00.000Z")

    const results = await Promise.all(
      [0, 1].map(() =>
        claimIdempotencyKey({
          siteId: "site-id",
          idempotencyKey: "raw-idempotency-key",
          rawBody: '{"safe":true}',
          now,
          lockSeconds: 30,
          ttlSeconds: 86_400,
          store,
        }),
      ),
    )

    expect(
      results.filter((result) => result.status === "started"),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === "processing"),
    ).toHaveLength(1)
  })

  it("returns conflict when the same key is reused for a different request", async () => {
    const store = createMemoryIdempotencyStore()
    const now = new Date("2026-08-06T12:00:00.000Z")

    await claimIdempotencyKey({
      siteId: "site-id",
      idempotencyKey: "raw-idempotency-key",
      rawBody: '{"safe":true}',
      now,
      lockSeconds: 30,
      ttlSeconds: 86_400,
      store,
    })

    await expect(
      claimIdempotencyKey({
        siteId: "site-id",
        idempotencyKey: "raw-idempotency-key",
        rawBody: '{"safe":false}',
        now,
        lockSeconds: 30,
        ttlSeconds: 86_400,
        store,
      }),
    ).resolves.toEqual({ status: "conflict" })
  })
})

function createMemoryIdempotencyStore(): IdempotencyStore {
  const records = new Map<string, IdempotencyRecord>()

  return {
    async find(siteId, idempotencyKeyHash) {
      return records.get(`${siteId}:${idempotencyKeyHash}`) ?? null
    },
    async insertProcessing(input) {
      const key = `${input.siteId}:${input.idempotencyKeyHash}`

      if (records.has(key)) {
        return "conflict"
      }

      const record: IdempotencyRecord = {
        id: crypto.randomUUID(),
        siteId: input.siteId,
        idempotencyKeyHash: input.idempotencyKeyHash,
        requestHash: input.requestHash,
        status: "processing",
        resourceType: null,
        resourceId: null,
        responseStatus: null,
        responseBody: null,
        lockedUntil: input.lockedUntil,
        expiresAt: input.expiresAt,
      }
      records.set(key, record)
      return record
    },
  }
}
