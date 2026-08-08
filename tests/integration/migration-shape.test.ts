import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260806123000_tenant_foundation.sql",
  ),
  "utf8",
)
const hardeningMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260806143000_tenant_foundation_hardening.sql",
  ),
  "utf8",
)
const leadMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260806160000_lead_model_credentials_hmac.sql",
  ),
  "utf8",
)
const ingestionMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260808023000_lead_ingestion_outbox.sql",
  ),
  "utf8",
)

describe("tenant foundation migration", () => {
  it("enables RLS on every tenant table", () => {
    for (const table of [
      "organizations",
      "organization_members",
      "sites",
      "site_domains",
      "audit_logs",
    ]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      )
    }
  })

  it("defines non-recursive security definer helpers for membership checks", () => {
    expect(`${migration}\n${hardeningMigration}`).toContain("security definer")
    expect(hardeningMigration).toContain("set search_path = pg_catalog, public")
    expect(hardeningMigration).toContain("public.is_org_member")
    expect(hardeningMigration).toContain("public.is_org_owner")
  })

  it("adds owner lock and active-domain lifecycle protections", () => {
    expect(hardeningMigration).toContain("prevent_last_owner_removal")
    expect(hardeningMigration).toContain(
      "status text not null default 'active'",
    )
    expect(hardeningMigration).toContain(
      "where status = 'active' and deleted_at is null",
    )
  })

  it("adds lead, credential, nonce, and idempotency tables with RLS", () => {
    for (const table of [
      "leads",
      "lead_attributions",
      "lead_status_history",
      "lead_notes",
      "site_credentials",
      "used_nonces",
      "idempotency_records",
    ]) {
      expect(leadMigration).toContain(`create table public.${table}`)
      expect(leadMigration).toContain(
        `alter table public.${table} enable row level security`,
      )
    }
  })

  it("keeps credential, nonce, and idempotency tables private to service operations", () => {
    expect(leadMigration).not.toMatch(
      /create policy .* on public\.(site_credentials|used_nonces|idempotency_records)/,
    )
    expect(leadMigration).toContain(
      "create unique index used_nonces_credential_nonce_hash_key",
    )
    expect(leadMigration).toContain(
      "create unique index idempotency_records_site_key_hash_key",
    )
    expect(leadMigration).toContain(
      "create unique index site_credentials_one_active_per_site_idx",
    )
  })

  it("adds lead ingestion outbox and telemetry tables without customer RLS exposure", () => {
    for (const table of [
      "outbox_events",
      "domain_events",
      "security_events",
      "lead_rate_limits",
    ]) {
      expect(ingestionMigration).toContain(`create table public.${table}`)
      expect(ingestionMigration).toContain(
        `alter table public.${table} enable row level security`,
      )
      expect(ingestionMigration).toContain(
        `revoke all on table public.${table} from anon, authenticated`,
      )
    }

    expect(ingestionMigration).toContain(
      "create or replace function public.complete_lead_ingestion",
    )
    expect(ingestionMigration).toContain(
      "create unique index outbox_events_job_key_key",
    )
    expect(ingestionMigration).toContain("actor_type text not null default")
  })
})
