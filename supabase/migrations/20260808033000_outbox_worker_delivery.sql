alter table public.outbox_events
  add column last_worker_id text null;

create table public.job_executions (
  id uuid primary key default gen_random_uuid(),
  outbox_event_id uuid not null references public.outbox_events(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_key text not null,
  event_type text not null,
  attempt_number integer not null,
  worker_id text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  duration_ms integer null,
  error_code text null,
  error_category text null,
  error_message_safe text null,
  created_at timestamptz not null default now(),
  constraint job_executions_status_check check (status in ('processing', 'completed', 'failed')),
  constraint job_executions_attempt_number_check check (attempt_number > 0),
  constraint job_executions_duration_check check (duration_ms is null or duration_ms >= 0),
  constraint job_executions_error_message_safe_check check (
    error_message_safe is null or length(error_message_safe) <= 500
  )
);

create index job_executions_outbox_created_at_idx
  on public.job_executions (outbox_event_id, created_at desc);

create index job_executions_organization_created_at_idx
  on public.job_executions (organization_id, created_at desc);

create index job_executions_status_created_at_idx
  on public.job_executions (status, created_at);

create index job_executions_job_key_idx
  on public.job_executions (job_key);

create table public.delivery_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid null references public.sites(id) on delete cascade,
  lead_id uuid null references public.leads(id) on delete set null,
  channel text not null,
  template_key text not null,
  logical_delivery_key text not null,
  status text not null default 'pending',
  provider_message_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_operations_channel_check check (channel in ('email')),
  constraint delivery_operations_status_check check (
    status in ('pending', 'sending', 'sent', 'delivery_unknown', 'failed')
  )
);

create unique index delivery_operations_logical_key
  on public.delivery_operations (channel, template_key, logical_delivery_key);

create trigger delivery_operations_set_updated_at
  before update on public.delivery_operations
  for each row execute function public.set_updated_at();

create table public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid null references public.sites(id) on delete cascade,
  lead_id uuid null references public.leads(id) on delete set null,
  outbox_event_id uuid null references public.outbox_events(id) on delete set null,
  delivery_operation_id uuid null references public.delivery_operations(id) on delete set null,
  channel text not null,
  provider text not null,
  template_key text not null,
  recipient_fingerprint text not null,
  attempt_number integer not null,
  status text not null,
  provider_message_id text null,
  provider_status text null,
  error_code text null,
  error_message_safe text null,
  sent_at timestamptz null,
  delivered_at timestamptz null,
  failed_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint delivery_attempts_channel_check check (channel in ('email')),
  constraint delivery_attempts_status_check check (
    status in ('pending', 'sent', 'delivered', 'failed', 'delivery_unknown')
  ),
  constraint delivery_attempts_attempt_number_check check (attempt_number > 0),
  constraint delivery_attempts_recipient_fingerprint_check check (
    recipient_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint delivery_attempts_error_message_safe_check check (
    error_message_safe is null or length(error_message_safe) <= 500
  )
);

create index delivery_attempts_lead_created_at_idx
  on public.delivery_attempts (lead_id, created_at desc)
  where lead_id is not null;

create index delivery_attempts_outbox_created_at_idx
  on public.delivery_attempts (outbox_event_id, created_at desc)
  where outbox_event_id is not null;

create index delivery_attempts_organization_created_at_idx
  on public.delivery_attempts (organization_id, created_at desc);

create table public.dead_letter_events (
  id uuid primary key default gen_random_uuid(),
  outbox_event_id uuid not null references public.outbox_events(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_key text not null,
  event_type text not null,
  final_attempt_count integer not null,
  failure_code text not null,
  failure_category text not null,
  failure_message_safe text null,
  payload_reference jsonb not null,
  dead_lettered_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null references auth.users(id) on delete set null,
  resolution_note text null,
  created_at timestamptz not null default now(),
  constraint dead_letter_events_final_attempt_check check (final_attempt_count > 0),
  constraint dead_letter_events_payload_size_check check (pg_column_size(payload_reference) <= 1024),
  constraint dead_letter_events_resolution_note_check check (
    resolution_note is null or length(resolution_note) <= 1000
  )
);

create unique index dead_letter_events_outbox_event_key
  on public.dead_letter_events (outbox_event_id);

create index dead_letter_events_organization_created_at_idx
  on public.dead_letter_events (organization_id, created_at desc);

create table public.notification_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid null references public.sites(id) on delete cascade,
  channel text not null,
  recipient_email text null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_settings_channel_check check (channel in ('email')),
  constraint notification_settings_email_check check (
    recipient_email is null
    or (
      length(recipient_email) <= 320
      and recipient_email = lower(trim(recipient_email))
      and recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    )
  )
);

create unique index notification_settings_site_channel_key
  on public.notification_settings (
    organization_id,
    coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid),
    channel
  );

create trigger notification_settings_set_updated_at
  before update on public.notification_settings
  for each row execute function public.set_updated_at();

create or replace function public.notification_setting_matches_site()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.site_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.sites s
    where s.id = new.site_id
      and s.organization_id = new.organization_id
  ) then
    raise exception 'notification setting site must match organization'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger notification_settings_match_site
  before insert or update of organization_id, site_id
  on public.notification_settings
  for each row execute function public.notification_setting_matches_site();

create or replace function public.claim_outbox_events(
  worker_id text,
  batch_size integer,
  lock_timeout_seconds integer
)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if batch_size <= 0 or batch_size > 100 then
    raise exception 'invalid batch size' using errcode = '22023';
  end if;

  if lock_timeout_seconds <= 0 then
    raise exception 'invalid lock timeout' using errcode = '22023';
  end if;

  return query
  with claimable as (
    select oe.id
    from public.outbox_events oe
    where (
        oe.status = 'pending'
        and oe.available_at <= now()
      )
      or (
        oe.status = 'processing'
        and oe.locked_at < now() - make_interval(secs => lock_timeout_seconds)
      )
    order by oe.available_at asc, oe.created_at asc
    limit batch_size
    for update skip locked
  )
  update public.outbox_events oe
  set status = 'processing',
      locked_at = now(),
      locked_by = worker_id,
      last_worker_id = worker_id
  from claimable
  where oe.id = claimable.id
  returning oe.*;
end;
$$;

create or replace function public.finish_outbox_success(
  target_outbox_event_id uuid,
  target_worker_id text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.outbox_events
  set status = 'completed',
      processed_at = now(),
      locked_at = null,
      locked_by = null
  where id = target_outbox_event_id
    and status = 'processing'
    and locked_by = target_worker_id;

  if not found then
    raise exception 'invalid outbox success transition' using errcode = '55000';
  end if;
end;
$$;

create or replace function public.finish_outbox_failure(
  target_outbox_event_id uuid,
  target_worker_id text,
  retryable boolean,
  max_attempts integer,
  next_available_at timestamptz,
  failure_code text,
  failure_category text,
  failure_message_safe text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_record public.outbox_events%rowtype;
  next_attempt_count integer;
  final_status text;
begin
  select *
  into event_record
  from public.outbox_events
  where id = target_outbox_event_id
    and status = 'processing'
    and locked_by = target_worker_id
  for update;

  if not found then
    raise exception 'invalid outbox failure transition' using errcode = '55000';
  end if;

  next_attempt_count := event_record.attempt_count + 1;

  if retryable and next_attempt_count < max_attempts then
    update public.outbox_events
    set status = 'pending',
        attempt_count = next_attempt_count,
        available_at = next_available_at,
        locked_at = null,
        locked_by = null,
        last_error_code = failure_code,
        last_error_at = now()
    where id = target_outbox_event_id;

    final_status := 'pending';
  else
    update public.outbox_events
    set status = 'dead_letter',
        attempt_count = next_attempt_count,
        locked_at = null,
        locked_by = null,
        last_error_code = failure_code,
        last_error_at = now()
    where id = target_outbox_event_id;

    insert into public.dead_letter_events (
      outbox_event_id,
      organization_id,
      job_key,
      event_type,
      final_attempt_count,
      failure_code,
      failure_category,
      failure_message_safe,
      payload_reference
    )
    values (
      event_record.id,
      event_record.organization_id,
      event_record.job_key,
      event_record.event_type,
      next_attempt_count,
      failure_code,
      failure_category,
      failure_message_safe,
      jsonb_build_object(
        'leadId', event_record.payload->>'leadId',
        'siteId', event_record.payload->>'siteId'
      )
    )
    on conflict (outbox_event_id) do nothing;

    final_status := 'dead_letter';
  end if;

  return final_status;
end;
$$;

create or replace function public.requeue_dead_letter_event(
  target_dead_letter_id uuid,
  actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_record public.dead_letter_events%rowtype;
begin
  select *
  into target_record
  from public.dead_letter_events
  where id = target_dead_letter_id
  for update;

  if not found then
    raise exception 'dead letter not found' using errcode = '02000';
  end if;

  update public.outbox_events
  set status = 'pending',
      available_at = now(),
      locked_at = null,
      locked_by = null
  where id = target_record.outbox_event_id
    and status = 'dead_letter';

  update public.dead_letter_events
  set resolved_at = now(),
      resolved_by = actor_user_id,
      resolution_note = 'requeued'
  where id = target_dead_letter_id
    and resolved_at is null;
end;
$$;

create or replace function public.resolve_dead_letter_event(
  target_dead_letter_id uuid,
  actor_user_id uuid,
  note text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.dead_letter_events
  set resolved_at = now(),
      resolved_by = actor_user_id,
      resolution_note = left(coalesce(note, 'resolved'), 1000)
  where id = target_dead_letter_id
    and resolved_at is null;
end;
$$;

alter table public.job_executions enable row level security;
alter table public.delivery_operations enable row level security;
alter table public.delivery_attempts enable row level security;
alter table public.dead_letter_events enable row level security;
alter table public.notification_settings enable row level security;

create policy "owners can read notification settings"
  on public.notification_settings
  for select
  to authenticated
  using (public.is_org_member(organization_id, array['organization_owner']));

revoke all on table public.job_executions from anon, authenticated;
revoke all on table public.delivery_operations from anon, authenticated;
revoke all on table public.delivery_attempts from anon, authenticated;
revoke all on table public.dead_letter_events from anon, authenticated;

grant select on public.notification_settings to authenticated;

grant all on
  public.job_executions,
  public.delivery_operations,
  public.delivery_attempts,
  public.dead_letter_events,
  public.notification_settings,
  public.outbox_events
to service_role;

grant execute on function public.claim_outbox_events(text, integer, integer) to service_role;
grant execute on function public.finish_outbox_success(uuid, text) to service_role;
grant execute on function public.finish_outbox_failure(uuid, text, boolean, integer, timestamptz, text, text, text) to service_role;
grant execute on function public.requeue_dead_letter_event(uuid, uuid) to service_role;
grant execute on function public.resolve_dead_letter_event(uuid, uuid, text) to service_role;

revoke all on function public.notification_setting_matches_site() from public;
revoke all on function public.claim_outbox_events(text, integer, integer) from public;
revoke all on function public.finish_outbox_success(uuid, text) from public;
revoke all on function public.finish_outbox_failure(uuid, text, boolean, integer, timestamptz, text, text, text) from public;
revoke all on function public.requeue_dead_letter_event(uuid, uuid) from public;
revoke all on function public.resolve_dead_letter_event(uuid, uuid, text) from public;
