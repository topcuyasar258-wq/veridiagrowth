import { enforceAuditMetadataLimit } from "./audit-metadata"

type SentryEvent = {
  request?: {
    cookies?: unknown
    data?: unknown
    headers?: Record<string, unknown>
  }
  extra?: Record<string, unknown>
  user?: Record<string, unknown>
  contexts?: Record<string, unknown>
}

export function sanitizeSentryEvent<TEvent extends SentryEvent>(
  event: TEvent,
): TEvent {
  const sanitizedRequest = event.request
    ? {
        ...event.request,
        cookies: event.request.cookies ? "[REDACTED]" : undefined,
        data: undefined,
        headers: event.request.headers
          ? sanitizeHeaders(event.request.headers)
          : undefined,
      }
    : undefined

  return {
    ...event,
    request: sanitizedRequest,
    extra: event.extra ? enforceAuditMetadataLimit(event.extra) : undefined,
    user: event.user ? enforceAuditMetadataLimit(event.user) : undefined,
    contexts: event.contexts
      ? enforceAuditMetadataLimit(event.contexts)
      : undefined,
  }
}

function sanitizeHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  return enforceAuditMetadataLimit(headers)
}
