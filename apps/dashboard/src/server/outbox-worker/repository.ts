import "server-only"

import type { Json } from "@veridia/database"
import type { AdminClient, ClaimedOutboxEvent, JobResult } from "./types"

export async function claimOutboxEvents(input: {
  client: AdminClient
  workerId: string
  batchSize: number
  lockTimeoutSeconds: number
}) {
  const { data, error } = await input.client.rpc("claim_outbox_events", {
    worker_id: input.workerId,
    batch_size: input.batchSize,
    lock_timeout_seconds: input.lockTimeoutSeconds,
  })

  if (error) {
    throw new Error("Outbox claim failed.")
  }

  return (data ?? []) as ClaimedOutboxEvent[]
}

export async function startJobExecution(input: {
  client: AdminClient
  event: ClaimedOutboxEvent
  workerId: string
}) {
  const attemptNumber = input.event.attempt_count + 1
  const { data, error } = await input.client
    .from("job_executions")
    .insert({
      outbox_event_id: input.event.id,
      organization_id: input.event.organization_id,
      job_key: input.event.job_key,
      event_type: input.event.event_type,
      attempt_number: attemptNumber,
      worker_id: input.workerId,
      status: "processing",
      started_at: new Date().toISOString(),
    })
    .select("id, started_at")
    .single()

  if (error) {
    throw new Error("Job execution insert failed.")
  }

  return { id: data.id, startedAt: new Date(data.started_at), attemptNumber }
}

export async function finishJobExecution(input: {
  client: AdminClient
  executionId: string
  startedAt: Date
  result: JobResult
}) {
  const now = new Date()
  const durationMs = Math.max(0, now.getTime() - input.startedAt.getTime())

  await input.client
    .from("job_executions")
    .update({
      status: input.result.ok ? "completed" : "failed",
      finished_at: now.toISOString(),
      duration_ms: durationMs,
      error_code: input.result.ok ? null : input.result.code,
      error_category: input.result.ok ? null : input.result.category,
      error_message_safe: input.result.ok
        ? null
        : (input.result.messageSafe ?? input.result.code),
    })
    .eq("id", input.executionId)
}

export async function finishOutboxSuccess(input: {
  client: AdminClient
  eventId: string
  workerId: string
}) {
  const { error } = await input.client.rpc("finish_outbox_success", {
    target_outbox_event_id: input.eventId,
    target_worker_id: input.workerId,
  })

  if (error) {
    throw new Error("Outbox success transition failed.")
  }
}

export async function finishOutboxFailure(input: {
  client: AdminClient
  eventId: string
  workerId: string
  result: Exclude<JobResult, { ok: true }>
  maxAttempts: number
  nextRetryAt: Date
}) {
  const { data, error } = await input.client.rpc("finish_outbox_failure", {
    target_outbox_event_id: input.eventId,
    target_worker_id: input.workerId,
    retryable: input.result.retryable,
    max_attempts: input.maxAttempts,
    next_available_at: input.nextRetryAt.toISOString(),
    failure_code: input.result.code,
    failure_category: input.result.category,
    failure_message_safe: input.result.messageSafe ?? input.result.code,
  })

  if (error) {
    throw new Error("Outbox failure transition failed.")
  }

  return data as "pending" | "dead_letter"
}

export async function getOutboxHealth(input: { client: AdminClient }) {
  const [
    { count: pendingCount },
    { count: processingCount },
    { count: deadLetterCount },
  ] = await Promise.all([
    input.client
      .from("outbox_events")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    input.client
      .from("outbox_events")
      .select("*", { count: "exact", head: true })
      .eq("status", "processing"),
    input.client
      .from("outbox_events")
      .select("*", { count: "exact", head: true })
      .eq("status", "dead_letter"),
  ])
  const { data: oldestPending } = await input.client
    .from("outbox_events")
    .select("created_at")
    .eq("status", "pending")
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  return {
    pendingCount: pendingCount ?? 0,
    processingCount: processingCount ?? 0,
    deadLetterCount: deadLetterCount ?? 0,
    oldestPendingAgeSeconds: oldestPending
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(oldestPending.created_at).getTime()) / 1000,
          ),
        )
      : null,
  }
}

export async function createManualOutboxRetry(input: {
  client: AdminClient
  deadLetterId: string
  actorUserId: string
}) {
  const { error } = await input.client.rpc("requeue_dead_letter_event", {
    target_dead_letter_id: input.deadLetterId,
    actor_user_id: input.actorUserId,
  })

  if (error) {
    throw new Error("Dead letter requeue failed.")
  }
}

export async function resolveDeadLetter(input: {
  client: AdminClient
  deadLetterId: string
  actorUserId: string
  note: string
}) {
  const { error } = await input.client.rpc("resolve_dead_letter_event", {
    target_dead_letter_id: input.deadLetterId,
    actor_user_id: input.actorUserId,
    note: input.note,
  })

  if (error) {
    throw new Error("Dead letter resolve failed.")
  }
}

export function getPayloadValue(payload: Json, key: string) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload[key]
    : undefined
}
