alter table public.lead_status_history
  rename column changed_by to actor_user_id;

alter table public.lead_status_history
  add column actor_type text not null default 'user',
  alter column actor_user_id drop not null;

alter table public.lead_status_history
  add constraint lead_status_history_actor_check check (
    (actor_type = 'system' and actor_user_id is null)
    or (actor_type = 'user' and actor_user_id is not null)
  );

alter table public.idempotency_records
  add column failure_kind text null,
  add column error_code text null;

alter table public.idempotency_records
  add constraint idempotency_records_failure_kind_check check (
    failure_kind is null or failure_kind in ('retryable', 'non_retryable')
  );

create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid null references public.sites(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  job_key text not null,
  payload jsonb not null,
  status text not null default 'pending',
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  locked_at timestamptz null,
  locked_by text null,
  last_error_code text null,
  last_error_at timestamptz null,
  created_at timestamptz not null default now(),
  processed_at timestamptz null,
  constraint outbox_events_status_check check (
    status in ('pending', 'processing', 'completed', 'dead_letter')
  ),
  constraint outbox_events_attempt_count_check check (attempt_count >= 0),
  constraint outbox_events_payload_size_check check (pg_column_size(payload) <= 4096)
);

create unique index outbox_events_job_key_key
  on public.outbox_events (job_key);

create index outbox_events_pending_available_idx
  on public.outbox_events (available_at, created_at)
  where status = 'pending';

create index outbox_events_organization_created_at_idx
  on public.outbox_events (organization_id, created_at desc);

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid null references public.sites(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint domain_events_payload_size_check check (pg_column_size(payload) <= 4096)
);

create index domain_events_organization_created_at_idx
  on public.domain_events (organization_id, created_at desc);

create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  site_id uuid null references public.sites(id) on delete cascade,
  event_type text not null,
  severity text not null default 'info',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint security_events_severity_check check (
    severity in ('info', 'warning', 'error')
  ),
  constraint security_events_metadata_size_check check (pg_column_size(metadata) <= 4096)
);

create index security_events_site_created_at_idx
  on public.security_events (site_id, created_at desc)
  where site_id is not null;

create table public.lead_rate_limits (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  scope text not null,
  bucket_key text not null,
  window_start timestamptz not null,
  window_seconds integer not null,
  count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_rate_limits_scope_check check (scope in ('site', 'site_ip')),
  constraint lead_rate_limits_window_seconds_check check (window_seconds > 0),
  constraint lead_rate_limits_count_check check (count > 0)
);

create unique index lead_rate_limits_bucket_key
  on public.lead_rate_limits (site_id, scope, bucket_key, window_start);

create trigger lead_rate_limits_set_updated_at
  before update on public.lead_rate_limits
  for each row execute function public.set_updated_at();

create or replace function public.lead_history_matches_lead_and_actor()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.leads l
    where l.id = new.lead_id
      and l.organization_id = new.organization_id
  ) then
    raise exception 'history must match lead organization'
      using errcode = '23514';
  end if;

  if new.actor_type = 'user' and auth.uid() is not null and new.actor_user_id <> auth.uid() then
    raise exception 'actor_user_id must match current user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.claim_lead_rate_limit(
  target_site_id uuid,
  rate_scope text,
  target_bucket_key text,
  window_seconds integer,
  max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  bucket_start timestamptz;
  current_count integer;
begin
  if rate_scope not in ('site', 'site_ip') then
    raise exception 'invalid rate limit scope' using errcode = '22023';
  end if;

  if window_seconds <= 0 or max_attempts <= 0 then
    raise exception 'invalid rate limit config' using errcode = '22023';
  end if;

  bucket_start := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);

  insert into public.lead_rate_limits (
    site_id,
    scope,
    bucket_key,
    window_start,
    window_seconds,
    count
  )
  values (
    target_site_id,
    rate_scope,
    target_bucket_key,
    bucket_start,
    window_seconds,
    1
  )
  on conflict (site_id, scope, bucket_key, window_start)
  do update set count = public.lead_rate_limits.count + 1
  returning count into current_count;

  return jsonb_build_object(
    'allowed', current_count <= max_attempts,
    'count', current_count,
    'limit', max_attempts,
    'resetAt', bucket_start + make_interval(secs => window_seconds)
  );
end;
$$;

create or replace function public.complete_lead_ingestion(
  idempotency_record_id uuid,
  target_organization_id uuid,
  target_site_id uuid,
  lead_payload jsonb,
  attribution_payload jsonb,
  response_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_lead_id uuid;
  duplicate_lead_id uuid;
  duplicate_match_window interval := interval '24 hours';
  normalized_phone text := nullif(lead_payload->>'phoneNormalized', '');
  normalized_email text := nullif(lead_payload->>'emailNormalized', '');
  suspicious_reasons text[] := coalesce(
    array(select jsonb_array_elements_text(coalesce(lead_payload->'suspicionReasons', '[]'::jsonb))),
    '{}'::text[]
  );
  source_category_value text := coalesce(attribution_payload->>'sourceCategory', 'unknown');
  final_response jsonb;
begin
  perform 1
  from public.idempotency_records ir
  where ir.id = idempotency_record_id
    and ir.site_id = target_site_id
    and ir.status = 'processing'
  for update;

  if not found then
    raise exception 'idempotency record is not claimable'
      using errcode = '23505';
  end if;

  select l.id
  into duplicate_lead_id
  from public.leads l
  where l.organization_id = target_organization_id
    and l.deleted_at is null
    and l.created_at >= now() - duplicate_match_window
    and (
      (normalized_phone is not null and l.phone_normalized = normalized_phone)
      or (normalized_email is not null and l.email_normalized = normalized_email)
    )
  order by l.created_at asc, l.id asc
  limit 1;

  insert into public.leads (
    organization_id,
    site_id,
    first_name,
    last_name,
    phone,
    phone_normalized,
    email,
    email_normalized,
    service,
    city,
    message,
    status,
    is_duplicate,
    duplicate_of,
    is_suspicious,
    suspicion_reasons,
    source_category
  )
  values (
    target_organization_id,
    target_site_id,
    nullif(lead_payload->>'firstName', ''),
    nullif(lead_payload->>'lastName', ''),
    nullif(lead_payload->>'phone', ''),
    normalized_phone,
    nullif(lead_payload->>'email', ''),
    normalized_email,
    nullif(lead_payload->>'service', ''),
    nullif(lead_payload->>'city', ''),
    nullif(lead_payload->>'message', ''),
    'new',
    duplicate_lead_id is not null,
    duplicate_lead_id,
    coalesce((lead_payload->>'isSuspicious')::boolean, false),
    suspicious_reasons,
    source_category_value
  )
  returning id into new_lead_id;

  insert into public.lead_attributions (
    lead_id,
    organization_id,
    site_id,
    landing_page,
    conversion_page,
    referrer,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    first_touch_source,
    first_touch_medium,
    first_touch_campaign,
    first_touch_referrer,
    first_touch_at,
    last_touch_source,
    last_touch_medium,
    last_touch_campaign,
    last_touch_referrer,
    last_touch_at,
    source_category,
    attribution_window_days
  )
  values (
    new_lead_id,
    target_organization_id,
    target_site_id,
    nullif(attribution_payload->>'landingPage', ''),
    nullif(attribution_payload->>'conversionPage', ''),
    nullif(attribution_payload->>'referrer', ''),
    nullif(attribution_payload->>'utmSource', ''),
    nullif(attribution_payload->>'utmMedium', ''),
    nullif(attribution_payload->>'utmCampaign', ''),
    nullif(attribution_payload->>'utmContent', ''),
    nullif(attribution_payload->>'utmTerm', ''),
    nullif(attribution_payload->'firstTouch'->>'source', ''),
    nullif(attribution_payload->'firstTouch'->>'medium', ''),
    nullif(attribution_payload->'firstTouch'->>'campaign', ''),
    nullif(attribution_payload->'firstTouch'->>'referrer', ''),
    nullif(attribution_payload->'firstTouch'->>'occurredAt', '')::timestamptz,
    nullif(attribution_payload->'lastTouch'->>'source', ''),
    nullif(attribution_payload->'lastTouch'->>'medium', ''),
    nullif(attribution_payload->'lastTouch'->>'campaign', ''),
    nullif(attribution_payload->'lastTouch'->>'referrer', ''),
    nullif(attribution_payload->'lastTouch'->>'occurredAt', '')::timestamptz,
    source_category_value,
    30
  );

  insert into public.lead_status_history (
    organization_id,
    lead_id,
    old_status,
    new_status,
    actor_type,
    actor_user_id,
    note
  )
  values (
    target_organization_id,
    new_lead_id,
    null,
    'new',
    'system',
    null,
    'Lead created via ingestion API'
  );

  insert into public.domain_events (
    organization_id,
    site_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  values (
    target_organization_id,
    target_site_id,
    'lead_created',
    'lead',
    new_lead_id,
    jsonb_build_object(
      'leadId', new_lead_id,
      'organizationId', target_organization_id,
      'siteId', target_site_id
    )
  );

  insert into public.outbox_events (
    organization_id,
    site_id,
    event_type,
    aggregate_type,
    aggregate_id,
    job_key,
    payload,
    available_at
  )
  values
    (
      target_organization_id,
      target_site_id,
      'notify_business',
      'lead',
      new_lead_id,
      'notify-business:' || new_lead_id::text,
      jsonb_build_object(
        'leadId', new_lead_id,
        'organizationId', target_organization_id,
        'siteId', target_site_id
      ),
      now()
    ),
    (
      target_organization_id,
      target_site_id,
      'update_metrics',
      'lead',
      new_lead_id,
      'update-metrics:' || new_lead_id::text,
      jsonb_build_object(
        'leadId', new_lead_id,
        'organizationId', target_organization_id,
        'siteId', target_site_id
      ),
      now()
    );

  if duplicate_lead_id is not null then
    insert into public.security_events (
      organization_id,
      site_id,
      event_type,
      severity,
      metadata
    )
    values (
      target_organization_id,
      target_site_id,
      'lead.duplicate_detected',
      'info',
      jsonb_build_object(
        'leadId', new_lead_id,
        'duplicateOf', duplicate_lead_id
      )
    );
  end if;

  if coalesce((lead_payload->>'isSuspicious')::boolean, false) then
    insert into public.security_events (
      organization_id,
      site_id,
      event_type,
      severity,
      metadata
    )
    values (
      target_organization_id,
      target_site_id,
      'lead.suspicious_created',
      'warning',
      jsonb_build_object(
        'leadId', new_lead_id,
        'reasons', to_jsonb(suspicious_reasons)
      )
    );
  end if;

  final_response := response_payload
    || jsonb_build_object(
      'success', true,
      'leadId', new_lead_id,
      'duplicate', duplicate_lead_id is not null
    );

  update public.idempotency_records
  set status = 'completed',
      resource_type = 'lead',
      resource_id = new_lead_id,
      response_status = 201,
      response_body = final_response,
      locked_until = null,
      failure_kind = null,
      error_code = null
  where id = idempotency_record_id;

  insert into public.audit_logs (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target_organization_id,
    null,
    'lead.created',
    'lead',
    new_lead_id,
    jsonb_build_object(
      'siteId', target_site_id,
      'leadId', new_lead_id,
      'duplicate', duplicate_lead_id is not null
    )
  );

  return final_response;
end;
$$;

create or replace function public.record_security_event(
  target_organization_id uuid,
  target_site_id uuid,
  event_name text,
  event_severity text,
  event_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.security_events (
    organization_id,
    site_id,
    event_type,
    severity,
    metadata
  )
  values (
    target_organization_id,
    target_site_id,
    event_name,
    event_severity,
    public.sanitize_audit_metadata(coalesce(event_metadata, '{}'::jsonb))
  );
end;
$$;

alter table public.outbox_events enable row level security;
alter table public.domain_events enable row level security;
alter table public.security_events enable row level security;
alter table public.lead_rate_limits enable row level security;

revoke all on table public.outbox_events from anon, authenticated;
revoke all on table public.domain_events from anon, authenticated;
revoke all on table public.security_events from anon, authenticated;
revoke all on table public.lead_rate_limits from anon, authenticated;

grant all on
  public.outbox_events,
  public.domain_events,
  public.security_events,
  public.lead_rate_limits
to service_role;

grant execute on function public.claim_lead_rate_limit(uuid, text, text, integer, integer) to service_role;
grant execute on function public.complete_lead_ingestion(uuid, uuid, uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.record_security_event(uuid, uuid, text, text, jsonb) to service_role;

revoke all on function public.claim_lead_rate_limit(uuid, text, text, integer, integer) from public;
revoke all on function public.complete_lead_ingestion(uuid, uuid, uuid, jsonb, jsonb, jsonb) from public;
revoke all on function public.record_security_event(uuid, uuid, text, text, jsonb) from public;
