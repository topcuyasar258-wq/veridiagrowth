import "server-only"

import { hostname } from "node:os"
import { randomUUID, timingSafeEqual } from "node:crypto"

import { ResendEmailProvider } from "../email/resend-provider"
import {
  createHandlerRegistry,
  notifyBusinessHandler,
  updateMetricsHandler,
} from "./handlers"
import { outboxWorkerConfig } from "./config"
import {
  claimOutboxEvents,
  finishJobExecution,
  finishOutboxFailure,
  finishOutboxSuccess,
  startJobExecution,
} from "./repository"
import { getNextRetryAt } from "./retry"
import { sanitizeWorkerError } from "./safe-error"
import type { AdminClient, JobResult, OutboxHandlerContext } from "./types"

export type WorkerSummary = {
  claimed: number
  completed: number
  retried: number
  deadLettered: number
}

export function createWorkerId() {
  return `${hostname()}/${process.pid}/${randomUUID()}`
}

export function verifyWorkerAuthorization(request: Request, secret?: string) {
  if (!secret) {
    return false
  }

  const rawHeader = request.headers.get("authorization")
  const value = rawHeader?.startsWith("Bearer ") ? rawHeader.slice(7) : ""

  return timingSafeStringEqual(value, secret)
}

export async function runOutboxWorker(input: {
  client: AdminClient
  workerId?: string
  context?: Partial<OutboxHandlerContext>
}) {
  const workerId = input.workerId ?? createWorkerId()
  const events = await claimOutboxEvents({
    client: input.client,
    workerId,
    batchSize: outboxWorkerConfig.batchSize,
    lockTimeoutSeconds: outboxWorkerConfig.lockTimeoutSeconds,
  })
  const registry = createHandlerRegistry([
    notifyBusinessHandler,
    updateMetricsHandler,
  ])
  const context: OutboxHandlerContext = {
    client: input.client,
    emailProvider:
      input.context?.emailProvider ??
      new ResendEmailProvider({
        apiKey: outboxWorkerConfig.resendApiKey ?? "",
        from: outboxWorkerConfig.emailFrom ?? "no-reply@example.invalid",
        replyTo: outboxWorkerConfig.emailReplyTo,
        timeoutMs: outboxWorkerConfig.emailProviderTimeoutMs,
      }),
    // The placeholder survives only for tests and local development, where
    // isOutboxWorkerProductionReady lets the worker run degraded. In production
    // the route refuses before reaching here unless the real URL is configured.
    leadPanelBaseUrl:
      input.context?.leadPanelBaseUrl ??
      outboxWorkerConfig.leadPanelBaseUrl ??
      "https://app.veridia.local",
  }
  const summary: WorkerSummary = {
    claimed: events.length,
    completed: 0,
    retried: 0,
    deadLettered: 0,
  }

  for (const event of events) {
    const execution = await startJobExecution({
      client: input.client,
      event,
      workerId,
    })
    const handler = registry.get(event.event_type)
    const result = handler
      ? await handler.execute(event, context)
      : ({
          ok: false,
          retryable: false,
          code: "unknown_event_type",
          category: "validation",
          messageSafe: "unknown_event_type",
        } satisfies JobResult)

    await finishJobExecution({
      client: input.client,
      executionId: execution.id,
      startedAt: execution.startedAt,
      result,
    })

    if (result.ok) {
      await finishOutboxSuccess({
        client: input.client,
        eventId: event.id,
        workerId,
      })
      summary.completed += 1
      continue
    }

    const finalStatus = await finishOutboxFailure({
      client: input.client,
      eventId: event.id,
      workerId,
      result: {
        ...result,
        messageSafe: sanitizeWorkerError(result.messageSafe ?? result.code),
      },
      maxAttempts: outboxWorkerConfig.maxAttempts,
      nextRetryAt: getNextRetryAt({
        now: new Date(),
        attemptNumber: event.attempt_count + 1,
      }),
    })

    if (finalStatus === "pending") {
      summary.retried += 1
    } else {
      summary.deadLettered += 1
    }
  }

  return summary
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}
