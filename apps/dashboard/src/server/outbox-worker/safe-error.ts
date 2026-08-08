const sensitivePattern =
  /(password|secret|token|authorization|cookie|signature|api[_-]?key|email|phone|recipient|raw|body)/gi

export function sanitizeWorkerError(value: unknown) {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "worker_error"

  return message.replace(sensitivePattern, "[REDACTED]").slice(0, 500)
}

export function fingerprintEmail(email: string) {
  return createHash("sha256")
    .update(email.trim().toLowerCase(), "utf8")
    .digest("hex")
}
import { createHash } from "node:crypto"
