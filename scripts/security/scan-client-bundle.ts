/**
 * Deterministic client-bundle secret scanner.
 *
 * Replaces the previous `! rg "..."` shell gate, which passed vacuously when
 * ripgrep was not installed: a missing binary exits 127, and `!` turned that
 * failure into success. This scanner is Node-only and separates three outcomes:
 *
 *   SCANNER_UNAVAILABLE -> exit 2  (could not scan; never treat as clean)
 *   SECRET_FOUND        -> exit 1
 *   CLEAN               -> exit 0
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const BUNDLE_DIR = "apps/dashboard/.next/static"

/** Canary values injected by the build script, plus env var names that must never ship. */
const NEEDLES = [
  "veridia_service_role_bundle_canary",
  "veridia_encryption_key_canary_012",
  "turnstile_bundle_canary",
  "ip_risk_bundle_canary",
  "resend_bundle_canary",
  "worker_secret_bundle_canary",
  "VERIDIA_CREDENTIAL_ENCRYPTION_KEYS",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TURNSTILE_SECRET_KEY",
  "VERIDIA_IP_RISK_KEY",
  "RESEND_API_KEY",
  "VERIDIA_WORKER_SECRET",
]

/** Runtime secret values, when present, must not appear in the client bundle either. */
const RUNTIME_SECRET_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "VERIDIA_CREDENTIAL_ENCRYPTION_KEYS",
  "TURNSTILE_SECRET_KEY",
  "VERIDIA_IP_RISK_KEY",
  "RESEND_API_KEY",
  "VERIDIA_WORKER_SECRET",
]

function unavailable(reason: string): never {
  console.error(`SCANNER_UNAVAILABLE: ${reason}`)
  console.error("Bu bir GECIS degildir. Tarama yapilamadi.")
  process.exit(2)
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (error) {
    unavailable(
      `dizin okunamadi: ${dir} (${error instanceof Error ? error.message : String(error)})`,
    )
  }

  for (const entry of entries) {
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) {
      walk(full, acc)
    } else if (stats.isFile()) {
      acc.push(full)
    }
  }

  return acc
}

function main() {
  let stats
  try {
    stats = statSync(BUNDLE_DIR)
  } catch {
    unavailable(
      `build ciktisi yok: ${BUNDLE_DIR} (once 'npm run build' calistir)`,
    )
  }

  if (!stats.isDirectory()) {
    unavailable(`${BUNDLE_DIR} bir dizin degil`)
  }

  const files = walk(BUNDLE_DIR)

  if (files.length === 0) {
    unavailable(`${BUNDLE_DIR} bos - taranacak dosya yok`)
  }

  const needles = [...NEEDLES]
  for (const name of RUNTIME_SECRET_ENV) {
    const value = process.env[name]
    // Kisa degerler yanlis pozitif uretir; sadece anlamli uzunluktakiler aranir.
    if (value && value.length >= 12 && !needles.includes(value)) {
      needles.push(value)
    }
  }

  const findings: { file: string; needle: string }[] = []

  for (const file of files) {
    let contents: string
    try {
      contents = readFileSync(file, "utf8")
    } catch (error) {
      unavailable(
        `dosya okunamadi: ${file} (${error instanceof Error ? error.message : String(error)})`,
      )
    }

    for (const needle of needles) {
      if (contents.includes(needle)) {
        findings.push({ file: relative(process.cwd(), file), needle })
      }
    }
  }

  console.log(
    `client-bundle-scan: ${files.length} dosya tarandi, ${needles.length} desen arandi`,
  )

  if (findings.length > 0) {
    console.error("SECRET_FOUND: istemci paketinde gizli deger bulundu")
    for (const finding of findings) {
      // Eslesen degeri yazdirma; sadece hangi dosyada oldugunu bildir.
      const label = NEEDLES.includes(finding.needle)
        ? finding.needle
        : "<runtime secret value>"
      console.error(`  ${finding.file}  <- ${label}`)
    }
    process.exit(1)
  }

  console.log("CLEAN: sizinti yok")
  process.exit(0)
}

main()
