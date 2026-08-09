-- Phase 2A / Slice 2: collector server side.
--
-- Two RPCs, both service-role only:
--   consume_event_quota          atomic fixed-window rate limiting
--   ingest_interaction_event     per-event transactional storage
--
-- Both exist because the naive shape (SELECT count, then INSERT) loses races.
-- Under concurrency that would let a caller exceed a quota, or write a
-- conversion event without its risk assessment.

-- ---------------------------------------------------------------------------
-- Quarantine reason codes
-- ---------------------------------------------------------------------------
-- Slice 1 enumerated reason codes before the risk engine existed. The engine's
-- signal vocabulary is the authority, so the constraint is widened to accept
-- every signal the engine can raise. Reasons stay enumerated: a free-form
-- string here would be a route for caller-controlled text to reach storage.

alter table public.quarantined_events
  drop constraint quarantined_events_reason_code_check;

alter table public.quarantined_events
  add constraint quarantined_events_reason_code_check check (
    reason_code in (
      'origin_missing',
      'origin_mismatch',
      'origin_invalid',
      'referer_mismatch',
      'unknown_site_key',
      'duplicate_event_id',
      'site_rate_elevated',
      'site_ip_rate_elevated',
      'session_rate_elevated',
      'event_type_rate_elevated',
      'session_burst',
      'ip_burst',
      'site_burst',
      'abnormal_sequence',
      'invalid_sequence',
      'unrealistic_event_rate',
      'user_agent_anomaly',
      'user_agent_missing',
      'future_timestamp',
      'stale_timestamp',
      'schema_violation'
    )
  );

-- ---------------------------------------------------------------------------
-- consume_event_quota
-- ---------------------------------------------------------------------------
-- Fixed windows rather than a sliding log: one row per (site, scope, key,
-- window) is bounded storage, which matters for an endpoint that is expected to
-- come under abuse. The INSERT ... ON CONFLICT DO UPDATE is a single atomic
-- statement, so concurrent callers serialise on the row rather than racing.

create or replace function public.consume_event_quota(
  target_organization_id uuid,
  target_site_id uuid,
  quota_scope text,
  quota_scope_key text,
  quota_window_seconds integer,
  quota_limit integer,
  increment_by integer default 1
)
returns table (
  allowed boolean,
  current_count integer,
  quota_limit_value integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  window_start timestamptz;
  new_count integer;
begin
  if quota_window_seconds <= 0 or quota_limit <= 0 then
    raise exception 'invalid quota configuration' using errcode = '22023';
  end if;

  window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / quota_window_seconds)
      * quota_window_seconds
  );

  insert into public.event_quotas (
    organization_id,
    site_id,
    scope,
    scope_key,
    window_started_at,
    window_seconds,
    event_count,
    limit_value
  )
  values (
    target_organization_id,
    target_site_id,
    quota_scope,
    quota_scope_key,
    window_start,
    quota_window_seconds,
    increment_by,
    quota_limit
  )
  on conflict (site_id, scope, scope_key, window_started_at)
  do update
    set event_count = public.event_quotas.event_count + increment_by,
        limit_value = excluded.limit_value,
        updated_at = now()
  returning public.event_quotas.event_count into new_count;

  return query
    select new_count <= quota_limit, new_count, quota_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- ingest_interaction_event
-- ---------------------------------------------------------------------------
-- One event, one transaction. The decision determines which tables are touched:
--
--   accepted / suspicious  -> conversion_events (+ assessment when suspicious)
--   quarantined            -> quarantined_events only
--   rejected               -> assessment only, no stored interaction
--
-- Quarantined events deliberately do NOT also get a conversion_events row. One
-- interaction must never be countable as two logical records, and a quarantined
-- row in conversion_events would risk showing up in a clean metric through a
-- forgotten risk_status filter.
--
-- Tenancy is derived from the resolved site, never from the request body:
-- organization_id is read from public.sites rather than trusted from the
-- caller, so a client cannot write into another tenant.

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
  in_reason_codes text[]
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
    tracker_version, integration_version, occurred_at, risk_status
  )
  values (
    in_event_id, resolved_organization_id, target_site_id, in_session_id,
    in_event_type, in_page_host, in_page_path, in_referrer_host,
    in_source_category, in_utm_source, in_utm_medium, in_utm_campaign,
    in_utm_term, in_utm_content, in_tracker_version, in_integration_version,
    in_occurred_at, in_decision
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

-- ---------------------------------------------------------------------------
-- touch_site_tracker_deployment
-- ---------------------------------------------------------------------------
-- last_seen_at is throttled to at most one write per site per five minutes.
-- Updating it on every event would turn one row per site into a contention
-- point under exactly the traffic this endpoint is built for.

create or replace function public.touch_site_tracker_deployment(
  target_site_id uuid,
  in_tracker_version text,
  in_integration_version text,
  throttle_seconds integer default 300
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved_organization_id uuid;
begin
  update public.site_tracker_deployments
  set last_seen_at = now(),
      integration_version = coalesce(in_integration_version, integration_version),
      updated_at = now()
  where site_id = target_site_id
    and (
      last_seen_at is null
      or last_seen_at < now() - make_interval(secs => throttle_seconds)
    );

  if found then
    return;
  end if;

  if exists (
    select 1 from public.site_tracker_deployments where site_id = target_site_id
  ) then
    return;
  end if;

  select s.organization_id into resolved_organization_id
  from public.sites s
  where s.id = target_site_id;

  if resolved_organization_id is null then
    return;
  end if;

  insert into public.site_tracker_deployments (
    organization_id, site_id, integration_version, last_seen_at
  )
  values (
    resolved_organization_id, target_site_id, in_integration_version, now()
  )
  on conflict (site_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
-- The collector runs server-side with the service role. Customers must not be
-- able to write interactions, so execute is revoked from every other role.

revoke all on function public.consume_event_quota(uuid, uuid, text, text, integer, integer, integer) from public;
revoke all on function public.ingest_interaction_event(uuid, text, text, text, timestamptz, text, text, text, text, text, text, text, text, text, text, text, text, integer, text[]) from public;
revoke all on function public.touch_site_tracker_deployment(uuid, text, text, integer) from public;

grant execute on function public.consume_event_quota(uuid, uuid, text, text, integer, integer, integer) to service_role;
grant execute on function public.ingest_interaction_event(uuid, text, text, text, timestamptz, text, text, text, text, text, text, text, text, text, text, text, text, integer, text[]) to service_role;
grant execute on function public.touch_site_tracker_deployment(uuid, text, text, integer) to service_role;
