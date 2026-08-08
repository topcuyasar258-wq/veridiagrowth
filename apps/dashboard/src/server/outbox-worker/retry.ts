export type FailureCategory =
  "provider" | "configuration" | "validation" | "database" | "unknown"

const backoffSeconds = [0, 60, 5 * 60, 15 * 60, 60 * 60]

export function getBackoffSeconds(attemptNumber: number) {
  return backoffSeconds[Math.max(0, attemptNumber - 1)] ?? 60 * 60
}

export function getNextRetryAt(input: { now: Date; attemptNumber: number }) {
  return new Date(
    input.now.getTime() + getBackoffSeconds(input.attemptNumber) * 1000,
  )
}

export function isRetryableCode(code: string) {
  return new Set([
    "provider_timeout",
    "provider_429",
    "provider_5xx",
    "temporary_database_error",
    "network_error",
    "delivery_unknown",
  ]).has(code)
}
