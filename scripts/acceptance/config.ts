export type AcceptanceEnv = {
  VERIDIA_ENV: string
  NEXT_PUBLIC_SUPABASE_URL: string
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  VERIDIA_CREDENTIAL_ENCRYPTION_KEYS: string
  VERIDIA_CREDENTIAL_ENCRYPTION_KEY_VERSION: string
  TURNSTILE_SECRET_KEY: string
  VERIDIA_IP_RISK_KEY: string
  VERIDIA_WORKER_SECRET: string
  VERIDIA_ACCEPTANCE_APP_URL: string
  VERIDIA_ACCEPTANCE_RECIPIENT_EMAIL: string
  ACCEPTANCE_USER_PASSWORD: string
  ACCEPTANCE_TURNSTILE_SUCCESS_TOKEN: string
  ACCEPTANCE_TURNSTILE_FAILURE_TOKEN: string
  ACCEPTANCE_TURNSTILE_MODE: TurnstileMode
  VERIDIA_PRODUCTION_SUPABASE_URL?: string
}

/**
 * Turnstile sonucunu neyin belirledigi.
 *
 * - `real`: gercek Turnstile konfigurasyonu. Sonuc token'dan gelir, yani ayni
 *   calistirma icinde hem basarili hem basarisiz token gonderilebilir.
 * - `test_keys`: Cloudflare'in resmi test anahtarlari. Sonucu SECRET belirler
 *   (`1x...AA` her zaman gecer, `2x...AA` her zaman reddeder); token'in bir
 *   etkisi yoktur. Bu modda red senaryosu ayni kosuda test EDILEMEZ, cunku
 *   secret uygulamanin ortaminda sabittir. Red senaryosu icin uygulama
 *   `2x...AA` ile ayaga kaldirilip `turnstile-reject` komutu calistirilir.
 */
export type TurnstileMode = "real" | "test_keys"

export const TURNSTILE_TEST_SECRET_ALWAYS_PASSES =
  "1x0000000000000000000000000000000AA"
export const TURNSTILE_TEST_SECRET_ALWAYS_FAILS =
  "2x0000000000000000000000000000000AA"

export type Fixture = {
  ownerId: string
  agentId: string
  viewerId: string
  orgBUserId: string
  organizationId: string
  orgBId: string
  siteId: string
  keyId?: string
  secret?: string
}

/**
 * Cleanup yalnizca bu on eklere sahip kayitlara dokunabilir.
 * Silme yolundaki her kayit calisma aninda bu on eklere karsi dogrulanir;
 * boylece bir fixture sabiti yanlislikla degistirilse bile gercek musteri
 * verisi silinemez.
 */
export const ACCEPTANCE_ORG_SLUG_PREFIX = "acceptance-"
export const ACCEPTANCE_EMAIL_PREFIX = "acceptance."

export const fixture = {
  orgSlug: "acceptance-veridia-demo-business",
  orgName: "Veridia Acceptance Demo",
  orgBSlug: "acceptance-veridia-demo-other-business",
  orgBName: "Veridia Acceptance Demo Other",
  siteName: "Acceptance Demo Website",
  ownerEmail: "acceptance.owner@example.com",
  agentEmail: "acceptance.agent@example.com",
  viewerEmail: "acceptance.viewer@example.com",
  orgBEmail: "acceptance.orgb.owner@example.com",
}

export function readEnv(): AcceptanceEnv {
  const required = [
    "VERIDIA_ENV",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VERIDIA_CREDENTIAL_ENCRYPTION_KEYS",
    "VERIDIA_CREDENTIAL_ENCRYPTION_KEY_VERSION",
    "TURNSTILE_SECRET_KEY",
    "VERIDIA_IP_RISK_KEY",
    "VERIDIA_WORKER_SECRET",
    "VERIDIA_ACCEPTANCE_APP_URL",
    "VERIDIA_ACCEPTANCE_RECIPIENT_EMAIL",
    "ACCEPTANCE_USER_PASSWORD",
    "ACCEPTANCE_TURNSTILE_SUCCESS_TOKEN",
    "ACCEPTANCE_TURNSTILE_FAILURE_TOKEN",
  ] as const
  const missing = required.filter((key) => !process.env[key])

  if (missing.length > 0) {
    throw new Error(`Missing acceptance environment: ${missing.join(", ")}`)
  }

  const rawMode = process.env.ACCEPTANCE_TURNSTILE_MODE ?? "real"
  if (rawMode !== "real" && rawMode !== "test_keys") {
    throw new Error(
      `ACCEPTANCE_TURNSTILE_MODE must be "real" or "test_keys", got "${rawMode}".`,
    )
  }

  return {
    ACCEPTANCE_TURNSTILE_MODE: rawMode,
    VERIDIA_ENV: process.env.VERIDIA_ENV ?? "",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    VERIDIA_CREDENTIAL_ENCRYPTION_KEYS:
      process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEYS ?? "",
    VERIDIA_CREDENTIAL_ENCRYPTION_KEY_VERSION:
      process.env.VERIDIA_CREDENTIAL_ENCRYPTION_KEY_VERSION ?? "",
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? "",
    VERIDIA_IP_RISK_KEY: process.env.VERIDIA_IP_RISK_KEY ?? "",
    VERIDIA_WORKER_SECRET: process.env.VERIDIA_WORKER_SECRET ?? "",
    VERIDIA_ACCEPTANCE_APP_URL: process.env.VERIDIA_ACCEPTANCE_APP_URL ?? "",
    VERIDIA_ACCEPTANCE_RECIPIENT_EMAIL:
      process.env.VERIDIA_ACCEPTANCE_RECIPIENT_EMAIL ?? "",
    ACCEPTANCE_USER_PASSWORD: process.env.ACCEPTANCE_USER_PASSWORD ?? "",
    ACCEPTANCE_TURNSTILE_SUCCESS_TOKEN:
      process.env.ACCEPTANCE_TURNSTILE_SUCCESS_TOKEN ?? "",
    ACCEPTANCE_TURNSTILE_FAILURE_TOKEN:
      process.env.ACCEPTANCE_TURNSTILE_FAILURE_TOKEN ?? "",
    VERIDIA_PRODUCTION_SUPABASE_URL:
      process.env.VERIDIA_PRODUCTION_SUPABASE_URL,
  }
}

export function guardEnvironment(env: AcceptanceEnv) {
  if (env.VERIDIA_ENV !== "staging" && env.VERIDIA_ENV !== "acceptance") {
    throw new Error("Refusing to run unless VERIDIA_ENV=staging or acceptance.")
  }

  if (
    env.NEXT_PUBLIC_SUPABASE_URL.includes("example.supabase.co") ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("localhost") ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1")
  ) {
    throw new Error(
      "Refusing to run against placeholder or local Supabase URL.",
    )
  }

  if (
    env.VERIDIA_PRODUCTION_SUPABASE_URL &&
    env.NEXT_PUBLIC_SUPABASE_URL === env.VERIDIA_PRODUCTION_SUPABASE_URL
  ) {
    throw new Error("Refusing to run against production Supabase URL.")
  }

  if (
    !env.VERIDIA_ACCEPTANCE_RECIPIENT_EMAIL.startsWith("acceptance.") &&
    !env.VERIDIA_ACCEPTANCE_RECIPIENT_EMAIL.includes("+acceptance")
  ) {
    throw new Error(
      "Refusing to send acceptance email to a non-acceptance recipient.",
    )
  }

  const isTestSecret =
    env.TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET_ALWAYS_PASSES ||
    env.TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET_ALWAYS_FAILS

  if (env.ACCEPTANCE_TURNSTILE_MODE === "test_keys" && !isTestSecret) {
    throw new Error(
      "ACCEPTANCE_TURNSTILE_MODE=test_keys requires TURNSTILE_SECRET_KEY to be a Cloudflare test secret.",
    )
  }

  if (env.ACCEPTANCE_TURNSTILE_MODE === "real" && isTestSecret) {
    throw new Error(
      "ACCEPTANCE_TURNSTILE_MODE=real but TURNSTILE_SECRET_KEY is a Cloudflare test secret. " +
        "Test secrets ignore the token, so token-driven failure assertions would silently pass.",
    )
  }
}

/** Test-key modunda uygulamanin hangi sonucu uretecegi secret'tan okunur. */
export function turnstileOutcomeFromSecret(
  secret: string,
): "always_passes" | "always_fails" | "token_driven" {
  if (secret === TURNSTILE_TEST_SECRET_ALWAYS_PASSES) return "always_passes"
  if (secret === TURNSTILE_TEST_SECRET_ALWAYS_FAILS) return "always_fails"
  return "token_driven"
}
