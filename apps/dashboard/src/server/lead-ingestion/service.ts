import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"
import { normalizeEmail, normalizeTurkishPhone } from "@veridia/shared"
import { verifyLeadRequest } from "@veridia/security"
import type { BotChallengeProvider } from "./turnstile"

import { buildAttributionPayload } from "./attribution"
import { leadIngestionConfig } from "./config"
import {
  claimRateLimit,
  claimRequestIdempotency,
  completeLeadIngestion,
  createCredentialLookup,
  createNonceStore,
  markIdempotencyFailed,
  recordSecurityEvent,
} from "./repositories"
import { readLimitedRawBody } from "./raw-body"
import { validateLeadRequestBody } from "./schema"
import { evaluateSpamSignals } from "./spam"
import { getRequestIp, hashIpForRisk } from "../security/request-ip"

type AdminClient = SupabaseClient<Database>

export type LeadIngestionDependencies = {
  client: AdminClient
  botChallengeProvider: BotChallengeProvider
  now?: Date
}

export async function handleLeadIngestion(
  request: Request,
  dependencies: LeadIngestionDependencies,
) {
  const now = dependencies.now ?? new Date()
  const url = new URL(request.url)

  if (url.search.length > 0) {
    return invalidRequest(400)
  }

  if (request.method !== "POST") {
    return invalidRequest(405)
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? ""

  if (contentType.split(";")[0]?.trim() !== "application/json") {
    return invalidRequest(415)
  }

  const rawBodyResult = await readLimitedRawBody(
    request,
    leadIngestionConfig.bodyLimitBytes,
  )

  if (!rawBodyResult.ok) {
    return invalidRequest(rawBodyResult.code === "body_too_large" ? 413 : 400)
  }

  const hmacResult = await verifyLeadRequest({
    method: request.method,
    path: url.pathname,
    rawBody: rawBodyResult.rawBody,
    headers: request.headers,
    now,
    credentials: createCredentialLookup(dependencies.client),
    nonces: createNonceStore(dependencies.client),
  })

  if (!hmacResult.ok) {
    await recordSecurityEvent({
      client: dependencies.client,
      eventType: mapHmacFailureEvent(hmacResult.code),
      severity: "warning",
      metadata: { code: hmacResult.code },
    })

    return invalidRequest(401)
  }

  const idempotencyKey = request.headers.get("idempotency-key")

  if (!idempotencyKey) {
    return invalidRequest(400)
  }

  const idempotency = await claimRequestIdempotency({
    client: dependencies.client,
    siteId: hmacResult.siteId,
    idempotencyKey,
    rawBody: rawBodyResult.rawBody,
    now,
  })

  if (idempotency.status === "conflict") {
    return invalidRequest(409)
  }

  if (idempotency.status === "processing") {
    return invalidRequest(409)
  }

  if (idempotency.status === "replay") {
    return Response.json(idempotency.record.responseBody ?? {}, {
      status: idempotency.record.responseStatus ?? 200,
    })
  }

  if (idempotency.status === "failed_replay") {
    return Response.json(idempotency.record.responseBody ?? invalidBody(), {
      status: idempotency.record.responseStatus ?? 400,
    })
  }

  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(rawBodyResult.text)
  } catch {
    return failClaimedRequest({
      client: dependencies.client,
      idempotencyRecordId: idempotency.record.id,
      status: 400,
      errorCode: "invalid_json",
    })
  }

  const parsedBody = validateLeadRequestBody(parsedJson)

  if (!parsedBody.success) {
    return failClaimedRequest({
      client: dependencies.client,
      idempotencyRecordId: idempotency.record.id,
      status: 400,
      errorCode: "validation_failed",
    })
  }

  const body = parsedBody.data
  const remoteIp = getRequestIp(request)

  if (remoteIp && !leadIngestionConfig.ipRiskKey) {
    return invalidRequest(503)
  }

  const challenge = await dependencies.botChallengeProvider.verify({
    token: body.security.turnstileToken,
    remoteIp,
  })

  if (!challenge.success) {
    await recordSecurityEvent({
      client: dependencies.client,
      organizationId: hmacResult.organizationId,
      siteId: hmacResult.siteId,
      eventType: "security.turnstile_failed",
      severity: "warning",
      metadata: { reason: challenge.reason },
    })

    return failClaimedRequest({
      client: dependencies.client,
      idempotencyRecordId: idempotency.record.id,
      status: 403,
      errorCode: `turnstile_${challenge.reason}`,
      failureKind:
        challenge.reason === "provider_error" || challenge.reason === "timeout"
          ? "retryable"
          : "non_retryable",
    })
  }

  const spam = evaluateSpamSignals({
    body,
    minCompletionMs: leadIngestionConfig.formMinCompletionMs,
  })

  if (!spam.accepted) {
    return failClaimedRequest({
      client: dependencies.client,
      idempotencyRecordId: idempotency.record.id,
      status: 400,
      errorCode: spam.code,
    })
  }

  const ipBucketKey = remoteIp
    ? hashIpForRisk({
        ip: remoteIp,
        key: leadIngestionConfig.ipRiskKey ?? "",
      })
    : "unknown-ip"

  const siteIpLimit = await claimRateLimit({
    client: dependencies.client,
    siteId: hmacResult.siteId,
    scope: "site_ip",
    bucketKey: ipBucketKey,
    windowSeconds: leadIngestionConfig.siteIpRateLimit.windowSeconds,
    maxAttempts: leadIngestionConfig.siteIpRateLimit.max,
  })

  const siteLimit = await claimRateLimit({
    client: dependencies.client,
    siteId: hmacResult.siteId,
    scope: "site",
    bucketKey: hmacResult.siteId,
    windowSeconds: leadIngestionConfig.siteRateLimit.windowSeconds,
    maxAttempts: leadIngestionConfig.siteRateLimit.max,
  })

  if (!siteIpLimit.allowed || !siteLimit.allowed) {
    await recordSecurityEvent({
      client: dependencies.client,
      organizationId: hmacResult.organizationId,
      siteId: hmacResult.siteId,
      eventType: "security.rate_limit_exceeded",
      severity: "warning",
      metadata: {
        siteIpExceeded: !siteIpLimit.allowed,
        siteExceeded: !siteLimit.allowed,
      },
    })

    return failClaimedRequest({
      client: dependencies.client,
      idempotencyRecordId: idempotency.record.id,
      status: 429,
      errorCode: "rate_limit_exceeded",
      failureKind: "retryable",
    })
  }

  const normalizedPhone = body.contact.phone
    ? normalizeTurkishPhone(body.contact.phone)
    : null
  const normalizedEmail = body.contact.email
    ? normalizeEmail(body.contact.email)
    : null

  if (body.contact.phone && !normalizedPhone) {
    return failClaimedRequest({
      client: dependencies.client,
      idempotencyRecordId: idempotency.record.id,
      status: 400,
      errorCode: "invalid_phone",
    })
  }

  if (body.contact.email && !normalizedEmail) {
    return failClaimedRequest({
      client: dependencies.client,
      idempotencyRecordId: idempotency.record.id,
      status: 400,
      errorCode: "invalid_email",
    })
  }

  const attributionPayload = buildAttributionPayload(body)
  const transactionResult = await completeLeadIngestion({
    client: dependencies.client,
    idempotencyRecordId: idempotency.record.id,
    organizationId: hmacResult.organizationId,
    siteId: hmacResult.siteId,
    leadPayload: {
      firstName: body.contact.firstName ?? null,
      lastName: body.contact.lastName ?? null,
      phone: body.contact.phone ?? null,
      phoneNormalized: normalizedPhone,
      email: body.contact.email ?? null,
      emailNormalized: normalizedEmail,
      service: body.lead.service ?? null,
      city: body.lead.city ?? null,
      message: body.lead.message ?? null,
      isSuspicious: spam.suspicious,
      suspicionReasons: spam.reasons,
    },
    attributionPayload,
  })

  return Response.json(transactionResult, { status: 201 })
}

function invalidRequest(status: number) {
  return Response.json(invalidBody(), { status })
}

async function failClaimedRequest(input: {
  client: AdminClient
  idempotencyRecordId: string
  status: number
  errorCode: string
  failureKind?: "retryable" | "non_retryable"
}) {
  const body = invalidBody()
  await markIdempotencyFailed({
    client: input.client,
    idempotencyRecordId: input.idempotencyRecordId,
    responseStatus: input.status,
    responseBody: body,
    errorCode: input.errorCode,
    failureKind: input.failureKind ?? "non_retryable",
  })

  return Response.json(body, { status: input.status })
}

function invalidBody() {
  return { error: "invalid_request" }
}

function mapHmacFailureEvent(code: string) {
  if (code === "signature_invalid") {
    return "security.invalid_signature"
  }

  if (code === "nonce_reused") {
    return "security.replay_detected"
  }

  return `security.${code}`
}
