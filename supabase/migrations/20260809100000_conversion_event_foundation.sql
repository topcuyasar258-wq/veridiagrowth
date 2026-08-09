-- Phase 2A / Slice 1: anonymous interaction event foundation.
--
-- TERMINOLOGY CONTRACT (see docs/interaction-events.md):
--   Interaction  = anonymous browser signal (session_started, whatsapp_clicked,
--                  phone_clicked, form_started). Never cryptographically verified.
--   Verified Lead = public.leads, created by the Phase 1 HMAC-signed API.
-- These are distinct concepts. An interaction is never a lead.
--
-- PII BOUNDARY: none of the tables in this migration may store names, email,
-- phone, message bodies, form values, full URLs with query strings, or raw IP.
-- Page context is reduced to host + path. Attribution is limited to the five
-- UTM fields plus a referrer host. Enforcement lives in the collector
-- (@veridia/shared events contract) and in the CHECK constraints below.

-- ---------------------------------------------------------------------------
-- Public tracker site keys
-- ---------------------------------------------------------------------------
-- The tracker is embedded in customer pages, so its identifier is PUBLIC and is
-- never a secret. It resolves to site + organization + allowed origins. It is a
-- separate table from public.site_credentials on purpose: site_credentials holds
-- the Phase 1 HMAC signing secret, which must never reach a browser. Keeping the
-- two apart makes it structurally impossible to hand out the wrong one.

create table public.site_tracker_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  public_key text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  rotated_at timestamptz null,
  revoked_at timestamptz null,
  constraint site_tracker_keys_status_check check (
    status in ('active', 'inactive', 'revoked')
  ),
  constraint site_tracker_keys_public_key_format_check check (
    public_key ~ '^vtk_[a-z0-9]{32}$'
  ),
  constraint site_tracker_keys_revoked_at_check check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

create unique index site_tracker_keys_public_key_key
  on public.site_tracker_keys (public_key);

-- A site has at most one active tracker key; rotation deactivates the old row.
create unique index site_tracker_keys_active_site_key
  on public.site_tracker_keys (site_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Tracker releases and per-site deployments
-- ---------------------------------------------------------------------------

create table public.tracker_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  status text not null default 'draft',
  notes_safe text null,
  created_at timestamptz not null default now(),
  released_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint tracker_releases_status_check check (
    status in ('draft', 'canary', 'active', 'deprecated', 'rolled_back')
  ),
  -- Immutable published artifact: vX.Y.Z, never reused for different bytes.
  constraint tracker_releases_version_format_check check (
    version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  ),
  constraint tracker_releases_released_at_check check (
    status = 'draft' or released_at is not null
  ),
  constraint tracker_releases_notes_size_check check (
    notes_safe is null or length(notes_safe) <= 500
  )
);

create unique index tracker_releases_version_key
  on public.tracker_releases (version);

-- Exactly one release may be active at a time; rollback flips this pointer.
create unique index tracker_releases_single_active_key
  on public.tracker_releases ((status))
  where status = 'active';

create table public.site_tracker_deployments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  tracker_release_id uuid null references public.tracker_releases(id) on delete restrict,
  integration_version text null,
  pinned boolean not null default false,
  last_seen_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_tracker_deployments_integration_version_check check (
    integration_version is null
    or integration_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  ),
  -- A pinned site must name the release it is pinned to.
  constraint site_tracker_deployments_pinned_requires_release_check check (
    pinned = false or tracker_release_id is not null
  )
);

create unique index site_tracker_deployments_site_key
  on public.site_tracker_deployments (site_id);

-- ---------------------------------------------------------------------------
-- conversion_events
-- ---------------------------------------------------------------------------
-- One row per accepted or suspicious anonymous interaction.
--
-- event_id uniqueness is scoped to the site rather than global. Global
-- uniqueness would let any site burn another site's identifier space by
-- replaying guessed ids, which is a cross-tenant denial of service. Per-site
-- uniqueness gives the same idempotency guarantee without that vector.

create table public.conversion_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,

  session_id text not null,
  event_type text not null,

  -- Sanitized page context. Query strings are dropped by the collector; only
  -- the five UTM parameters survive, in their own columns below.
  page_host text null,
  page_path text null,
  referrer_host text null,

  source_category text not null default 'unknown',
  utm_source text null,
  utm_medium text null,
  utm_campaign text null,
  utm_term text null,
  utm_content text null,

  tracker_version text null,
  integration_version text null,

  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),

  risk_status text not null default 'accepted',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),

  -- The browser may never assert a lead. lead_created stays a Phase 1
  -- backend/domain event and is structurally impossible here.
  constraint conversion_events_event_type_check check (
    event_type in (
      'session_started',
      'whatsapp_clicked',
      'phone_clicked',
      'form_started'
    )
  ),
  constraint conversion_events_source_category_check check (
    source_category in (
      'organic',
      'paid_search',
      'paid_social',
      'referral',
      'direct',
      'unknown'
    )
  ),
  constraint conversion_events_risk_status_check check (
    risk_status in ('accepted', 'suspicious')
  ),
  constraint conversion_events_event_id_format_check check (
    event_id ~ '^[A-Za-z0-9_-]{16,64}$'
  ),
  constraint conversion_events_session_id_format_check check (
    session_id ~ '^[A-Za-z0-9_-]{16,64}$'
  ),
  -- Bounded, so a caller cannot smuggle a payload through a context field.
  constraint conversion_events_page_host_size_check check (
    page_host is null or length(page_host) <= 253
  ),
  constraint conversion_events_page_path_size_check check (
    page_path is null or (length(page_path) <= 512 and page_path !~ '[?#]')
  ),
  constraint conversion_events_referrer_host_size_check check (
    referrer_host is null or length(referrer_host) <= 253
  ),
  constraint conversion_events_utm_size_check check (
    coalesce(length(utm_source), 0) <= 128
    and coalesce(length(utm_medium), 0) <= 128
    and coalesce(length(utm_campaign), 0) <= 128
    and coalesce(length(utm_term), 0) <= 128
    and coalesce(length(utm_content), 0) <= 128
  ),
  constraint conversion_events_tracker_version_check check (
    tracker_version is null or tracker_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  ),
  constraint conversion_events_integration_version_check check (
    integration_version is null
    or integration_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  ),
  constraint conversion_events_expires_after_received_check check (
    expires_at > received_at
  )
);

create unique index conversion_events_site_event_id_key
  on public.conversion_events (site_id, event_id);

create index conversion_events_site_occurred_at_idx
  on public.conversion_events (site_id, occurred_at desc);

create index conversion_events_organization_occurred_at_idx
  on public.conversion_events (organization_id, occurred_at desc);

create index conversion_events_site_type_occurred_at_idx
  on public.conversion_events (site_id, event_type, occurred_at desc);

create index conversion_events_session_idx
  on public.conversion_events (site_id, session_id, occurred_at desc);

-- Retention sweep support (accepted 90 days, suspicious 30 days).
create index conversion_events_expires_at_idx
  on public.conversion_events (expires_at);

-- ---------------------------------------------------------------------------
-- event_risk_assessments
-- ---------------------------------------------------------------------------
-- Signals are stored as an enumerated code array rather than free-form JSON so
-- that no caller-controlled text can reach storage.

create table public.event_risk_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  conversion_event_id uuid null references public.conversion_events(id) on delete cascade,
  event_id text not null,
  risk_score integer not null,
  risk_status text not null,
  signal_codes text[] not null default '{}',
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint event_risk_assessments_score_range_check check (
    risk_score between 0 and 100
  ),
  constraint event_risk_assessments_status_check check (
    risk_status in ('accepted', 'suspicious', 'quarantined', 'rejected')
  ),
  -- Score band and recorded status must agree; see docs/risk-model.md.
  constraint event_risk_assessments_band_check check (
    (risk_score < 30 and risk_status = 'accepted')
    or (risk_score >= 30 and risk_score < 60 and risk_status = 'suspicious')
    or (risk_score >= 60 and risk_score < 80 and risk_status = 'quarantined')
    or (risk_score >= 80 and risk_status = 'rejected')
  ),
  constraint event_risk_assessments_signal_codes_check check (
    array_length(signal_codes, 1) is null
    or array_length(signal_codes, 1) <= 16
  )
);

create index event_risk_assessments_site_assessed_at_idx
  on public.event_risk_assessments (site_id, assessed_at desc);

create index event_risk_assessments_event_idx
  on public.event_risk_assessments (site_id, event_id);

-- ---------------------------------------------------------------------------
-- quarantined_events
-- ---------------------------------------------------------------------------
-- Suspicious traffic is held, not deleted. Customers will only ever see an
-- aggregate count ("filtered suspicious traffic: X"); the technical reason is
-- internal.

create table public.quarantined_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  event_id text not null,
  event_type text not null,
  session_id text null,
  risk_score integer not null,
  reason_code text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  quarantined_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint quarantined_events_event_type_check check (
    event_type in (
      'session_started',
      'whatsapp_clicked',
      'phone_clicked',
      'form_started'
    )
  ),
  constraint quarantined_events_score_range_check check (
    risk_score between 0 and 100
  ),
  -- Enumerated reasons only: never a free-form message.
  constraint quarantined_events_reason_code_check check (
    reason_code in (
      'origin_mismatch',
      'referer_mismatch',
      'unknown_site_key',
      'duplicate_event_id',
      'session_burst',
      'ip_burst',
      'site_burst',
      'abnormal_sequence',
      'unrealistic_event_rate',
      'user_agent_anomaly',
      'schema_violation'
    )
  ),
  constraint quarantined_events_expires_after_received_check check (
    expires_at > received_at
  )
);

create unique index quarantined_events_site_event_id_key
  on public.quarantined_events (site_id, event_id);

create index quarantined_events_site_quarantined_at_idx
  on public.quarantined_events (site_id, quarantined_at desc);

create index quarantined_events_expires_at_idx
  on public.quarantined_events (expires_at);

-- ---------------------------------------------------------------------------
-- event_quotas
-- ---------------------------------------------------------------------------
-- Fixed-window counters. scope_key is already hashed by the caller for the
-- ip scope; raw IP never reaches this table.

create table public.event_quotas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  scope text not null,
  scope_key text not null,
  window_started_at timestamptz not null,
  window_seconds integer not null,
  event_count integer not null default 0,
  limit_value integer not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint event_quotas_scope_check check (
    scope in ('site', 'site_ip', 'session', 'event_type')
  ),
  constraint event_quotas_window_seconds_check check (window_seconds > 0),
  constraint event_quotas_event_count_check check (event_count >= 0),
  constraint event_quotas_limit_value_check check (limit_value > 0),
  constraint event_quotas_scope_key_size_check check (
    length(scope_key) between 1 and 128
  )
);

create unique index event_quotas_window_key
  on public.event_quotas (site_id, scope, scope_key, window_started_at);

create index event_quotas_window_started_at_idx
  on public.event_quotas (window_started_at);

-- ---------------------------------------------------------------------------
-- event_anomalies
-- ---------------------------------------------------------------------------
-- Safe aggregate metrics only. No per-visitor detail, no PII.

create table public.event_anomalies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  anomaly_type text not null,
  severity text not null,
  window_started_at timestamptz not null,
  window_ended_at timestamptz not null,
  observed_count integer not null,
  baseline_count integer null,
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint event_anomalies_type_check check (
    anomaly_type in (
      'volume_burst',
      'duplicate_flood',
      'origin_mismatch_spike',
      'quarantine_spike'
    )
  ),
  constraint event_anomalies_severity_check check (
    severity in ('low', 'medium', 'high')
  ),
  constraint event_anomalies_observed_count_check check (observed_count >= 0),
  constraint event_anomalies_baseline_count_check check (
    baseline_count is null or baseline_count >= 0
  ),
  constraint event_anomalies_window_order_check check (
    window_ended_at > window_started_at
  )
);

create index event_anomalies_site_detected_at_idx
  on public.event_anomalies (site_id, detected_at desc);

-- ---------------------------------------------------------------------------
-- Retention defaults
-- ---------------------------------------------------------------------------

create or replace function public.conversion_event_retention_days(
  target_risk_status text
)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case when target_risk_status = 'accepted' then 90 else 30 end;
$$;

create or replace function public.set_conversion_event_expiry()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.expires_at is null then
    new.expires_at :=
      new.received_at
      + make_interval(
          days => public.conversion_event_retention_days(new.risk_status)
        );
  end if;

  return new;
end;
$$;

create trigger conversion_events_set_expiry
  before insert on public.conversion_events
  for each row
  execute function public.set_conversion_event_expiry();

create or replace function public.set_quarantined_event_expiry()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.expires_at is null then
    new.expires_at := new.received_at + interval '30 days';
  end if;

  return new;
end;
$$;

create trigger quarantined_events_set_expiry
  before insert on public.quarantined_events
  for each row
  execute function public.set_quarantined_event_expiry();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- Requirement 29: customers must not read raw event, risk, quarantine, anomaly
-- or quota rows. Phase 2B will expose safe aggregates through SECURITY DEFINER
-- RPCs. Until then every table here is service-role only, and RLS is enabled so
-- that a future accidental grant still cannot bypass tenancy.

alter table public.site_tracker_keys enable row level security;
alter table public.tracker_releases enable row level security;
alter table public.site_tracker_deployments enable row level security;
alter table public.conversion_events enable row level security;
alter table public.event_risk_assessments enable row level security;
alter table public.quarantined_events enable row level security;
alter table public.event_quotas enable row level security;
alter table public.event_anomalies enable row level security;

revoke all on table public.site_tracker_keys from anon, authenticated;
revoke all on table public.tracker_releases from anon, authenticated;
revoke all on table public.site_tracker_deployments from anon, authenticated;
revoke all on table public.conversion_events from anon, authenticated;
revoke all on table public.event_risk_assessments from anon, authenticated;
revoke all on table public.quarantined_events from anon, authenticated;
revoke all on table public.event_quotas from anon, authenticated;
revoke all on table public.event_anomalies from anon, authenticated;

grant all on
  public.site_tracker_keys,
  public.tracker_releases,
  public.site_tracker_deployments,
  public.conversion_events,
  public.event_risk_assessments,
  public.quarantined_events,
  public.event_quotas,
  public.event_anomalies
to service_role;

-- Tenant-scoped service-role policies. service_role bypasses RLS, but the
-- policies are declared so the tables are never left policy-less if a role is
-- granted access later by mistake.
create policy "service role manages site tracker keys"
  on public.site_tracker_keys
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role manages tracker releases"
  on public.tracker_releases
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role manages site tracker deployments"
  on public.site_tracker_deployments
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role manages conversion events"
  on public.conversion_events
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role manages event risk assessments"
  on public.event_risk_assessments
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role manages quarantined events"
  on public.quarantined_events
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role manages event quotas"
  on public.event_quotas
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role manages event anomalies"
  on public.event_anomalies
  for all
  to service_role
  using (true)
  with check (true);

revoke all on function public.conversion_event_retention_days(text) from public;
grant execute on function public.conversion_event_retention_days(text) to service_role;
