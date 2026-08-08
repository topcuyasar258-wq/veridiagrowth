import { createHmac } from "node:crypto"

export function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")
  const realIp = request.headers.get("x-real-ip")

  if (forwardedFor) {
    return normalizeIp(forwardedFor.split(",")[0] ?? "")
  }

  if (realIp) {
    return normalizeIp(realIp)
  }

  return undefined
}

export function normalizeIp(value: string) {
  const trimmed = value.trim().toLowerCase()

  if (!trimmed) {
    return undefined
  }

  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed
}

export function hashIpForRisk(input: { ip: string; key: string }) {
  return createHmac("sha256", input.key).update(input.ip, "utf8").digest("hex")
}
