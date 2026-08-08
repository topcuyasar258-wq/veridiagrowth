import "server-only"

import { renderBusinessLeadEmail } from "../email/templates"
import { fingerprintEmail, sanitizeWorkerError } from "./safe-error"
import type {
  AdminClient,
  ClaimedOutboxEvent,
  JobResult,
  OutboxHandler,
} from "./types"

type LeadForNotification = {
  id: string
  organization_id: string
  site_id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  service: string | null
  city: string | null
  message: string | null
  source_category: string
  created_at: string
  sites: { name: string } | null
  organizations: { name: string } | null
}

export const notifyBusinessHandler: OutboxHandler = {
  eventType: "notify_business",
  async execute(event, context) {
    const leadId = event.aggregate_id
    const logicalDeliveryKey = `notify-business:${leadId}`
    const existingOperation = await findDeliveryOperation({
      client: context.client,
      templateKey: "business_lead_v1",
      logicalDeliveryKey,
    })

    if (existingOperation?.status === "sent") {
      return { ok: true }
    }

    const lead = await readLeadForNotification(context.client, leadId)

    if (!lead) {
      return failure("invalid_template_data", false, "validation")
    }

    const setting = await readNotificationSetting({
      client: context.client,
      organizationId: lead.organization_id,
      siteId: lead.site_id,
    })

    if (!setting?.enabled) {
      return failure("notification_disabled", false, "configuration")
    }

    if (!setting.recipient_email) {
      return failure("missing_required_configuration", false, "configuration")
    }

    const operation =
      existingOperation ??
      (await createDeliveryOperation({
        client: context.client,
        organizationId: lead.organization_id,
        siteId: lead.site_id,
        leadId,
        logicalDeliveryKey,
      }))
    const attemptNumber = await getNextDeliveryAttemptNumber({
      client: context.client,
      operationId: operation.id,
    })
    const recipientFingerprint = fingerprintEmail(setting.recipient_email)
    const attempt = await createDeliveryAttempt({
      client: context.client,
      event,
      leadId,
      operationId: operation.id,
      recipientFingerprint,
      attemptNumber,
    })
    const rendered = renderBusinessLeadEmail({
      siteName: lead.sites?.name ?? "Veridia",
      leadPanelUrl: `${context.leadPanelBaseUrl.replace(/\/+$/, "")}/dashboard`,
      contact: {
        firstName: lead.first_name,
        lastName: lead.last_name,
        phone: lead.phone,
        email: lead.email,
      },
      lead: {
        service: lead.service,
        city: lead.city,
        message: lead.message,
        createdAt: lead.created_at,
      },
      sourceCategory: lead.source_category,
    })

    await markDeliveryOperationSending(context.client, operation.id)

    const providerResult = await context.emailProvider.send({
      to: setting.recipient_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: logicalDeliveryKey,
    })

    if (providerResult.success) {
      await markDeliveryAttemptSent({
        client: context.client,
        attemptId: attempt.id,
        operationId: operation.id,
        providerMessageId: providerResult.providerMessageId,
      })
      return { ok: true }
    }

    await markDeliveryAttemptFailed({
      client: context.client,
      attemptId: attempt.id,
      operationId: operation.id,
      code: providerResult.code,
      unknown: providerResult.code === "provider_timeout",
    })

    return failure(
      providerResult.code,
      providerResult.retryable,
      "provider",
      providerResult.code,
    )
  },
}

export const updateMetricsHandler: OutboxHandler = {
  eventType: "update_metrics",
  async execute() {
    await Promise.resolve()
    return { ok: true }
  },
}

export function createHandlerRegistry(handlers: OutboxHandler[]) {
  return new Map(handlers.map((handler) => [handler.eventType, handler]))
}

function failure(
  code: string,
  retryable: boolean,
  category: Exclude<JobResult, { ok: true }>["category"],
  message?: string,
): JobResult {
  return {
    ok: false,
    retryable,
    code,
    category,
    messageSafe: sanitizeWorkerError(message ?? code),
  }
}

async function readLeadForNotification(client: AdminClient, leadId: string) {
  const { data, error } = await client
    .from("leads")
    .select(
      "id, organization_id, site_id, first_name, last_name, phone, email, service, city, message, source_category, created_at, sites(name), organizations(name)",
    )
    .eq("id", leadId)
    .maybeSingle()

  if (error) {
    return null
  }

  return data as LeadForNotification | null
}

async function readNotificationSetting(input: {
  client: AdminClient
  organizationId: string
  siteId: string
}) {
  const siteSetting = await input.client
    .from("notification_settings")
    .select("recipient_email, enabled")
    .eq("organization_id", input.organizationId)
    .eq("site_id", input.siteId)
    .eq("channel", "email")
    .maybeSingle()

  if (siteSetting.data) {
    return siteSetting.data
  }

  const orgSetting = await input.client
    .from("notification_settings")
    .select("recipient_email, enabled")
    .eq("organization_id", input.organizationId)
    .is("site_id", null)
    .eq("channel", "email")
    .maybeSingle()

  return orgSetting.data
}

async function findDeliveryOperation(input: {
  client: AdminClient
  templateKey: string
  logicalDeliveryKey: string
}) {
  const { data } = await input.client
    .from("delivery_operations")
    .select("id, status")
    .eq("channel", "email")
    .eq("template_key", input.templateKey)
    .eq("logical_delivery_key", input.logicalDeliveryKey)
    .maybeSingle()

  return data
}

async function createDeliveryOperation(input: {
  client: AdminClient
  organizationId: string
  siteId: string
  leadId: string
  logicalDeliveryKey: string
}) {
  const { data, error } = await input.client
    .from("delivery_operations")
    .insert({
      organization_id: input.organizationId,
      site_id: input.siteId,
      lead_id: input.leadId,
      channel: "email",
      template_key: "business_lead_v1",
      logical_delivery_key: input.logicalDeliveryKey,
      status: "pending",
    })
    .select("id, status")
    .single()

  if (error) {
    const existing = await findDeliveryOperation({
      client: input.client,
      templateKey: "business_lead_v1",
      logicalDeliveryKey: input.logicalDeliveryKey,
    })

    if (existing) {
      return existing
    }

    throw new Error("Delivery operation insert failed.")
  }

  return data
}

async function getNextDeliveryAttemptNumber(input: {
  client: AdminClient
  operationId: string
}) {
  const { count } = await input.client
    .from("delivery_attempts")
    .select("*", { count: "exact", head: true })
    .eq("delivery_operation_id", input.operationId)

  return (count ?? 0) + 1
}

async function createDeliveryAttempt(input: {
  client: AdminClient
  event: ClaimedOutboxEvent
  leadId: string
  operationId: string
  recipientFingerprint: string
  attemptNumber: number
}) {
  const { data, error } = await input.client
    .from("delivery_attempts")
    .insert({
      organization_id: input.event.organization_id,
      site_id: input.event.site_id,
      lead_id: input.leadId,
      outbox_event_id: input.event.id,
      delivery_operation_id: input.operationId,
      channel: "email",
      provider: "resend",
      template_key: "business_lead_v1",
      recipient_fingerprint: input.recipientFingerprint,
      attempt_number: input.attemptNumber,
      status: "pending",
    })
    .select("id")
    .single()

  if (error) {
    throw new Error("Delivery attempt insert failed.")
  }

  return data
}

async function markDeliveryOperationSending(client: AdminClient, id: string) {
  await client
    .from("delivery_operations")
    .update({ status: "sending" })
    .eq("id", id)
    .neq("status", "sent")
}

async function markDeliveryAttemptSent(input: {
  client: AdminClient
  attemptId: string
  operationId: string
  providerMessageId: string
}) {
  const now = new Date().toISOString()

  await input.client
    .from("delivery_attempts")
    .update({
      status: "sent",
      provider_status: "accepted",
      provider_message_id: input.providerMessageId,
      sent_at: now,
    })
    .eq("id", input.attemptId)

  await input.client
    .from("delivery_operations")
    .update({
      status: "sent",
      provider_message_id: input.providerMessageId,
    })
    .eq("id", input.operationId)
}

async function markDeliveryAttemptFailed(input: {
  client: AdminClient
  attemptId: string
  operationId: string
  code: string
  unknown: boolean
}) {
  const now = new Date().toISOString()
  const status = input.unknown ? "delivery_unknown" : "failed"

  await input.client
    .from("delivery_attempts")
    .update({
      status,
      error_code: input.code,
      error_message_safe: input.code,
      failed_at: input.unknown ? null : now,
    })
    .eq("id", input.attemptId)

  await input.client
    .from("delivery_operations")
    .update({ status })
    .eq("id", input.operationId)
}
