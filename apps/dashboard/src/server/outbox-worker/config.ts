import "server-only"

import { z } from "zod"

const optionalInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Treats an empty environment variable as absent.
 *
 * A hosting dashboard makes it easy to define a variable with no value, and a
 * bare `.email()` or `.url()` rejects `""`. That would throw at module load and
 * turn a misconfiguration into a 500 from every worker request, instead of the
 * 503 that says what is actually wrong.
 */
const blankAsUndefined = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), inner.optional())

const schema = z.object({
  VERIDIA_WORKER_SECRET: z.string().min(1).optional(),
  VERIDIA_OUTBOX_BATCH_SIZE: z.string().optional(),
  VERIDIA_OUTBOX_LOCK_TIMEOUT_SECONDS: z.string().optional(),
  VERIDIA_OUTBOX_MAX_ATTEMPTS: z.string().optional(),
  RESEND_API_KEY: blankAsUndefined(z.string().min(1)),
  VERIDIA_EMAIL_FROM: blankAsUndefined(z.string().email()),
  VERIDIA_EMAIL_REPLY_TO: blankAsUndefined(z.string().email()),
  VERIDIA_EMAIL_PROVIDER_TIMEOUT_MS: z.string().optional(),

  /**
   * Base URL of the customer lead panel, used to build the link in every
   * notification email. Must be an absolute origin; the path is appended.
   */
  VERIDIA_LEAD_PANEL_BASE_URL: blankAsUndefined(z.string().url()),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  throw new Error("Outbox worker environment is not configured correctly.")
}

const env = parsed.data

export const outboxWorkerConfig = {
  workerSecret: env.VERIDIA_WORKER_SECRET,
  batchSize: optionalInteger(env.VERIDIA_OUTBOX_BATCH_SIZE, 10),
  lockTimeoutSeconds: optionalInteger(
    env.VERIDIA_OUTBOX_LOCK_TIMEOUT_SECONDS,
    120,
  ),
  maxAttempts: optionalInteger(env.VERIDIA_OUTBOX_MAX_ATTEMPTS, 5),
  resendApiKey: env.RESEND_API_KEY,
  emailFrom: env.VERIDIA_EMAIL_FROM,
  emailReplyTo: env.VERIDIA_EMAIL_REPLY_TO,
  emailProviderTimeoutMs: optionalInteger(
    env.VERIDIA_EMAIL_PROVIDER_TIMEOUT_MS,
    5_000,
  ),
  leadPanelBaseUrl: env.VERIDIA_LEAD_PANEL_BASE_URL,
} as const

/**
 * Whether the worker is safe to deliver notifications.
 *
 * Without a sender address and a lead panel URL the worker still runs, but it
 * sends mail from `no-reply@example.invalid` carrying a link to a host that
 * does not exist. That is worse than not sending: the outbox row is marked
 * delivered, so the notification is gone and nobody learns the lead was missed.
 *
 * Refusing instead leaves the event in the queue, where the pending-age alarm
 * in docs/worker-operations.md will show it.
 *
 * Checked per request rather than at module load, for the same reason as the
 * collector: `next build` evaluates route modules with NODE_ENV=production on a
 * machine that legitimately has no runtime secrets.
 */
export function isOutboxWorkerProductionReady(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    Boolean(outboxWorkerConfig.emailFrom && outboxWorkerConfig.leadPanelBaseUrl)
  )
}
