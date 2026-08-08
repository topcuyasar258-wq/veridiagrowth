import "server-only"

import { z } from "zod"

const optionalInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const schema = z.object({
  VERIDIA_WORKER_SECRET: z.string().min(1).optional(),
  VERIDIA_OUTBOX_BATCH_SIZE: z.string().optional(),
  VERIDIA_OUTBOX_LOCK_TIMEOUT_SECONDS: z.string().optional(),
  VERIDIA_OUTBOX_MAX_ATTEMPTS: z.string().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  VERIDIA_EMAIL_FROM: z.string().email().optional(),
  VERIDIA_EMAIL_REPLY_TO: z.string().email().optional(),
  VERIDIA_EMAIL_PROVIDER_TIMEOUT_MS: z.string().optional(),
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
} as const
