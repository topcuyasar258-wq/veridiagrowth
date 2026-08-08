import { randomBytes } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  decryptCredentialSecret,
  encryptCredentialSecret,
  fingerprintCredentialSecret,
  generateCredentialSecret,
} from "@veridia/security"

const validKey = randomBytes(32).toString("base64url")
const wrongKey = randomBytes(32).toString("base64url")

describe("credential secret encryption", () => {
  const previousKeyring = process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEYS
  const previousKeyVersion =
    process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEY_VERSION

  beforeEach(() => {
    process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEYS = `v1:${validKey}`
    process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEY_VERSION = "v1"
  })

  afterEach(() => {
    process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEYS = previousKeyring
    process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEY_VERSION = previousKeyVersion
  })

  it("generates a URL-safe cryptographic secret", () => {
    const generatedValue = generateCredentialSecret()

    expect(generatedValue).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(generatedValue, "base64url")).toHaveLength(32)
  })

  it("encrypts and decrypts without storing plaintext", () => {
    const oneTimePlaintext = "credential-fixture-value"
    const encrypted = encryptCredentialSecret(oneTimePlaintext)

    expect(JSON.stringify(encrypted)).not.toContain(oneTimePlaintext)
    expect(decryptCredentialSecret(encrypted)).toBe(oneTimePlaintext)
  })

  it("does not decrypt with the wrong key", () => {
    const encrypted = encryptCredentialSecret("credential-secret-value")
    process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEYS = `v1:${wrongKey}`

    expect(() => decryptCredentialSecret(encrypted)).toThrow()
  })

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptCredentialSecret("credential-secret-value")

    expect(() =>
      decryptCredentialSecret({
        ...encrypted,
        tag: Buffer.from("tampered-auth-tag").toString("base64url"),
      }),
    ).toThrow()
  })

  it("fingerprints without exposing the secret", () => {
    const oneTimePlaintext = "credential-fixture-value"
    const fingerprint = fingerprintCredentialSecret(oneTimePlaintext)

    expect(fingerprint).toHaveLength(24)
    expect(fingerprint).not.toContain(oneTimePlaintext)
  })
})
