import type { NextConfig } from "next"

/**
 * Cache policy for the tracker artifacts under /t.
 *
 * The two files are cached very differently on purpose, and the rollback story
 * depends on it:
 *
 *   tracker-v*.js  carries its version in the filename, so its contents can
 *                  never change. Cached for a year and marked immutable, which
 *                  means repeat visitors fetch it zero times.
 *
 *   loader.js      is the indirection that decides which version to load. It
 *                  must be short-lived, because `rollback_tracker_release`
 *                  reaches customer pages only as fast as this expires. Five
 *                  minutes matches the tracker config cache TTL documented in
 *                  docs/tracker-rollout.md, so both propagate together.
 *
 * A long cache here would mean a rolled-back release kept running on customer
 * sites for as long as the browser held the old loader -- the failure the
 * rollback procedure exists to prevent.
 */
const nextConfig: NextConfig = {
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/t/:file(tracker-v[0-9.]+\\.js)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        source: "/t/loader.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=300, must-revalidate",
          },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ]
  },
}

export default nextConfig
