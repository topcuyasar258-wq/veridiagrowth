import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

/**
 * The config module reads process.env once at import time, so each case has to
 * load it fresh after stubbing the environment.
 */
async function loadReadiness(env: Record<string, string | undefined>) {
  vi.resetModules()

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      vi.stubEnv(key, "")
    } else {
      vi.stubEnv(key, value)
    }
  }

  const module =
    await import("../../apps/dashboard/src/server/outbox-worker/config")

  return module
}

const configured = {
  VERIDIA_EMAIL_FROM: "no-reply@veridia.test",
  VERIDIA_LEAD_PANEL_BASE_URL: "https://app.veridia.test",
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("outbox worker production readiness", () => {
  it("refuses in production without a sender address", async () => {
    const { isOutboxWorkerProductionReady } = await loadReadiness({
      NODE_ENV: "production",
      ...configured,
      VERIDIA_EMAIL_FROM: undefined,
    })

    expect(isOutboxWorkerProductionReady()).toBe(false)
  })

  it("refuses in production without a lead panel URL", async () => {
    const { isOutboxWorkerProductionReady } = await loadReadiness({
      NODE_ENV: "production",
      ...configured,
      VERIDIA_LEAD_PANEL_BASE_URL: undefined,
    })

    expect(isOutboxWorkerProductionReady()).toBe(false)
  })

  it("allows production once both are configured", async () => {
    const { isOutboxWorkerProductionReady, outboxWorkerConfig } =
      await loadReadiness({ NODE_ENV: "production", ...configured })

    expect(isOutboxWorkerProductionReady()).toBe(true)
    expect(outboxWorkerConfig.leadPanelBaseUrl).toBe("https://app.veridia.test")
  })

  // A build machine and a developer laptop legitimately have no runtime
  // secrets; only production may not run degraded.
  it("allows a degraded run outside production", async () => {
    const { isOutboxWorkerProductionReady } = await loadReadiness({
      NODE_ENV: "development",
      VERIDIA_EMAIL_FROM: undefined,
      VERIDIA_LEAD_PANEL_BASE_URL: undefined,
    })

    expect(isOutboxWorkerProductionReady()).toBe(true)
  })
})
