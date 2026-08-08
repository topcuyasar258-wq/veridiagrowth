const sensitiveKeyPattern =
  /(?:password|secret|client[_-]?secret|site[_-]?secret|token|access[_-]?token|refresh[_-]?token|authorization|cookie|set[_-]?cookie|signature|x[_-]?veridia[_-]?signature|supabase[_-]?service[_-]?role[_-]?key|ciphertext|(^|[_-])iv($|[_-])|auth(?:entication)?[_-]?tag|(^|[_-])tag($|[_-])|message|auth|session|jwt|api[_-]?key|email|phone|name|address|ip)/i

const maxMetadataBytes = 32 * 1024

export type AuditMetadata = Record<string, unknown>

export function sanitizeAuditMetadata(metadata: AuditMetadata): AuditMetadata {
  try {
    return sanitizeRecord(metadata, new WeakSet())
  } catch {
    return { sanitization_error: true }
  }
}

function sanitizeRecord(
  record: AuditMetadata,
  seenObjects: WeakSet<object>,
): AuditMetadata {
  if (seenObjects.has(record)) {
    return { circular: true }
  }

  seenObjects.add(record)

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      sanitizeValue(key, value, seenObjects),
    ]),
  )
}

function sanitizeValue(
  key: string,
  value: unknown,
  seenObjects: WeakSet<object>,
): unknown {
  if (sensitiveKeyPattern.test(key)) {
    return "[REDACTED]"
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item, seenObjects))
  }

  return sanitizeUnknown(value, seenObjects)
}

function sanitizeUnknown(
  value: unknown,
  seenObjects: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item, seenObjects))
  }

  if (typeof value === "object") {
    return sanitizeRecord(value as AuditMetadata, seenObjects)
  }

  return value
}

export function enforceAuditMetadataLimit(
  metadata: AuditMetadata,
): AuditMetadata {
  const sanitized = sanitizeAuditMetadata(metadata)
  const serialized = JSON.stringify(sanitized)

  if (Buffer.byteLength(serialized, "utf8") > maxMetadataBytes) {
    return { truncated: true }
  }

  return sanitized
}
