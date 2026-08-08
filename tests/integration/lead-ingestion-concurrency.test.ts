import { describe, expect, it } from "vitest"

import { claimIdempotencyKey, type IdempotencyRecord } from "@veridia/security"

describe("lead ingestion concurrency model", () => {
  it("allows only one of 20 same idempotency requests to enter processing", async () => {
    const store = createMemoryStore()
    const now = new Date("2026-08-08T00:00:00.000Z")

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        claimIdempotencyKey({
          siteId: "site-a",
          idempotencyKey: "same-key",
          rawBody: '{"contact":"same"}',
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
    ).toHaveLength(19)
  })

  it("keeps duplicate detection independent from idempotency keys", () => {
    const detector = createDuplicateDetector()

    const leads = Array.from({ length: 20 }, (_value, index) =>
      detector.create({
        id: `lead-${index}`,
        organizationId: "org-a",
        phoneNormalized: "+905321234567",
        emailNormalized: null,
        createdAt: new Date(2026, 7, 8, 0, 0, index),
      }),
    )

    expect(leads).toHaveLength(20)
    expect(leads[0]).toMatchObject({
      isDuplicate: false,
      duplicateOf: null,
    })
    expect(leads.slice(1).every((lead) => lead.isDuplicate)).toBe(true)
    expect(leads.slice(1).every((lead) => lead.duplicateOf === "lead-0")).toBe(
      true,
    )
  })
})

function createMemoryStore() {
  const records = new Map<string, IdempotencyRecord>()

  return {
    async find(siteId: string, idempotencyKeyHash: string) {
      return records.get(`${siteId}:${idempotencyKeyHash}`) ?? null
    },
    async insertProcessing(input: {
      siteId: string
      idempotencyKeyHash: string
      requestHash: string
      lockedUntil: Date
      expiresAt: Date
    }) {
      const key = `${input.siteId}:${input.idempotencyKeyHash}`

      if (records.has(key)) {
        return "conflict" as const
      }

      await Promise.resolve()

      if (records.has(key)) {
        return "conflict" as const
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

function createDuplicateDetector() {
  type Lead = {
    id: string
    organizationId: string
    phoneNormalized: string | null
    emailNormalized: string | null
    createdAt: Date
  }
  const leads: Lead[] = []

  return {
    create(input: Lead) {
      const duplicate = leads
        .filter(
          (lead) =>
            lead.organizationId === input.organizationId &&
            ((input.phoneNormalized &&
              lead.phoneNormalized === input.phoneNormalized) ||
              (input.emailNormalized &&
                lead.emailNormalized === input.emailNormalized)),
        )
        .sort(
          (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
        )[0]

      leads.push(input)

      return {
        ...input,
        isDuplicate: Boolean(duplicate),
        duplicateOf: duplicate?.id ?? null,
      }
    },
  }
}
