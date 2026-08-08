import "server-only"

import { z } from "zod"

const optionalInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const optionalEnvSchema = z.object({
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  VERIDIA_IP_RISK_KEY: z.string().min(16).optional(),
  VERIDIA_LEAD_BODY_LIMIT_BYTES: z.string().optional(),
  VERIDIA_FORM_MIN_COMPLETION_MS: z.string().optional(),
  VERIDIA_TURNSTILE_TIMEOUT_MS: z.string().optional(),
  VERIDIA_SITE_IP_RATE_LIMIT_MAX: z.string().optional(),
  VERIDIA_SITE_IP_RATE_LIMIT_WINDOW_SECONDS: z.string().optional(),
  VERIDIA_SITE_RATE_LIMIT_MAX: z.string().optional(),
  VERIDIA_SITE_RATE_LIMIT_WINDOW_SECONDS: z.string().optional(),
})

const parsed = optionalEnvSchema.safeParse(process.env)

if (!parsed.success) {
  throw new Error("Lead ingestion environment is not configured correctly.")
}

const env = parsed.data

export const leadIngestionConfig = {
  bodyLimitBytes: optionalInteger(env.VERIDIA_LEAD_BODY_LIMIT_BYTES, 32 * 1024),
  formMinCompletionMs: optionalInteger(
    env.VERIDIA_FORM_MIN_COMPLETION_MS,
    2_000,
  ),
  turnstileTimeoutMs: optionalInteger(env.VERIDIA_TURNSTILE_TIMEOUT_MS, 3_000),
  siteIpRateLimit: {
    max: optionalInteger(env.VERIDIA_SITE_IP_RATE_LIMIT_MAX, 10),
    windowSeconds: optionalInteger(
      env.VERIDIA_SITE_IP_RATE_LIMIT_WINDOW_SECONDS,
      5 * 60,
    ),
  },
  siteRateLimit: {
    max: optionalInteger(env.VERIDIA_SITE_RATE_LIMIT_MAX, 60),
    windowSeconds: optionalInteger(
      env.VERIDIA_SITE_RATE_LIMIT_WINDOW_SECONDS,
      60,
    ),
  },
  turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
  ipRiskKey: env.VERIDIA_IP_RISK_KEY,
} as const
