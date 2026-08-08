import { describe, expect, it } from "vitest"

import {
  buildCanonicalString,
  encryptCredentialSecret,
  hmacTestVector,
  serializeEncryptedSecret,
  sha256RawBodyHex,
  signLeadRequest,
  verifyLeadRequest,
  type CredentialForVerification,
  type HmacNonceStore,
} from "@veridia/security"

const key = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64url",
)

describe("HMAC lead request signing", () => {
  it("matches the shared test vector", () => {
    expect(sha256RawBodyHex(hmacTestVector.rawBody)).toBe(
      hmacTestVector.expectedBodyHash,
    )
    expect(
      buildCanonicalString({
        method: hmacTestVector.method,
        path: hmacTestVector.path,
        timestamp: hmacTestVector.timestamp,
        nonce: hmacTestVector.nonce,
        rawBody: hmacTestVector.rawBody,
      }),
    ).toBe(hmacTestVector.expectedCanonicalString)

    expect(
      signLeadRequest({
        method: "POST",
        path: "/api/v1/leads",
        rawBody: hmacTestVector.rawBody,
        keyId: "site_test",
        secret: hmacTestVector.secret,
        timestamp: hmacTestVector.timestamp,
        nonce: hmacTestVector.nonce,
        idempotencyKey: "idem_test",
      })["X-Veridia-Signature"],
    ).toBe(hmacTestVector.expectedSignature)
  })

  it("accepts a valid signature and rejects replay", async () => {
    const { credential, nonces } = createVerifierFixtures()
    const headers = signLeadRequest({
      method: "POST",
      path: "/api/v1/leads",
      rawBody: hmacTestVector.rawBody,
      keyId: credential.keyId,
      secret: hmacTestVector.secret,
      timestamp: hmacTestVector.timestamp,
      nonce: hmacTestVector.nonce,
      idempotencyKey: "idem_test",
    })

    await expect(
      verifyLeadRequest({
        method: "post",
        path: "/api/v1/leads/",
        rawBody: hmacTestVector.rawBody,
        headers: lowerCaseHeaders(headers),
        now: new Date(hmacTestVector.timestamp * 1000),
        credentials: { findByKeyId: async () => credential },
        nonces,
      }),
    ).resolves.toMatchObject({ ok: true })

    await expect(
      verifyLeadRequest({
        method: "POST",
        path: "/api/v1/leads",
        rawBody: hmacTestVector.rawBody,
        headers,
        now: new Date(hmacTestVector.timestamp * 1000),
        credentials: { findByKeyId: async () => credential },
        nonces,
      }),
    ).resolves.toEqual({ ok: false, code: "nonce_reused" })
  })

  it.each([
    ["body", { rawBody: `${hmacTestVector.rawBody} ` }],
    ["path", { path: "/api/v1/lead" }],
    ["method", { method: "GET" }],
    ["timestamp", { timestampOffset: 1 }],
    ["nonce", { nonce: "different-nonce" }],
  ])("rejects changed %s", async (_caseName, mutation) => {
    const { credential, nonces } = createVerifierFixtures()
    const headers = signLeadRequest({
      method: "POST",
      path: "/api/v1/leads",
      rawBody: hmacTestVector.rawBody,
      keyId: credential.keyId,
      secret: hmacTestVector.secret,
      timestamp: hmacTestVector.timestamp,
      nonce: hmacTestVector.nonce,
      idempotencyKey: "idem_test",
    })

    const result = await verifyLeadRequest({
      method: mutation.method ?? "POST",
      path: mutation.path ?? "/api/v1/leads",
      rawBody: mutation.rawBody ?? hmacTestVector.rawBody,
      headers: {
        ...headers,
        "X-Veridia-Timestamp": String(
          hmacTestVector.timestamp + (mutation.timestampOffset ?? 0),
        ),
        "X-Veridia-Nonce": mutation.nonce ?? hmacTestVector.nonce,
      },
      now: new Date(hmacTestVector.timestamp * 1000),
      credentials: { findByKeyId: async () => credential },
      nonces,
    })

    expect(result).toEqual({ ok: false, code: "signature_invalid" })
    expect(nonces.claimCount).toBe(0)
  })

  it("rejects old and future timestamps outside tolerance", async () => {
    const { credential, nonces } = createVerifierFixtures()
    const headers = signLeadRequest({
      method: "POST",
      path: "/api/v1/leads",
      rawBody: hmacTestVector.rawBody,
      keyId: credential.keyId,
      secret: hmacTestVector.secret,
      timestamp: hmacTestVector.timestamp,
      nonce: hmacTestVector.nonce,
      idempotencyKey: "idem_test",
    })

    await expect(
      verifyLeadRequest({
        method: "POST",
        path: "/api/v1/leads",
        rawBody: hmacTestVector.rawBody,
        headers,
        now: new Date((hmacTestVector.timestamp + 301) * 1000),
        credentials: { findByKeyId: async () => credential },
        nonces,
      }),
    ).resolves.toEqual({ ok: false, code: "timestamp_expired" })

    await expect(
      verifyLeadRequest({
        method: "POST",
        path: "/api/v1/leads",
        rawBody: hmacTestVector.rawBody,
        headers,
        now: new Date((hmacTestVector.timestamp - 301) * 1000),
        credentials: { findByKeyId: async () => credential },
        nonces,
      }),
    ).resolves.toEqual({ ok: false, code: "timestamp_expired" })
  })

  it("rejects revoked credentials", async () => {
    const { credential, nonces } = createVerifierFixtures()
    const headers = signLeadRequest({
      method: "POST",
      path: "/api/v1/leads",
      rawBody: hmacTestVector.rawBody,
      keyId: credential.keyId,
      secret: hmacTestVector.secret,
      timestamp: hmacTestVector.timestamp,
      nonce: hmacTestVector.nonce,
      idempotencyKey: "idem_test",
    })

    await expect(
      verifyLeadRequest({
        method: "POST",
        path: "/api/v1/leads",
        rawBody: hmacTestVector.rawBody,
        headers,
        now: new Date(hmacTestVector.timestamp * 1000),
        credentials: {
          findByKeyId: async () => ({
            ...credential,
            status: "revoked",
            revokedAt: new Date(hmacTestVector.timestamp * 1000),
          }),
        },
        nonces,
      }),
    ).resolves.toEqual({ ok: false, code: "credential_inactive" })
  })

  it("allows only one concurrent verification for the same nonce", async () => {
    const { credential, nonces } = createVerifierFixtures()
    const headers = signLeadRequest({
      method: "POST",
      path: "/api/v1/leads",
      rawBody: hmacTestVector.rawBody,
      keyId: credential.keyId,
      secret: hmacTestVector.secret,
      timestamp: hmacTestVector.timestamp,
      nonce: hmacTestVector.nonce,
      idempotencyKey: "idem_test",
    })

    const results = await Promise.all(
      [0, 1].map(() =>
        verifyLeadRequest({
          method: "POST",
          path: "/api/v1/leads",
          rawBody: hmacTestVector.rawBody,
          headers,
          now: new Date(hmacTestVector.timestamp * 1000),
          credentials: { findByKeyId: async () => credential },
          nonces,
        }),
      ),
    )

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "nonce_reused" },
    ])
  })
})

function createVerifierFixtures() {
  process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEYS = `v1:${key}`
  process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEY_VERSION = "v1"
  const encrypted = encryptCredentialSecret(hmacTestVector.secret)
  const credential: CredentialForVerification = {
    id: "credential-id",
    siteId: "site-id",
    organizationId: "organization-id",
    keyId: "site_test",
    secretCiphertext: serializeEncryptedSecret(encrypted),
    status: "active",
    validFrom: new Date((hmacTestVector.timestamp - 60) * 1000),
    validUntil: null,
    revokedAt: null,
  }
  const nonces = createMemoryNonceStore()

  return { credential, nonces }
}

function createMemoryNonceStore(): HmacNonceStore & { claimCount: number } {
  const claimed = new Set<string>()

  return {
    claimCount: 0,
    async claim(input) {
      this.claimCount += 1
      const key = `${input.credentialId}:${input.nonceHash}`

      if (claimed.has(key)) {
        return "reused"
      }

      claimed.add(key)
      return "claimed"
    },
  }
}

function lowerCaseHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  )
}
