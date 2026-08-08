const allowedSentryEnvironments = new Set([
  "development",
  "staging",
  "production",
])

export function getSentryDsn() {
  return process.env.NEXT_PUBLIC_SENTRY_DSN || undefined
}

export function getSentryEnvironment() {
  const environment =
    process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development"

  return allowedSentryEnvironments.has(environment)
    ? environment
    : "development"
}
