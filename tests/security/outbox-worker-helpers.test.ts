import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getBackoffSeconds } from "../../apps/dashboard/src/server/outbox-worker/retry"
import {
  fingerprintEmail,
  sanitizeWorkerError,
} from "../../apps/dashboard/src/server/outbox-worker/safe-error"
import { verifyWorkerAuthorization } from "../../apps/dashboard/src/server/outbox-worker/worker"

describe("outbox worker helpers", () => {
  it("uses configured exponential backoff", () => {
    expect([1, 2, 3, 4, 5].map(getBackoffSeconds)).toEqual([
      0, 60, 300, 900, 3600,
    ])
  })

  it("sanitizes safe error messages", () => {
    expect(
      sanitizeWorkerError("recipient email ops@example.test token abc"),
    ).toBe("[REDACTED] [REDACTED] ops@example.test [REDACTED] abc")
  })

  it("hashes recipient email without storing the raw address", () => {
    const fingerprint = fingerprintEmail("Ops@Example.Test")

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(fingerprint).not.toContain("Ops")
  })

  it("requires worker bearer secret", () => {
    const request = new Request(
      "https://example.test/api/internal/workers/outbox",
      {
        method: "POST",
        headers: { Authorization: "Bearer secret" },
      },
    )

    expect(verifyWorkerAuthorization(request, "secret")).toBe(true)
    expect(verifyWorkerAuthorization(request, "wrong")).toBe(false)
    expect(verifyWorkerAuthorization(request, undefined)).toBe(false)
  })
})
