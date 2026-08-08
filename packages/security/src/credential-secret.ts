import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

const algorithm = "aes-256-gcm"
const envelopeVersion = 1
const defaultKeyVersion = "v1"

export type EncryptedSecret = {
  algorithm: "AES-256-GCM"
  version: number
  keyVersion: string
  iv: string
  tag: string
  ciphertext: string
}

export function generateCredentialSecret() {
  return randomBytes(32).toString("base64url")
}

export function encryptCredentialSecret(secret: string): EncryptedSecret {
  const keyVersion = getCurrentEncryptionKeyVersion()
  const key = getEncryptionKey(keyVersion)
  const iv = randomBytes(12)
  const cipher = createCipheriv(algorithm, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return {
    algorithm: "AES-256-GCM",
    version: envelopeVersion,
    keyVersion,
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  }
}

export function decryptCredentialSecret(value: EncryptedSecret): string {
  if (value.algorithm !== "AES-256-GCM" || value.version !== envelopeVersion) {
    throw new Error("Unsupported credential secret envelope.")
  }

  const decipher = createDecipheriv(
    algorithm,
    getEncryptionKey(value.keyVersion),
    Buffer.from(value.iv, "base64url"),
  )

  decipher.setAuthTag(Buffer.from(value.tag, "base64url"))

  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

export function fingerprintCredentialSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 24)
}

export function serializeEncryptedSecret(value: EncryptedSecret): string {
  return JSON.stringify(value)
}

export function parseEncryptedSecret(value: string): EncryptedSecret {
  const parsed = JSON.parse(value) as EncryptedSecret

  if (
    parsed.algorithm !== "AES-256-GCM" ||
    typeof parsed.keyVersion !== "string" ||
    typeof parsed.iv !== "string" ||
    typeof parsed.tag !== "string" ||
    typeof parsed.ciphertext !== "string"
  ) {
    throw new Error("Invalid credential secret envelope.")
  }

  return parsed
}

function getCurrentEncryptionKeyVersion() {
  return (
    process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEY_VERSION ?? defaultKeyVersion
  )
}

function getEncryptionKey(keyVersion: string) {
  const keyring = parseKeyring(process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEYS)
  const key = keyring.get(keyVersion)

  if (!key) {
    throw new Error("Credential encryption key is not configured.")
  }

  return key
}

function parseKeyring(rawKeyring: string | undefined) {
  if (!rawKeyring) {
    throw new Error("Credential encryption key is not configured.")
  }

  const entries = rawKeyring.split(",").map((entry) => entry.trim())

  return new Map(
    entries.map((entry) => {
      const [version, encodedKey] = entry.split(":")

      if (!version || !encodedKey) {
        throw new Error("Credential encryption key is not configured.")
      }

      const key = Buffer.from(encodedKey, "base64url")

      if (key.byteLength !== 32) {
        throw new Error("Credential encryption key is not configured.")
      }

      return [version, key] as const
    }),
  )
}
