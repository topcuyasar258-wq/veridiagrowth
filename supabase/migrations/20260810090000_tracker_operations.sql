-- Phase 2A / Slice 4: retention, anomalies and release operations.
--
-- Everything here is service-role only. None of it is reachable by a customer
-- session, and none of it stores personal data.

-- ---------------------------------------------------------------------------
-- Release artifact integrity
-- ---------------------------------------------------------------------------
-- A release names bytes served to every visitor of every customer site. Storing
-- the hash lets a deployment prove that what is published is what was reviewed,
-- and makes "same version, different bytes" detectable rather than silent.

alter table public.tracker_releases
  add column if not exists artifact_sha256 text null,
  add column if not exists loader_bytes integer null,
  add column if not exists tracker_bytes integer null;

alter table public.tracker_releases
  add constraint tracker_releases_artifact_sha256_check check (
    artifact_sha256 is null or artifact_sha256 ~ '^[a-f0-9]{64}$'
  );

alter table public.tracker_releases
  add constraint tracker_releases_sizes_check check (
    (loader_bytes is null or loader_bytes > 0)
    and (tracker_bytes is null or tracker_bytes > 0)
  );

-- A published version is immutable. Shipping different bytes under a version
-- customers may already have cached is indistinguishable from an attack.
create or replace function public.enforce_tracker_release_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status <> 'draft' and old.artifact_sha256 is not null then
    if new.artifact_sha256 is distinct from old.artifact_sha256 then
      raise exception 'published tracker release artifact is immutable'
        using errcode = '23514';
    end if;

    if new.version is distinct from old.version then
      raise exception 'published tracker release version is immutable'
        using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tracker_releases_immutable on public.tracker_releases;
create trigger tracker_releases_immutable
  before update on public.tracker_releases
  for each row
  execute function public.enforce_tracker_release_immutability();

-- ---------------------------------------------------------------------------
-- Anomaly idempotency
-- ---------------------------------------------------------------------------
-- One anomaly per site, type and window. Without this a worker that runs twice
-- -- or overlaps itself -- would multiply the same finding.

create unique index if not exists event_anomalies_site_type_window_key
  on public.event_anomalies (site_id, anomaly_type, window_started_at);

-- ---------------------------------------------------------------------------
-- sweep_expired_interactions
-- ---------------------------------------------------------------------------
-- Deletes only rows whose retention deadline has passed, in bounded batches.
--
-- Bounded because a single unbounded DELETE over a large table takes locks for
-- as long as it runs, and this table is written by a public endpoint. Repeated
-- invocation is the intended usage: the caller loops until counts reach zero.
--
-- The `expires_at <= now()` predicate is the only selector. Nothing here filters
-- by tenant, and nothing may delete a row that has not expired.

create or replace function public.sweep_expired_interactions(
  batch_limit integer default 500
)
returns table (
  deleted_accepted integer,
  deleted_suspicious integer,
  deleted_quarantined integer,
  deleted_quota_buckets integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  accepted_count integer := 0;
  suspicious_count integer := 0;
  quarantined_count integer := 0;
  quota_count integer := 0;
begin
  if batch_limit <= 0 or batch_limit > 10000 then
    raise exception 'invalid retention batch limit' using errcode = '22023';
  end if;

  with expired as (
    select id, risk_status
    from public.conversion_events
    where expires_at <= now()
    order by expires_at
    limit batch_limit
    for update skip locked
  ),
  removed as (
    delete from public.conversion_events c
    using expired e
    where c.id = e.id
    returning e.risk_status
  )
  select
    count(*) filter (where risk_status = 'accepted')::integer,
    count(*) filter (where risk_status = 'suspicious')::integer
  into accepted_count, suspicious_count
  from removed;

  with expired as (
    select id
    from public.quarantined_events
    where expires_at <= now()
    order by expires_at
    limit batch_limit
    for update skip locked
  ),
  removed as (
    delete from public.quarantined_events q
    using expired e
    where q.id = e.id
    returning 1 as one
  )
  select count(*)::integer into quarantined_count from removed;

  -- Quota rows describe a window that has already closed. Two windows of grace
  -- so a sweep can never race a counter that is still being written.
  with expired as (
    select id
    from public.event_quotas
    where window_started_at
      < now() - make_interval(secs => window_seconds * 2)
    order by window_started_at
    limit batch_limit
    for update skip locked
  ),
  removed as (
    delete from public.event_quotas q
    using expired e
    where q.id = e.id
    returning 1 as one
  )
  select count(*)::integer into quota_count from removed;

  return query
    select accepted_count, suspicious_count, quarantined_count, quota_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- detect_event_anomalies
-- ---------------------------------------------------------------------------
-- Deterministic threshold comparison of a recent window against a rolling
-- baseline. No model, no learning: an opaque detector cannot be explained to a
-- customer whose traffic it flagged, and cannot be pinned by a test.
--
-- `min_sample` exists because ratios are meaningless on tiny numbers. On a new
-- site one event against a baseline of zero is a 100x spike and tells nobody
-- anything.

create or replace function public.detect_event_anomalies(
  window_minutes integer default 5,
  baseline_windows integer default 12,
  min_sample integer default 20,
  spike_multiplier numeric default 3.0,
  rate_threshold numeric default 0.30
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  window_start timestamptz;
  window_end timestamptz;
  baseline_start timestamptz;
  inserted_count integer := 0;
begin
  if window_minutes <= 0 or baseline_windows <= 0 or min_sample <= 0 then
    raise exception 'invalid anomaly configuration' using errcode = '22023';
  end if;

  window_end := date_trunc('minute', now());
  window_start := window_end - make_interval(mins => window_minutes);
  baseline_start :=
    window_start - make_interval(mins => window_minutes * baseline_windows);

  with current_window as (
    select
      organization_id,
      site_id,
      count(*)::integer as observed,
      count(*) filter (where risk_status = 'suspicious')::integer as suspicious
    from public.conversion_events
    where received_at >= window_start and received_at < window_end
    group by organization_id, site_id
  ),
  baseline as (
    select
      site_id,
      (count(*)::numeric / baseline_windows) as avg_per_window
    from public.conversion_events
    where received_at >= baseline_start and received_at < window_start
    group by site_id
  ),
  quarantine_window as (
    select site_id, count(*)::integer as quarantined
    from public.quarantined_events
    where received_at >= window_start and received_at < window_end
    group by site_id
  ),
  findings as (
    select
      c.organization_id,
      c.site_id,
      'volume_burst'::text as anomaly_type,
      case
        when c.observed >= coalesce(b.avg_per_window, 0) * spike_multiplier * 3
          then 'high'
        when c.observed >= coalesce(b.avg_per_window, 0) * spike_multiplier * 2
          then 'medium'
        else 'low'
      end as severity,
      c.observed,
      coalesce(round(b.avg_per_window), 0)::integer as baseline_count
    from current_window c
    left join baseline b on b.site_id = c.site_id
    where c.observed >= min_sample
      -- A site with no history cannot be compared, so it is not flagged.
      and coalesce(b.avg_per_window, 0) > 0
      and c.observed >= b.avg_per_window * spike_multiplier

    union all

    select
      c.organization_id,
      c.site_id,
      'quarantine_spike'::text,
      case when q.quarantined::numeric / (c.observed + q.quarantined) >= 0.6
        then 'high' else 'medium' end,
      q.quarantined,
      c.observed
    from current_window c
    join quarantine_window q on q.site_id = c.site_id
    where (c.observed + q.quarantined) >= min_sample
      and q.quarantined::numeric / (c.observed + q.quarantined) >= rate_threshold

    union all

    select
      c.organization_id,
      c.site_id,
      'duplicate_flood'::text,
      'medium'::text,
      c.suspicious,
      c.observed
    from current_window c
    where c.observed >= min_sample
      and c.suspicious::numeric / c.observed >= rate_threshold
  ),
  written as (
    insert into public.event_anomalies (
      organization_id, site_id, anomaly_type, severity,
      window_started_at, window_ended_at, observed_count, baseline_count
    )
    select
      organization_id, site_id, anomaly_type, severity,
      window_start, window_end, observed, baseline_count
    from findings
    -- Re-running the worker over the same window is a no-op.
    on conflict (site_id, anomaly_type, window_started_at) do nothing
    returning 1 as one
  )
  select count(*)::integer into inserted_count from written;

  return inserted_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Release lifecycle
-- ---------------------------------------------------------------------------
-- draft -> canary -> active -> deprecated, and active -> rolled_back.
-- Enforced here rather than in application code so no caller can reach an
-- invalid state, and so a rollback is a single atomic step.

create or replace function public.publish_tracker_release(
  in_version text,
  in_artifact_sha256 text,
  in_loader_bytes integer,
  in_tracker_bytes integer,
  in_status text default 'canary'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  release_id uuid;
begin
  if in_status not in ('draft', 'canary') then
    raise exception 'a release is published as draft or canary'
      using errcode = '22023';
  end if;

  insert into public.tracker_releases (
    version, status, artifact_sha256, loader_bytes, tracker_bytes, released_at
  )
  values (
    in_version, in_status, in_artifact_sha256, in_loader_bytes, in_tracker_bytes,
    case when in_status = 'draft' then null else now() end
  )
  returning id into release_id;

  return release_id;
end;
$$;

create or replace function public.activate_tracker_release(
  in_version text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target public.tracker_releases%rowtype;
begin
  select * into target
  from public.tracker_releases
  where version = in_version
  for update;

  if not found then
    raise exception 'unknown tracker release' using errcode = '23503';
  end if;

  if target.status not in ('canary', 'active', 'deprecated') then
    raise exception 'only a canary, active or deprecated release can be activated'
      using errcode = '22023';
  end if;

  if target.artifact_sha256 is null then
    raise exception 'a release without an artifact hash cannot be activated'
      using errcode = '22023';
  end if;

  -- Demote first: the single-active unique index is checked immediately, so
  -- promoting before demoting would collide with the outgoing release.
  update public.tracker_releases
  set status = 'deprecated'
  where status = 'active' and id <> target.id;

  update public.tracker_releases
  set status = 'active',
      released_at = coalesce(released_at, now())
  where id = target.id;

  return target.id;
end;
$$;

create or replace function public.rollback_tracker_release(
  in_to_version text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target public.tracker_releases%rowtype;
  current_active public.tracker_releases%rowtype;
begin
  select * into target
  from public.tracker_releases
  where version = in_to_version
  for update;

  if not found then
    raise exception 'unknown rollback target' using errcode = '23503';
  end if;

  if target.artifact_sha256 is null then
    raise exception 'cannot roll back to a release without an artifact hash'
      using errcode = '22023';
  end if;

  select * into current_active
  from public.tracker_releases
  where status = 'active'
  for update;

  -- The failing release is marked rolled_back rather than deprecated, so the
  -- history records that it was withdrawn rather than superseded.
  if found and current_active.id <> target.id then
    update public.tracker_releases
    set status = 'rolled_back'
    where id = current_active.id;
  end if;

  update public.tracker_releases
  set status = 'active'
  where id = target.id;

  return target.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_site_tracker_release
-- ---------------------------------------------------------------------------
-- Which artifact a site should load. A pinned site keeps its version even when
-- the global default moves, which is the entire point of pinning: a customer
-- mid-incident must not be moved by an unrelated rollout.

create or replace function public.resolve_site_tracker_release(
  target_site_id uuid
)
returns table (
  version text,
  artifact_sha256 text,
  pinned boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    coalesce(pinned_release.version, active_release.version),
    coalesce(pinned_release.artifact_sha256, active_release.artifact_sha256),
    (pinned_release.version is not null)
  from (select 1) as anchor
  left join lateral (
    select r.version, r.artifact_sha256
    from public.site_tracker_deployments d
    join public.tracker_releases r on r.id = d.tracker_release_id
    where d.site_id = target_site_id and d.pinned = true
  ) as pinned_release on true
  left join lateral (
    select r.version, r.artifact_sha256
    from public.tracker_releases r
    where r.status = 'active'
    limit 1
  ) as active_release on true;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
-- Customers can neither run maintenance nor change what code their site serves.

revoke all on function public.sweep_expired_interactions(integer) from public;
revoke all on function public.detect_event_anomalies(integer, integer, integer, numeric, numeric) from public;
revoke all on function public.publish_tracker_release(text, text, integer, integer, text) from public;
revoke all on function public.activate_tracker_release(text) from public;
revoke all on function public.rollback_tracker_release(text) from public;
revoke all on function public.resolve_site_tracker_release(uuid) from public;

grant execute on function public.sweep_expired_interactions(integer) to service_role;
grant execute on function public.detect_event_anomalies(integer, integer, integer, numeric, numeric) to service_role;
grant execute on function public.publish_tracker_release(text, text, integer, integer, text) to service_role;
grant execute on function public.activate_tracker_release(text) to service_role;
grant execute on function public.rollback_tracker_release(text) to service_role;
grant execute on function public.resolve_site_tracker_release(uuid) to service_role;
