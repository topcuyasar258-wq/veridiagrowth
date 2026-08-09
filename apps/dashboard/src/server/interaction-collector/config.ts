import { z } from "zod"

/**
 * Collector configuration.
 *
 * Every threshold is environment driven. The defaults below are engineering
 * starting points, not business truth: they are set high enough that ordinary
 * visitors are never lost, and the response to exceeding them is a risk signal
 * rather than a hard block until abuse is extreme.
 */
const numberFromEnv = (fallback: number) =>
  z.coerce.number().int().positive().optional().default(fallback)

const collectorEnvSchema = z.object({
  VERIDIA_COLLECT_BODY_LIMIT_BYTES: numberFromEnv(32 * 1024),

  VERIDIA_EVENT_SITE_RATE_LIMIT_MAX: numberFromEnv(1000),
  VERIDIA_EVENT_SITE_RATE_LIMIT_WINDOW_SECONDS: numberFromEnv(60),

  VERIDIA_EVENT_SITE_IP_RATE_LIMIT_MAX: numberFromEnv(120),
  VERIDIA_EVENT_SITE_IP_RATE_LIMIT_WINDOW_SECONDS: numberFromEnv(60),

  VERIDIA_EVENT_SESSION_RATE_LIMIT_MAX: numberFromEnv(60),
  VERIDIA_EVENT_SESSION_RATE_LIMIT_WINDOW_SECONDS: numberFromEnv(60),

  VERIDIA_EVENT_TYPE_RATE_LIMIT_MAX: numberFromEnv(500),
  VERIDIA_EVENT_TYPE_RATE_LIMIT_WINDOW_SECONDS: numberFromEnv(60),

  /**
   * How far past a limit a caller must go before the whole request is refused
   * with 429 instead of merely scoring higher. Keeps a burst of real traffic
   * from being dropped while still bounding what a scripted flood can write.
   */
  VERIDIA_EVENT_RATE_HARD_MULTIPLIER: numberFromEnv(5),

  /**
   * Separate purpose key from the Phase 1 lead IP key. Reusing one key across
   * two purposes lets a hash computed for lead rate limiting be correlated with
   * a hash computed for interaction analytics, which links a named lead to an
   * anonymous browsing session. Separate keys keep those spaces disjoint.
   */
  VERIDIA_EVENT_IP_RISK_KEY: z.string().min(16).optional(),
})

const parsed = collectorEnvSchema.safeParse({
  VERIDIA_COLLECT_BODY_LIMIT_BYTES:
    process.env.VERIDIA_COLLECT_BODY_LIMIT_BYTES,
  VERIDIA_EVENT_SITE_RATE_LIMIT_MAX:
    process.env.VERIDIA_EVENT_SITE_RATE_LIMIT_MAX,
  VERIDIA_EVENT_SITE_RATE_LIMIT_WINDOW_SECONDS:
    process.env.VERIDIA_EVENT_SITE_RATE_LIMIT_WINDOW_SECONDS,
  VERIDIA_EVENT_SITE_IP_RATE_LIMIT_MAX:
    process.env.VERIDIA_EVENT_SITE_IP_RATE_LIMIT_MAX,
  VERIDIA_EVENT_SITE_IP_RATE_LIMIT_WINDOW_SECONDS:
    process.env.VERIDIA_EVENT_SITE_IP_RATE_LIMIT_WINDOW_SECONDS,
  VERIDIA_EVENT_SESSION_RATE_LIMIT_MAX:
    process.env.VERIDIA_EVENT_SESSION_RATE_LIMIT_MAX,
  VERIDIA_EVENT_SESSION_RATE_LIMIT_WINDOW_SECONDS:
    process.env.VERIDIA_EVENT_SESSION_RATE_LIMIT_WINDOW_SECONDS,
  VERIDIA_EVENT_TYPE_RATE_LIMIT_MAX:
    process.env.VERIDIA_EVENT_TYPE_RATE_LIMIT_MAX,
  VERIDIA_EVENT_TYPE_RATE_LIMIT_WINDOW_SECONDS:
    process.env.VERIDIA_EVENT_TYPE_RATE_LIMIT_WINDOW_SECONDS,
  VERIDIA_EVENT_RATE_HARD_MULTIPLIER:
    process.env.VERIDIA_EVENT_RATE_HARD_MULTIPLIER,
  VERIDIA_EVENT_IP_RISK_KEY: process.env.VERIDIA_EVENT_IP_RISK_KEY,
})

if (!parsed.success) {
  throw new Error("Interaction collector configuration is invalid.")
}

const env = parsed.data

export type QuotaScope = "site" | "site_ip" | "session" | "event_type"

export interface QuotaConfig {
  scope: QuotaScope
  max: number
  windowSeconds: number
}

export const collectorConfig = {
  bodyLimitBytes: env.VERIDIA_COLLECT_BODY_LIMIT_BYTES,
  hardMultiplier: env.VERIDIA_EVENT_RATE_HARD_MULTIPLIER,
  eventIpRiskKey: env.VERIDIA_EVENT_IP_RISK_KEY,
  quotas: {
    site: {
      scope: "site",
      max: env.VERIDIA_EVENT_SITE_RATE_LIMIT_MAX,
      windowSeconds: env.VERIDIA_EVENT_SITE_RATE_LIMIT_WINDOW_SECONDS,
    },
    site_ip: {
      scope: "site_ip",
      max: env.VERIDIA_EVENT_SITE_IP_RATE_LIMIT_MAX,
      windowSeconds: env.VERIDIA_EVENT_SITE_IP_RATE_LIMIT_WINDOW_SECONDS,
    },
    session: {
      scope: "session",
      max: env.VERIDIA_EVENT_SESSION_RATE_LIMIT_MAX,
      windowSeconds: env.VERIDIA_EVENT_SESSION_RATE_LIMIT_WINDOW_SECONDS,
    },
    event_type: {
      scope: "event_type",
      max: env.VERIDIA_EVENT_TYPE_RATE_LIMIT_MAX,
      windowSeconds: env.VERIDIA_EVENT_TYPE_RATE_LIMIT_WINDOW_SECONDS,
    },
  } satisfies Record<QuotaScope, QuotaConfig>,
} as const

/** `vtk_` + 32 lowercase hex, matching the database format constraint. */
export const SITE_KEY_PATTERN = /^vtk_[a-z0-9]{32}$/

/**
 * Whether the collector is safe to serve traffic.
 *
 * Without an IP risk key an address cannot be hashed, so the per-IP quota
 * silently does not exist -- and per-IP is the scope that actually bounds a
 * single abusive client. Losing it quietly is the failure mode this check
 * exists to prevent.
 *
 * Checked per request rather than at module load: a build machine legitimately
 * has no runtime secrets, and Next evaluates route modules during `next build`
 * with NODE_ENV=production. Failing there would break the build rather than
 * report a deployment problem.
 *
 * Development and test may run degraded, losing only that one scope.
 */
export function isCollectorProductionReady(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    Boolean(collectorConfig.eventIpRiskKey)
  )
}
