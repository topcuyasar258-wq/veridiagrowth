import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Regression guard over the built browser artifacts.
 *
 * The tracker runs in a page anyone can view source on. Anything bundled into
 * it is public, permanently. These assertions exist so that an innocent-looking
 * import cannot quietly pull a server module -- and with it a signing routine or
 * a secret name -- into a customer's page.
 *
 * The artifacts are produced by `npm run tracker:build`, which CI runs before
 * the test suite.
 */

const DIST = "packages/tracker/dist"
const TRACKER = join(DIST, "tracker-v0.1.0.js")
const LOADER = join(DIST, "loader.js")

function artifacts(): { name: string; source: string }[] {
  return [TRACKER, LOADER]
    .filter((file) => existsSync(file))
    .map((file) => ({ name: file, source: readFileSync(file, "utf8") }))
}

describe("tracker bundle security", () => {
  it("has been built", () => {
    // A missing artifact must fail rather than silently skip every assertion
    // below -- the same vacuous-pass shape this repo has been bitten by before.
    expect(existsSync(TRACKER)).toBe(true)
    expect(existsSync(LOADER)).toBe(true)
  })

  it("contains no Phase 1 signing logic", () => {
    // A browser can never sign a Lead API request: the secret would be public.
    for (const { name, source } of artifacts()) {
      for (const marker of [
        "X-Veridia-Signature",
        "X-Veridia-Key-Id",
        "X-Veridia-Nonce",
        "signLeadRequest",
        "createHmac",
        "Idempotency-Key",
      ]) {
        expect(source, `${marker} found in ${name}`).not.toContain(marker)
      }
    }
  })

  it("contains no secret environment variable names", () => {
    for (const { name, source } of artifacts()) {
      for (const marker of [
        "SUPABASE_SERVICE_ROLE_KEY",
        "VERIDIA_CREDENTIAL_ENCRYPTION_KEYS",
        "VERIDIA_WORKER_SECRET",
        "VERIDIA_IP_RISK_KEY",
        "VERIDIA_EVENT_IP_RISK_KEY",
        "TURNSTILE_SECRET_KEY",
        "RESEND_API_KEY",
      ]) {
        expect(source, `${marker} found in ${name}`).not.toContain(marker)
      }
    }
  })

  it("bundles no server or framework dependency", () => {
    for (const { name, source } of artifacts()) {
      for (const marker of [
        "@supabase/supabase-js",
        "createClient",
        "next/server",
        "react",
        "zod",
      ]) {
        expect(source, `${marker} found in ${name}`).not.toContain(marker)
      }
    }
  })

  it("never calls preventDefault", () => {
    // The property the whole fail-open contract rests on: a tracked click must
    // always still navigate.
    const tracker = readFileSync(TRACKER, "utf8")
    expect(tracker).not.toContain("preventDefault")
  })

  it("uses no Math.random for identifiers", () => {
    // Predictable ids would let anyone forge or collide another visitor's
    // session.
    const tracker = readFileSync(TRACKER, "utf8")
    expect(tracker).not.toContain("Math.random")
  })

  it("stays inside its gzip budget", () => {
    const reportFile = join(DIST, "bundle-report.json")
    expect(existsSync(reportFile)).toBe(true)

    const report = JSON.parse(readFileSync(reportFile, "utf8")) as {
      name: string
      gzipBytes: number
      budget: number
    }[]

    expect(report.length).toBe(2)
    for (const artifact of report) {
      expect(
        artifact.gzipBytes,
        `${artifact.name} over budget`,
      ).toBeLessThanOrEqual(artifact.budget)
    }
  })
})
