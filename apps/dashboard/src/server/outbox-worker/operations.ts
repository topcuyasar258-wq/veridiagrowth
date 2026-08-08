import "server-only"

import type { AdminClient } from "./types"
import {
  createManualOutboxRetry,
  getOutboxHealth,
  resolveDeadLetter,
} from "./repository"

export async function requestManualNotificationResend(input: {
  client: AdminClient
  organizationId: string
  siteId: string
  leadId: string
  actorUserId: string
}) {
  const jobKey = `notify-business-manual:${input.leadId}:${crypto.randomUUID()}`
  const { error } = await input.client.from("outbox_events").insert({
    organization_id: input.organizationId,
    site_id: input.siteId,
    event_type: "notify_business",
    aggregate_type: "lead",
    aggregate_id: input.leadId,
    job_key: jobKey,
    payload: {
      leadId: input.leadId,
      organizationId: input.organizationId,
      siteId: input.siteId,
      manual: true,
    },
    status: "pending",
    available_at: new Date().toISOString(),
  })

  if (error) {
    throw new Error("Manual resend request failed.")
  }

  await input.client.from("audit_logs").insert({
    organization_id: input.organizationId,
    actor_user_id: input.actorUserId,
    action: "notification.manual_resend_requested",
    entity_type: "lead",
    entity_id: input.leadId,
    metadata: {
      siteId: input.siteId,
      jobKey,
    },
  })

  return { jobKey }
}

export async function requeueDeadLetter(input: {
  client: AdminClient
  deadLetterId: string
  actorUserId: string
}) {
  await createManualOutboxRetry(input)
}

export async function resolveDeadLetterEvent(input: {
  client: AdminClient
  deadLetterId: string
  actorUserId: string
  note: string
}) {
  await resolveDeadLetter(input)
}

export async function getOutboxHealthWithStatus(input: {
  client: AdminClient
}) {
  const health = await getOutboxHealth(input)
  const age = health.oldestPendingAgeSeconds ?? 0
  const status =
    age > 600 || health.deadLetterCount > 0
      ? "critical"
      : age > 120
        ? "warning"
        : "ok"

  return { ...health, status }
}
