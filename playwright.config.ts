import { defineConfig, devices } from "@playwright/test"

/**
 * Real-browser acceptance for the tracker.
 *
 * Separate from the vitest suite: these tests need a browser and a real HTTP
 * server, and they assert on bytes that actually crossed a network boundary.
 * The fixture server is started per test file rather than by `webServer`,
 * because each file needs to control collector behaviour directly.
 */
export default defineConfig({
  testDir: "tests/browser",
  testMatch: /.*\.spec\.ts$/,
  // No external network is involved, so a short timeout catches a hang rather
  // than waiting on something that will never arrive.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"]] : [["list"]],
  use: {
    // Everything is served from the local fixture; nothing reaches the internet.
    offline: false,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
