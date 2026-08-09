import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"

import { SITE_KEY_PATTERN } from "./config"

/**
 * Public tracker key resolution.
 *
 * The key is embedded in customer pages, so it is public by definition and
 * carries no authority beyond naming a site. It is unpredictable only so that
 * sites cannot be enumerated, not because it is a secret.
 *
 * Tenancy comes from here and nowhere else. The request body never supplies an
 * organization or site id, so a caller cannot write into another tenant.
 */

export interface ResolvedSite {
  organizationId: string
  siteId: string
  allowedDomains: string[]
}

export type SiteResolution =
  | { ok: true; site: ResolvedSite }
  | { ok: false; reason: "malformed_key" | "unknown_key" }

export function isWellFormedSiteKey(value: unknown): value is string {
  return typeof value === "string" && SITE_KEY_PATTERN.test(value)
}

/**
 * Resolves a site key in a single round trip, including its allowed domains.
 *
 * Everything a batch needs is fetched once here; per-event lookups would turn a
 * 20 event batch into 20 identical queries.
 *
 * Unknown, revoked and inactive keys are deliberately indistinguishable in the
 * result, so a caller cannot probe which sites exist.
 */
export async function resolveSiteKey(
  client: SupabaseClient<Database>,
  siteKey: unknown,
): Promise<SiteResolution> {
  if (!isWellFormedSiteKey(siteKey)) {
    return { ok: false, reason: "malformed_key" }
  }

  const { data, error } = await client
    .from("site_tracker_keys")
    .select(
      "organization_id, site_id, status, sites!inner(id, status, site_domains(normalized_domain, status, deleted_at))",
    )
    .eq("public_key", siteKey)
    .eq("status", "active")
    .maybeSingle()

  if (error || !data) {
    return { ok: false, reason: "unknown_key" }
  }

  const site = data.sites as unknown as {
    id: string
    status: string
    site_domains: {
      normalized_domain: string
      status: string
      deleted_at: string | null
    }[]
  } | null

  // A paused or archived site stops collecting, and says no more about itself
  // than an unknown key does.
  if (!site || site.status !== "active") {
    return { ok: false, reason: "unknown_key" }
  }

  const allowedDomains = (site.site_domains ?? [])
    .filter(
      (domain) => domain.status === "active" && domain.deleted_at === null,
    )
    .map((domain) => domain.normalized_domain)

  return {
    ok: true,
    site: {
      organizationId: data.organization_id,
      siteId: data.site_id,
      allowedDomains,
    },
  }
}
