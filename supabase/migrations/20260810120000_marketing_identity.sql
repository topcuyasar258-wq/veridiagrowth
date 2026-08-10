-- ---------------------------------------------------------------------------
-- Marketing identity: persistent visitor id and advertising click ids
-- ---------------------------------------------------------------------------
-- These are the first fields in conversion_events that can outlive a single
-- visit, so they are also the first that could build a profile. Two boundaries
-- keep that bounded, and both live outside this file:
--
--   * the visitor id is minted per site in origin-scoped browser storage, so it
--     cannot be read on another customer's site (packages/tracker/src/visitor.ts)
--   * neither field is ever sent without marketing consent, which is a separate
--     switch from analytics consent (packages/tracker/src/index.ts)
--
-- Every column is nullable and null is the ordinary case: a visitor who has not
-- consented produces rows identical to those written before this migration.
--
-- See docs/tracker-privacy-boundaries.md.

alter table public.conversion_events
  add column if not exists visitor_id text null,
  add column if not exists gclid text null,
  add column if not exists gbraid text null,
  add column if not exists wbraid text null,
  add column if not exists fbclid text null;

-- Same shape as session_id and event_id: random, bounded, no separators that
-- could smuggle structure.
alter table public.conversion_events
  add constraint conversion_events_visitor_id_format_check check (
    visitor_id is null or visitor_id ~ '^[A-Za-z0-9_-]{16,64}$'
  );

-- Click ids are minted by the ad platforms, so only their shape is ours to
-- police. Bounded so the column cannot become a payload channel.
alter table public.conversion_events
  add constraint conversion_events_click_id_size_check check (
    (gclid is null or length(gclid) <= 512)
    and (gbraid is null or length(gbraid) <= 512)
    and (wbraid is null or length(wbraid) <= 512)
    and (fbclid is null or length(fbclid) <= 512)
  );

-- Audience queries read one site's visitors over a time window. Partial: the
-- overwhelming majority of rows carry no visitor id and would only bloat it.
create index if not exists conversion_events_visitor_idx
  on public.conversion_events (site_id, visitor_id, occurred_at desc)
  where visitor_id is not null;

comment on column public.conversion_events.visitor_id is
  'Per-site persistent visitor identity. Marketing consent only; null otherwise.';
comment on column public.conversion_events.gclid is
  'Google Ads click id. Marketing consent only; null otherwise.';
comment on column public.conversion_events.gbraid is
  'Google Ads click id for app-to-web traffic. Marketing consent only.';
comment on column public.conversion_events.wbraid is
  'Google Ads click id for web-to-app traffic. Marketing consent only.';
comment on column public.conversion_events.fbclid is
  'Meta click id. Marketing consent only; null otherwise.';

-- ---------------------------------------------------------------------------
-- ingest_interaction_event
-- ---------------------------------------------------------------------------
-- The old signature is dropped rather than replaced. `create or replace` with a
-- different parameter count defines an overload instead of replacing, leaving
-- two candidates that PostgREST cannot choose between.

drop function if exists public.ingest_interaction_event(
  uuid, text, text, text, timestamptz, text, text, text, text,
  text, text, text, text, text, text, text, text, integer, text[]
);

create or replace function public.ingest_interaction_event(
  target_site_id uuid,
  in_event_id text,
  in_event_type text,
  in_session_id text,
  in_occurred_at timestamptz,
  in_page_host text,
  in_page_path text,
  in_referrer_host text,
  in_source_category text,
  in_utm_source text,
  in_utm_medium text,
  in_utm_campaign text,
  in_utm_term text,
  in_utm_content text,
  in_tracker_version text,
  in_integration_version text,
  in_decision text,
  in_risk_score integer,
  in_reason_codes text[],
  in_visitor_id text default null,
  in_gclid text default null,
  in_gbraid text default null,
  in_wbraid text default null,
  in_fbclid text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved_organization_id uuid;
  inserted_id uuid;
  primary_reason text;
begin
  if in_decision not in ('accepted', 'suspicious', 'quarantined', 'rejected') then
    raise exception 'invalid ingestion decision' using errcode = '22023';
  end if;

  -- Server-derived tenancy. The caller never supplies organization_id.
  select s.organization_id into resolved_organization_id
  from public.sites s
  where s.id = target_site_id;

  if resolved_organization_id is null then
    raise exception 'unknown site' using errcode = '23503';
  end if;

  primary_reason := coalesce(in_reason_codes[1], 'schema_violation');

  if in_decision = 'rejected' then
    insert into public.event_risk_assessments (
      organization_id, site_id, event_id, risk_score, risk_status, signal_codes
    )
    values (
      resolved_organization_id, target_site_id, in_event_id,
      in_risk_score, 'rejected', coalesce(in_reason_codes, '{}')
    );

    return 'rejected';
  end if;

  -- Quarantined and rejected events deliberately store no marketing identity.
  -- An event the risk model does not trust must not enter an audience, and a
  -- quarantine row is a diagnostic record, not a marketing one.
  if in_decision = 'quarantined' then
    insert into public.quarantined_events (
      organization_id, site_id, event_id, event_type, session_id,
      risk_score, reason_code, occurred_at
    )
    values (
      resolved_organization_id, target_site_id, in_event_id, in_event_type,
      in_session_id, in_risk_score, primary_reason, in_occurred_at
    )
    on conflict (site_id, event_id) do nothing;

    if not found then
      return 'duplicate';
    end if;

    insert into public.event_risk_assessments (
      organization_id, site_id, event_id, risk_score, risk_status, signal_codes
    )
    values (
      resolved_organization_id, target_site_id, in_event_id,
      in_risk_score, 'quarantined', coalesce(in_reason_codes, '{}')
    );

    return 'quarantined';
  end if;

  insert into public.conversion_events (
    event_id, organization_id, site_id, session_id, event_type,
    page_host, page_path, referrer_host, source_category,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    tracker_version, integration_version, occurred_at, risk_status,
    visitor_id, gclid, gbraid, wbraid, fbclid
  )
  values (
    in_event_id, resolved_organization_id, target_site_id, in_session_id,
    in_event_type, in_page_host, in_page_path, in_referrer_host,
    in_source_category, in_utm_source, in_utm_medium, in_utm_campaign,
    in_utm_term, in_utm_content, in_tracker_version, in_integration_version,
    in_occurred_at, in_decision,
    nullif(in_visitor_id, ''), nullif(in_gclid, ''), nullif(in_gbraid, ''),
    nullif(in_wbraid, ''), nullif(in_fbclid, '')
  )
  on conflict (site_id, event_id) do nothing
  returning id into inserted_id;

  -- Duplicate delivery is normal transport behaviour for a public collector,
  -- not an error: the same event id yields exactly one stored interaction.
  if inserted_id is null then
    return 'duplicate';
  end if;

  -- Clean accepted events write no assessment row. Assessments exist to explain
  -- why something was not clean; writing one per accepted event would multiply
  -- storage for no diagnostic value.
  if in_decision = 'suspicious' then
    insert into public.event_risk_assessments (
      organization_id, site_id, conversion_event_id, event_id,
      risk_score, risk_status, signal_codes
    )
    values (
      resolved_organization_id, target_site_id, inserted_id, in_event_id,
      in_risk_score, 'suspicious', coalesce(in_reason_codes, '{}')
    );
  end if;

  return in_decision;
end;
$$;

-- Re-applied because dropping the function discarded its grants. Only the
-- collector, which runs as service_role, may write interactions.
revoke all on function public.ingest_interaction_event(uuid, text, text, text, timestamptz, text, text, text, text, text, text, text, text, text, text, text, text, integer, text[], text, text, text, text, text) from public;

grant execute on function public.ingest_interaction_event(uuid, text, text, text, timestamptz, text, text, text, text, text, text, text, text, text, text, text, text, integer, text[], text, text, text, text, text) to service_role;
