import { hashReplayValue } from "./hmac"

export type IdempotencyStatus = "processing" | "completed" | "failed"

export type IdempotencyRecord = {
  id: string
  siteId: string
  idempotencyKeyHash: string
  requestHash: string
  status: IdempotencyStatus
  resourceType: string | null
  resourceId: string | null
  responseStatus: number | null
  responseBody: Record<string, unknown> | null
  lockedUntil: Date | null
  expiresAt: Date
}

export type IdempotencyStore = {
  find(
    siteId: string,
    idempotencyKeyHash: string,
  ): Promise<IdempotencyRecord | null>
  insertProcessing(input: {
    siteId: string
    idempotencyKeyHash: string
    requestHash: string
    lockedUntil: Date
    expiresAt: Date
  }): Promise<IdempotencyRecord | "conflict">
}

export type IdempotencyClaimResult =
  | { status: "started"; record: IdempotencyRecord }
  | { status: "replay"; record: IdempotencyRecord }
  | { status: "conflict" }
  | { status: "processing"; record: IdempotencyRecord }

export async function claimIdempotencyKey(input: {
  siteId: string
  idempotencyKey: string
  rawBody: Uint8Array | string
  now: Date
  lockSeconds: number
  ttlSeconds: number
  store: IdempotencyStore
}): Promise<IdempotencyClaimResult> {
  const idempotencyKeyHash = hashReplayValue(input.idempotencyKey)
  const requestHash = hashRequest(input.rawBody)
  const existing = await input.store.find(input.siteId, idempotencyKeyHash)

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return { status: "conflict" }
    }

    if (existing.status === "completed") {
      return { status: "replay", record: existing }
    }

    if (
      existing.status === "processing" &&
      existing.lockedUntil &&
      existing.lockedUntil.getTime() > input.now.getTime()
    ) {
      return { status: "processing", record: existing }
    }
  }

  const inserted = await input.store.insertProcessing({
    siteId: input.siteId,
    idempotencyKeyHash,
    requestHash,
    lockedUntil: new Date(input.now.getTime() + input.lockSeconds * 1000),
    expiresAt: new Date(input.now.getTime() + input.ttlSeconds * 1000),
  })

  if (inserted === "conflict") {
    const concurrent = await input.store.find(input.siteId, idempotencyKeyHash)
    return concurrent
      ? { status: "processing", record: concurrent }
      : { status: "conflict" }
  }

  return { status: "started", record: inserted }
}

export function hashRequest(rawBody: Uint8Array | string) {
  return hashReplayValue(
    typeof rawBody === "string"
      ? rawBody
      : Buffer.from(rawBody).toString("base64url"),
  )
}
