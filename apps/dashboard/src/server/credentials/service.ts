import "server-only"

import { randomUUID } from "node:crypto"

import {
  encryptCredentialSecret,
  fingerprintCredentialSecret,
  generateCredentialSecret,
  serializeEncryptedSecret,
} from "@veridia/security"

const defaultRotationWindowHours = 24

export type SiteCredentialRecord = {
  id: string
  siteId: string
  organizationId: string
  keyId: string
  secretCiphertext: string
  secretFingerprint: string
  status: "active" | "rotating" | "revoked" | "expired"
  validFrom: Date
  validUntil: Date | null
  rotationGroupId: string | null
}

export type CredentialRepository = {
  create(input: {
    siteId: string
    organizationId: string
    keyId: string
    secretCiphertext: string
    secretFingerprint: string
    status: "active" | "rotating"
    validFrom: Date
    validUntil: Date | null
    rotationGroupId: string | null
    createdBy: string
  }): Promise<SiteCredentialRecord>
  findActive(siteId: string): Promise<SiteCredentialRecord | null>
  markValidUntil(id: string, validUntil: Date): Promise<void>
  revoke(id: string, revokedBy: string, revokedAt: Date): Promise<void>
}

export type CredentialAuditSink = {
  record(input: {
    organizationId: string
    actorUserId: string
    action:
      | "credential.created"
      | "credential.rotation_started"
      | "credential.revoked"
    entityId: string
    metadata: Record<string, unknown>
  }): Promise<void>
}

export async function createSiteCredential(input: {
  siteId: string
  organizationId: string
  actorUserId: string
  repository: CredentialRepository
  audit: CredentialAuditSink
}) {
  const secret = generateCredentialSecret()
  const encrypted = encryptCredentialSecret(secret)
  const fingerprint = fingerprintCredentialSecret(secret)
  const credential = await input.repository.create({
    siteId: input.siteId,
    organizationId: input.organizationId,
    keyId: `site_${randomUUID().replaceAll("-", "")}`,
    secretCiphertext: serializeEncryptedSecret(encrypted),
    secretFingerprint: fingerprint,
    status: "active",
    validFrom: new Date(),
    validUntil: null,
    rotationGroupId: null,
    createdBy: input.actorUserId,
  })

  await input.audit.record({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "credential.created",
    entityId: credential.id,
    metadata: {
      siteId: input.siteId,
      credentialId: credential.id,
      keyId: credential.keyId,
      fingerprint,
    },
  })

  return {
    credential: {
      id: credential.id,
      keyId: credential.keyId,
      fingerprint,
    },
    secret,
  }
}

export async function startCredentialRotation(input: {
  siteId: string
  organizationId: string
  actorUserId: string
  repository: CredentialRepository
  audit: CredentialAuditSink
  transitionHours?: number
}) {
  const now = new Date()
  const transitionHours = input.transitionHours ?? defaultRotationWindowHours
  const validUntil = new Date(now.getTime() + transitionHours * 60 * 60 * 1000)
  const active = await input.repository.findActive(input.siteId)

  if (active) {
    await input.repository.markValidUntil(active.id, validUntil)
  }

  const secret = generateCredentialSecret()
  const encrypted = encryptCredentialSecret(secret)
  const fingerprint = fingerprintCredentialSecret(secret)
  const credential = await input.repository.create({
    siteId: input.siteId,
    organizationId: input.organizationId,
    keyId: `site_${randomUUID().replaceAll("-", "")}`,
    secretCiphertext: serializeEncryptedSecret(encrypted),
    secretFingerprint: fingerprint,
    status: "rotating",
    validFrom: now,
    validUntil: null,
    rotationGroupId: active?.rotationGroupId ?? randomUUID(),
    createdBy: input.actorUserId,
  })

  await input.audit.record({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "credential.rotation_started",
    entityId: credential.id,
    metadata: {
      siteId: input.siteId,
      credentialId: credential.id,
      keyId: credential.keyId,
      fingerprint,
      previousCredentialId: active?.id ?? null,
      transitionHours,
    },
  })

  return {
    credential: {
      id: credential.id,
      keyId: credential.keyId,
      fingerprint,
    },
    secret,
  }
}

export async function revokeSiteCredential(input: {
  credentialId: string
  siteId: string
  organizationId: string
  actorUserId: string
  repository: CredentialRepository
  audit: CredentialAuditSink
}) {
  const revokedAt = new Date()
  await input.repository.revoke(
    input.credentialId,
    input.actorUserId,
    revokedAt,
  )
  await input.audit.record({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "credential.revoked",
    entityId: input.credentialId,
    metadata: {
      siteId: input.siteId,
      credentialId: input.credentialId,
      revokedAt: revokedAt.toISOString(),
    },
  })
}
