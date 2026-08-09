/**
 * Tracker build and bundle budget gate.
 *
 * Produces two artifacts and fails when either exceeds its gzip budget. The
 * budget is enforced in CI rather than reviewed by eye, because bundle growth
 * is incremental: no single change looks expensive, and the page a customer's
 * visitors download gets slower one dependency at a time.
 */
import { gzipSync } from "node:zlib"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { build } from "esbuild"

const OUT_DIR = "packages/tracker/dist"
const TRACKER_VERSION = "0.1.0"

/** Gzip because that is what the browser actually downloads. */
const BUDGETS = {
  loader: 5 * 1024,
  tracker: 25 * 1024,
} as const

interface Artifact {
  name: keyof typeof BUDGETS
  file: string
  rawBytes: number
  gzipBytes: number
  budget: number
}

async function bundle(entry: string, outfile: string, globalName?: string) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    minify: true,
    format: "iife",
    globalName,
    platform: "browser",
    target: ["es2020"],
    legalComments: "none",
    // No sourcemap in the published artifact: it would expose the full source
    // to anyone viewing a customer page.
    sourcemap: false,
  })
}

function measure(name: keyof typeof BUDGETS, file: string): Artifact {
  const contents = readFileSync(file)

  return {
    name,
    file,
    rawBytes: contents.byteLength,
    gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
    budget: BUDGETS[name],
  }
}

function format(bytes: number) {
  return `${(bytes / 1024).toFixed(2)} KB`
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  const trackerFile = join(OUT_DIR, `tracker-v${TRACKER_VERSION}.js`)
  const loaderFile = join(OUT_DIR, "loader.js")

  await bundle("packages/tracker/src/index.ts", trackerFile, "VeridiaTracker")
  await bundle("packages/tracker/loader/loader.ts", loaderFile)

  // esbuild's IIFE global assigns the module namespace, so `init` would sit on
  // `.default`. The loader expects to call `VeridiaTracker.init` directly.
  const trackerSource = readFileSync(trackerFile, "utf8")
  writeFileSync(
    trackerFile,
    `${trackerSource}\nwindow.VeridiaTracker=VeridiaTracker.VeridiaTracker||VeridiaTracker.default||VeridiaTracker;\n`,
  )

  const artifacts = [
    measure("tracker", trackerFile),
    measure("loader", loaderFile),
  ]

  let failed = false

  for (const artifact of artifacts) {
    const over = artifact.gzipBytes > artifact.budget
    if (over) failed = true

    console.log(
      `${over ? "OVER  " : "OK    "} ${artifact.name.padEnd(8)} ` +
        `raw=${format(artifact.rawBytes).padStart(9)} ` +
        `gzip=${format(artifact.gzipBytes).padStart(9)} ` +
        `budget=${format(artifact.budget)}`,
    )
  }

  writeFileSync(
    join(OUT_DIR, "bundle-report.json"),
    `${JSON.stringify(artifacts, null, 2)}\n`,
  )

  if (failed) {
    console.error("BUNDLE_BUDGET_EXCEEDED")
    process.exit(1)
  }

  console.log("bundle budgets ok")
}

void main().catch((error: unknown) => {
  console.error(
    "tracker build failed:",
    error instanceof Error ? error.message : error,
  )
  process.exit(1)
})
