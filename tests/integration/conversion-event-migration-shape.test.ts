import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Static guard over the Phase 2A foundation migration.
 *
 * pgTAP is the authoritative gate and runs in CI against real PostgreSQL. This
 * suite catches the classes of mistake that are cheap to detect without a
 * database -- a missing RLS enable, a stray grant to a customer role, a PII
 * column reintroduced by hand -- so they fail in seconds rather than after a
 * full CI cycle.
 */
const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260809100000_conversion_event_foundation.sql",
  ),
  "utf8",
)

const PHASE_2_TABLES = [
  "conversion_events",
  "event_risk_assessments",
  "quarantined_events",
  "event_quotas",
  "event_anomalies",
  "tracker_releases",
  "site_tracker_deployments",
  "site_tracker_keys",
]

describe("conversion event foundation migration", () => {
  it("creates every Phase 2A table", () => {
    for (const table of PHASE_2_TABLES) {
      expect(migration).toContain(`create table public.${table} (`)
    }
  })

  it("enables RLS on every Phase 2A table", () => {
    for (const table of PHASE_2_TABLES) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security;`,
      )
    }
  })

  it("revokes customer-role access from every Phase 2A table", () => {
    for (const table of PHASE_2_TABLES) {
      expect(migration).toContain(
        `revoke all on table public.${table} from anon, authenticated;`,
      )
    }
  })

  it("never grants a Phase 2A table to anon or authenticated", () => {
    // Requirement 29: customers reach this data only through Phase 2B
    // aggregation RPCs, never directly.
    const grantLines = migration
      .split("\n")
      .filter((line) => /^\s*grant\b/.test(line))
      .join("\n")

    expect(grantLines).not.toMatch(/\banon\b/)
    expect(grantLines).not.toMatch(/\bauthenticated\b/)
  })

  it("restricts conversion events to the four public interaction types", () => {
    const check = migration.match(
      /constraint conversion_events_event_type_check check \(([\s\S]*?)\)\s*\),/,
    )?.[1]

    expect(check).toBeDefined()
    for (const type of [
      "session_started",
      "whatsapp_clicked",
      "phone_clicked",
      "form_started",
    ]) {
      expect(check).toContain(`'${type}'`)
    }
    expect(check).not.toContain("lead_created")
    expect(check).not.toContain("purchase")
  })

  it("declares no PII columns", () => {
    for (const column of [
      "first_name",
      "last_name",
      "email",
      "phone",
      "message",
      "ip_address",
      "raw_ip",
      "user_agent",
    ]) {
      expect(migration).not.toMatch(new RegExp(`^\\s+${column}\\s`, "m"))
    }
  })

  it("declares no arbitrary jsonb payload column", () => {
    // Risk signals are an enumerated text[]; free-form JSON is how PII leaks in.
    expect(migration).not.toMatch(/^\s+\w*payload\w*\s+jsonb/m)
    expect(migration).not.toMatch(/^\s+metadata\s+jsonb/m)
  })

  it("scopes event id uniqueness per site rather than globally", () => {
    expect(migration).toContain(
      "create unique index conversion_events_site_event_id_key\n  on public.conversion_events (site_id, event_id);",
    )
  })

  it("keeps the public tracker key separate from the HMAC credential table", () => {
    expect(migration).toContain("create table public.site_tracker_keys (")
    expect(migration).not.toMatch(/site_tracker_keys[\s\S]*?encrypted_secret/)
    expect(migration).not.toMatch(/alter table public\.site_credentials/)
  })

  it("sets retention to 90 days accepted and 30 days otherwise", () => {
    expect(migration).toContain(
      "select case when target_risk_status = 'accepted' then 90 else 30 end;",
    )
    expect(migration).toContain("new.received_at + interval '30 days'")
  })

  it("allows only one active tracker release at a time", () => {
    expect(migration).toContain("tracker_releases_single_active_key")
  })

  it("uses safe search paths on every function it defines", () => {
    const functions =
      migration.match(/create or replace function[\s\S]*?\$\$;/g) ?? []
    expect(functions.length).toBeGreaterThan(0)

    for (const fn of functions) {
      expect(fn).toContain("set search_path = pg_catalog, public")
    }
  })
})
