import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"

import {
  decryptCredentialSecret,
  parseEncryptedSecret,
  type EncryptedSecret,
} from "./credential-secret"

export type SignLeadRequestInput = {
  method: "POST"
  path: string
  rawBody: Uint8Array | string
  keyId: string
  secret: string
  timestamp?: number
  nonce?: string
  idempotencyKey: string
}

export type SignedHeaders = {
  "X-Veridia-Key-Id": string
  "X-Veridia-Timestamp": string
  "X-Veridia-Nonce": string
  "X-Veridia-Signature": string
  "Idempotency-Key": string
}

export type HmacVerificationResult =
  | {
      ok: true
      siteId: string
      organizationId: string
      credentialId: string
      keyId: string
    }
  | {
      ok: false
      code:
        | "missing_headers"
        | "unknown_key"
        | "credential_inactive"
        | "timestamp_invalid"
        | "timestamp_expired"
        | "nonce_reused"
        | "signature_invalid"
    }

export type CredentialForVerification = {
  id: string
  siteId: string
  organizationId: string
  keyId: string
  secretCiphertext: string | EncryptedSecret
  status: "active" | "rotating" | "revoked" | "expired"
  validFrom: Date
  validUntil: Date | null
  revokedAt: Date | null
}

export type HmacCredentialLookup = {
  findByKeyId(keyId: string): Promise<CredentialForVerification | null>
}

export type HmacNonceStore = {
  claim(input: {
    siteId: string
    credentialId: string
    nonceHash: string
    requestTimestamp: Date
    expiresAt: Date
  }): Promise<"claimed" | "reused">
}

export type VerifyLeadRequestInput = {
  method: string
  path: string
  rawBody: Uint8Array | string
  headers: Headers | Record<string, string | undefined>
  now?: Date
  toleranceSeconds?: number
  nonceRetentionSeconds?: number
  credentials: HmacCredentialLookup
  nonces: HmacNonceStore
}

export type HmacTestVector = {
  method: string
  path: string
  timestamp: number
  nonce: string
  rawBody: string
  secret: string
  expectedBodyHash: string
  expectedCanonicalString: string
  expectedSignature: string
}

const fixtureSigningSharedKey = [
  "test",
  "signing",
  "fixture",
  "32",
  "bytes",
  "minimum",
  "value",
].join("_")

export const hmacTestVector: HmacTestVector = {
  method: "POST",
  path: "/api/v1/leads",
  timestamp: 1786021200,
  nonce: "f6e82a72-1782-4d3a-9c95-2b8bb55ed130",
  rawBody: '{"email":"Ada@example.com","phone":"0532 123 45 67"}',
  secret: fixtureSigningSharedKey,
  expectedBodyHash:
    "89b18951c38a1108f8040411c8e4056355f2f372969d44d33c4824c428b9eeeb",
  expectedCanonicalString:
    "POST\n/api/v1/leads\n1786021200\nf6e82a72-1782-4d3a-9c95-2b8bb55ed130\n89b18951c38a1108f8040411c8e4056355f2f372969d44d33c4824c428b9eeeb",
  expectedSignature:
    "f3939ea3c22c7a6d3054628345e860aa0797457dd51bdd59e2fc7f027b62d66d",
}

const defaultToleranceSeconds = 5 * 60
const defaultNonceRetentionSeconds = 15 * 60

export function signLeadRequest(input: SignLeadRequestInput): SignedHeaders {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000)
  const nonce = input.nonce ?? randomUUID()
  const signature = computeHmacSignature({
    method: input.method,
    path: input.path,
    timestamp,
    nonce,
    rawBody: input.rawBody,
    secret: input.secret,
  })

  return {
    "X-Veridia-Key-Id": input.keyId,
    "X-Veridia-Timestamp": String(timestamp),
    "X-Veridia-Nonce": nonce,
    "X-Veridia-Signature": signature,
    "Idempotency-Key": input.idempotencyKey,
  }
}

export async function verifyLeadRequest(
  input: VerifyLeadRequestInput,
): Promise<HmacVerificationResult> {
  const headers = readRequiredHeaders(input.headers)

  if (!headers) {
    return { ok: false, code: "missing_headers" }
  }

  const timestamp = Number(headers.timestamp)

  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    return { ok: false, code: "timestamp_invalid" }
  }

  const now = input.now ?? new Date()
  const toleranceSeconds = input.toleranceSeconds ?? defaultToleranceSeconds

  if (
    Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > toleranceSeconds
  ) {
    return { ok: false, code: "timestamp_expired" }
  }

  const credential = await input.credentials.findByKeyId(headers.keyId)

  if (!credential) {
    return { ok: false, code: "unknown_key" }
  }

  if (!credentialIsUsable(credential, now)) {
    return { ok: false, code: "credential_inactive" }
  }

  const secret = decryptCredentialSecret(
    typeof credential.secretCiphertext === "string"
      ? parseEncryptedSecret(credential.secretCiphertext)
      : credential.secretCiphertext,
  )
  const expectedSignature = computeHmacSignature({
    method: input.method,
    path: input.path,
    timestamp,
    nonce: headers.nonce,
    rawBody: input.rawBody,
    secret,
  })

  if (!timingSafeHexEqual(expectedSignature, headers.signature)) {
    return { ok: false, code: "signature_invalid" }
  }

  const nonceHash = hashReplayValue(headers.nonce)
  const claimResult = await input.nonces.claim({
    siteId: credential.siteId,
    credentialId: credential.id,
    nonceHash,
    requestTimestamp: new Date(timestamp * 1000),
    expiresAt: new Date(
      now.getTime() +
        (input.nonceRetentionSeconds ?? defaultNonceRetentionSeconds) * 1000,
    ),
  })

  if (claimResult === "reused") {
    return { ok: false, code: "nonce_reused" }
  }

  return {
    ok: true,
    siteId: credential.siteId,
    organizationId: credential.organizationId,
    credentialId: credential.id,
    keyId: credential.keyId,
  }
}

export function buildCanonicalString(input: {
  method: string
  path: string
  timestamp: number
  nonce: string
  rawBody: Uint8Array | string
}) {
  return [
    input.method.toUpperCase(),
    normalizeSignedPath(input.path),
    String(input.timestamp),
    input.nonce,
    sha256RawBodyHex(input.rawBody),
  ].join("\n")
}

export function sha256RawBodyHex(rawBody: Uint8Array | string) {
  return createHash("sha256").update(toBuffer(rawBody)).digest("hex")
}

export function normalizeSignedPath(path: string) {
  const pathname = path.split(/[?#]/, 1)[0] || "/"
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`
  const withoutTrailingSlash =
    withLeadingSlash.length > 1
      ? withLeadingSlash.replace(/\/+$/, "")
      : withLeadingSlash

  return withoutTrailingSlash || "/"
}

export function hashReplayValue(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function timingSafeHexEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex")
  const rightBuffer = Buffer.from(right, "hex")

  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function computeHmacSignature(input: {
  method: string
  path: string
  timestamp: number
  nonce: string
  rawBody: Uint8Array | string
  secret: string
}) {
  return createHmac("sha256", input.secret)
    .update(buildCanonicalString(input), "utf8")
    .digest("hex")
}

function readRequiredHeaders(
  headers: Headers | Record<string, string | undefined>,
) {
  const getHeader = (name: string) =>
    headers instanceof Headers
      ? headers.get(name)
      : Object.entries(headers).find(
          ([key]) => key.toLowerCase() === name.toLowerCase(),
        )?.[1]

  const keyId = getHeader("X-Veridia-Key-Id")
  const timestamp = getHeader("X-Veridia-Timestamp")
  const nonce = getHeader("X-Veridia-Nonce")
  const signature = getHeader("X-Veridia-Signature")
  const idempotencyKey = getHeader("Idempotency-Key")

  if (!keyId || !timestamp || !nonce || !signature || !idempotencyKey) {
    return null
  }

  return { keyId, timestamp, nonce, signature, idempotencyKey }
}

function credentialIsUsable(credential: CredentialForVerification, now: Date) {
  return (
    (credential.status === "active" || credential.status === "rotating") &&
    credential.revokedAt === null &&
    credential.validFrom.getTime() <= now.getTime() &&
    (credential.validUntil === null ||
      credential.validUntil.getTime() > now.getTime())
  )
}

function toBuffer(value: Uint8Array | string) {
  return typeof value === "string"
    ? Buffer.from(value, "utf8")
    : Buffer.from(value)
}
