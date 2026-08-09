import { defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    env: {
      // Synthetic, and never a real key. Set here so the suite exercises the
      // collector's full four-scope quota path rather than the degraded
      // three-scope path that applies when no IP key is configured.
      VERIDIA_EVENT_IP_RISK_KEY: "test_event_ip_risk_key_0123456789",
    },
    coverage: {
      provider: "v8",
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
})
