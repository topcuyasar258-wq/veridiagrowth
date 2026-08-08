import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Json } from "@veridia/database"
import {
  claimIdempotencyKey,
  type CredentialForVerification,
  type HmacCredentialLookup,
  type HmacNonceStore,
  type IdempotencyRecord,
  type IdempotencyStore,
} from "@veridia/security"

type AdminClient = SupabaseClient<Database>

export function createCredentialLookup(
  client: AdminClient,
): HmacCredentialLookup {
  return {
    async findByKeyId(keyId) {
      const { data, error } = await client
        .from("site_credentials")
        .select(
          "id, site_id, organization_id, key_id, secret_ciphertext, status, valid_from, valid_until, revoked_at",
        )
        .eq("key_id", keyId)
        .maybeSingle()

      if (error || !data) {
        return null
      }

      return {
        id: data.id,
        siteId: data.site_id,
        organizationId: data.organization_id,
        keyId: data.key_id,
        secretCiphertext: data.secret_ciphertext,
        status: data.status,
        validFrom: new Date(data.valid_from),
        validUntil: data.valid_until ? new Date(data.valid_until) : null,
        revokedAt: data.revoked_at ? new Date(data.revoked_at) : null,
      } satisfies CredentialForVerification
    },
  }
}

export function createNonceStore(client: AdminClient): HmacNonceStore {
  return {
    async claim(input) {
      const { error } = await client.from("used_nonces").insert({
        site_id: input.siteId,
        credential_id: input.credentialId,
        nonce_hash: input.nonceHash,
        request_timestamp: input.requestTimestamp.toISOString(),
        expires_at: input.expiresAt.toISOString(),
      })

      return error?.code === "23505" ? "reused" : "claimed"
    },
  }
}

export function createIdempotencyStore(client: AdminClient): IdempotencyStore {
  return {
    async find(siteId, idempotencyKeyHash) {
      const { data, error } = await client
        .from("idempotency_records")
        .select(
          "id, site_id, idempotency_key_hash, request_hash, status, resource_type, resource_id, response_status, response_body, locked_until, expires_at",
        )
        .eq("site_id", siteId)
        .eq("idempotency_key_hash", idempotencyKeyHash)
        .maybeSingle()

      if (error || !data) {
        return null
      }

      return mapIdempotencyRecord(data)
    },
    async insertProcessing(input) {
      const { data, error } = await client
        .from("idempotency_records")
        .insert({
          site_id: input.siteId,
          idempotency_key_hash: input.idempotencyKeyHash,
          request_hash: input.requestHash,
          status: "processing",
          locked_until: input.lockedUntil.toISOString(),
          expires_at: input.expiresAt.toISOString(),
        })
        .select(
          "id, site_id, idempotency_key_hash, request_hash, status, resource_type, resource_id, response_status, response_body, locked_until, expires_at",
        )
        .single()

      if (error) {
        return "conflict"
      }

      return mapIdempotencyRecord(data)
    },
  }
}

export async function claimRequestIdempotency(input: {
  client: AdminClient
  siteId: string
  idempotencyKey: string
  rawBody: Uint8Array
  now: Date
}) {
  return claimIdempotencyKey({
    siteId: input.siteId,
    idempotencyKey: input.idempotencyKey,
    rawBody: input.rawBody,
    now: input.now,
    lockSeconds: 30,
    ttlSeconds: 24 * 60 * 60,
    store: createIdempotencyStore(input.client),
  })
}

export async function completeLeadIngestion(input: {
  client: AdminClient
  idempotencyRecordId: string
  organizationId: string
  siteId: string
  leadPayload: Json
  attributionPayload: Json
}) {
  const { data, error } = await input.client.rpc("complete_lead_ingestion", {
    idempotency_record_id: input.idempotencyRecordId,
    target_organization_id: input.organizationId,
    target_site_id: input.siteId,
    lead_payload: input.leadPayload,
    attribution_payload: input.attributionPayload,
    response_payload: {},
  })

  if (error) {
    throw new Error("Lead ingestion transaction failed.")
  }

  return data as { success: true; leadId: string; duplicate: boolean }
}

export async function markIdempotencyFailed(input: {
  client: AdminClient
  idempotencyRecordId: string
  responseStatus: number
  responseBody: Record<string, unknown>
  errorCode: string
  failureKind: "retryable" | "non_retryable"
}) {
  await input.client
    .from("idempotency_records")
    .update({
      status: "failed",
      response_status: input.responseStatus,
      response_body: input.responseBody as Json,
      locked_until: null,
      failure_kind: input.failureKind,
      error_code: input.errorCode,
    })
    .eq("id", input.idempotencyRecordId)
}

export async function claimRateLimit(input: {
  client: AdminClient
  siteId: string
  scope: "site" | "site_ip"
  bucketKey: string
  windowSeconds: number
  maxAttempts: number
}) {
  const { data, error } = await input.client.rpc("claim_lead_rate_limit", {
    target_site_id: input.siteId,
    rate_scope: input.scope,
    target_bucket_key: input.bucketKey,
    window_seconds: input.windowSeconds,
    max_attempts: input.maxAttempts,
  })

  if (error) {
    throw new Error("Rate limit check failed.")
  }

  return data as {
    allowed: boolean
    count: number
    limit: number
    resetAt: string
  }
}

export async function recordSecurityEvent(input: {
  client: AdminClient
  organizationId?: string | null
  siteId?: string | null
  eventType: string
  severity: "info" | "warning" | "error"
  metadata: Json
}) {
  await input.client.rpc("record_security_event", {
    target_organization_id: input.organizationId ?? null,
    target_site_id: input.siteId ?? null,
    event_name: input.eventType,
    event_severity: input.severity,
    event_metadata: input.metadata,
  })
}

function mapIdempotencyRecord(data: {
  id: string
  site_id: string
  idempotency_key_hash: string
  request_hash: string
  status: "processing" | "completed" | "failed"
  resource_type: string | null
  resource_id: string | null
  response_status: number | null
  response_body: Json | null
  locked_until: string | null
  expires_at: string
}): IdempotencyRecord {
  return {
    id: data.id,
    siteId: data.site_id,
    idempotencyKeyHash: data.idempotency_key_hash,
    requestHash: data.request_hash,
    status: data.status,
    resourceType: data.resource_type,
    resourceId: data.resource_id,
    responseStatus: data.response_status,
    responseBody:
      data.response_body && typeof data.response_body === "object"
        ? (data.response_body as Record<string, unknown>)
        : null,
    lockedUntil: data.locked_until ? new Date(data.locked_until) : null,
    expiresAt: new Date(data.expires_at),
  }
}
