create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  first_name text null,
  last_name text null,
  phone text null,
  phone_normalized text null,
  email text null,
  email_normalized text null,
  service text null,
  city text null,
  message text null,
  status text not null default 'new',
  assigned_to uuid null references auth.users(id) on delete set null,
  is_duplicate boolean not null default false,
  duplicate_of uuid null,
  is_suspicious boolean not null default false,
  suspicion_reasons text[] not null default '{}',
  source_category text not null default 'unknown',
  version integer not null default 1,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint leads_status_check check (
    status in ('new', 'contacted', 'offer_sent', 'won', 'lost')
  ),
  constraint leads_source_category_check check (
    source_category in (
      'organic',
      'paid_search',
      'paid_social',
      'referral',
      'direct',
      'unknown'
    )
  ),
  constraint leads_contact_required_check check (
    nullif(trim(coalesce(phone, '')), '') is not null
    or nullif(trim(coalesce(email, '')), '') is not null
  ),
  constraint leads_not_self_duplicate_check check (
    duplicate_of is null or duplicate_of <> id
  ),
  constraint leads_version_positive_check check (version > 0)
);

alter table public.leads
  add constraint leads_duplicate_of_fkey
  foreign key (duplicate_of) references public.leads(id) on delete set null;

create table public.lead_attributions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  landing_page text null,
  conversion_page text null,
  referrer text null,
  utm_source text null,
  utm_medium text null,
  utm_campaign text null,
  utm_content text null,
  utm_term text null,
  first_touch_source text null,
  first_touch_medium text null,
  first_touch_campaign text null,
  first_touch_referrer text null,
  first_touch_at timestamptz null,
  last_touch_source text null,
  last_touch_medium text null,
  last_touch_campaign text null,
  last_touch_referrer text null,
  last_touch_at timestamptz null,
  source_category text not null default 'unknown',
  attribution_window_days integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_attributions_source_category_check check (
    source_category in (
      'organic',
      'paid_search',
      'paid_social',
      'referral',
      'direct',
      'unknown'
    )
  ),
  constraint lead_attributions_window_check check (
    attribution_window_days between 1 and 180
  ),
  constraint lead_attributions_url_length_check check (
    length(coalesce(landing_page, '')) <= 2048
    and length(coalesce(conversion_page, '')) <= 2048
    and length(coalesce(referrer, '')) <= 2048
    and length(coalesce(first_touch_referrer, '')) <= 2048
    and length(coalesce(last_touch_referrer, '')) <= 2048
  ),
  constraint lead_attributions_utm_length_check check (
    length(coalesce(utm_source, '')) <= 256
    and length(coalesce(utm_medium, '')) <= 256
    and length(coalesce(utm_campaign, '')) <= 512
    and length(coalesce(utm_content, '')) <= 512
    and length(coalesce(utm_term, '')) <= 512
    and length(coalesce(first_touch_source, '')) <= 256
    and length(coalesce(first_touch_medium, '')) <= 256
    and length(coalesce(first_touch_campaign, '')) <= 512
    and length(coalesce(last_touch_source, '')) <= 256
    and length(coalesce(last_touch_medium, '')) <= 256
    and length(coalesce(last_touch_campaign, '')) <= 512
  )
);

create table public.lead_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  old_status text null,
  new_status text not null,
  changed_by uuid not null references auth.users(id) on delete restrict,
  assigned_to uuid null references auth.users(id) on delete set null,
  note text null,
  created_at timestamptz not null default now(),
  constraint lead_status_history_status_check check (
    (old_status is null or old_status in ('new', 'contacted', 'offer_sent', 'won', 'lost'))
    and new_status in ('new', 'contacted', 'offer_sent', 'won', 'lost')
  ),
  constraint lead_status_history_note_length_check check (
    length(coalesce(note, '')) <= 2000
  )
);

create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz null,
  deleted_at timestamptz null,
  constraint lead_notes_body_check check (
    length(trim(body)) > 0 and length(body) <= 5000
  )
);

create table public.site_credentials (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key_id text not null unique,
  secret_ciphertext text not null,
  secret_fingerprint text not null,
  status text not null,
  valid_from timestamptz not null default now(),
  valid_until timestamptz null,
  rotation_group_id uuid null,
  created_by uuid not null references auth.users(id) on delete restrict,
  revoked_by uuid null references auth.users(id) on delete set null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_credentials_status_check check (
    status in ('active', 'rotating', 'revoked', 'expired')
  ),
  constraint site_credentials_revocation_check check (
    (status in ('revoked', 'expired') and valid_until is not null)
    or status in ('active', 'rotating')
  ),
  constraint site_credentials_revoked_by_check check (
    (revoked_at is null and revoked_by is null)
    or (revoked_at is not null and revoked_by is not null)
  )
);

create table public.used_nonces (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  credential_id uuid not null references public.site_credentials(id) on delete cascade,
  nonce_hash text not null,
  request_timestamp timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint used_nonces_expiry_check check (expires_at > request_timestamp)
);

create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  idempotency_key_hash text not null,
  request_hash text not null,
  status text not null,
  resource_type text null,
  resource_id uuid null,
  response_status integer null,
  response_body jsonb null,
  locked_until timestamptz null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint idempotency_records_status_check check (
    status in ('processing', 'completed', 'failed')
  ),
  constraint idempotency_records_response_status_check check (
    response_status is null or response_status between 100 and 599
  ),
  constraint idempotency_records_expiry_check check (expires_at > created_at)
);

create or replace function public.sanitize_audit_metadata(value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  result jsonb := '{}'::jsonb;
  item record;
  sanitized_array jsonb := '[]'::jsonb;
  array_item jsonb;
begin
  if value is null then
    return '{}'::jsonb;
  end if;

  if pg_column_size(value) > 32768 then
    return '{"truncated":true}'::jsonb;
  end if;

  if jsonb_typeof(value) = 'object' then
    for item in select key, value as nested_value from jsonb_each(value)
    loop
      if item.key ~* '(password|secret|client[_-]?secret|site[_-]?secret|token|access[_-]?token|refresh[_-]?token|authorization|cookie|set[_-]?cookie|signature|x[_-]?veridia[_-]?signature|supabase[_-]?service[_-]?role[_-]?key|ciphertext|(^|[_-])iv($|[_-])|auth(entication)?[_-]?tag|(^|[_-])tag($|[_-])|message|session|jwt|api[_-]?key|email|phone|address|ip)' then
        result := result || jsonb_build_object(item.key, '[REDACTED]');
      else
        result := result || jsonb_build_object(
          item.key,
          public.sanitize_audit_metadata(item.nested_value)
        );
      end if;
    end loop;
    return result;
  end if;

  if jsonb_typeof(value) = 'array' then
    for array_item in select jsonb_array_elements(value)
    loop
      sanitized_array := sanitized_array || jsonb_build_array(public.sanitize_audit_metadata(array_item));
    end loop;
    return sanitized_array;
  end if;

  return value;
exception
  when others then
    return '{"sanitization_error":true}'::jsonb;
end;
$$;

create index leads_organization_created_at_idx
  on public.leads (organization_id, created_at desc)
  where deleted_at is null;

create index leads_site_created_at_idx
  on public.leads (site_id, created_at desc)
  where deleted_at is null;

create index leads_organization_status_created_at_idx
  on public.leads (organization_id, status, created_at desc)
  where deleted_at is null;

create index leads_organization_assignee_status_idx
  on public.leads (organization_id, assigned_to, status)
  where deleted_at is null and assigned_to is not null;

create index leads_organization_phone_normalized_created_at_idx
  on public.leads (organization_id, phone_normalized, created_at desc)
  where deleted_at is null and phone_normalized is not null;

create index leads_organization_email_normalized_created_at_idx
  on public.leads (organization_id, email_normalized, created_at desc)
  where deleted_at is null and email_normalized is not null;

comment on index leads_organization_created_at_idx is
  'Supports tenant-scoped recent lead lists without indexing raw PII.';

comment on index leads_site_created_at_idx is
  'Supports site-scoped recent lead lookup used by backend lead workflows.';

comment on index leads_organization_status_created_at_idx is
  'Supports tenant dashboard/status queues while keeping raw PII out of keys.';

comment on index leads_organization_assignee_status_idx is
  'Supports agent work queues by assignee and status.';

comment on index leads_organization_phone_normalized_created_at_idx is
  'Supports duplicate detection with normalized phone; raw phone is not indexed.';

comment on index leads_organization_email_normalized_created_at_idx is
  'Supports duplicate detection with normalized email; raw email is not indexed.';

create index lead_attributions_organization_lead_idx
  on public.lead_attributions (organization_id, lead_id);

create index lead_status_history_organization_lead_created_at_idx
  on public.lead_status_history (organization_id, lead_id, created_at desc);

create index lead_notes_organization_lead_created_at_idx
  on public.lead_notes (organization_id, lead_id, created_at desc)
  where deleted_at is null;

create unique index site_credentials_one_active_per_site_idx
  on public.site_credentials (site_id)
  where status = 'active';

create unique index site_credentials_one_rotating_per_site_idx
  on public.site_credentials (site_id)
  where status = 'rotating';

create index site_credentials_lookup_idx
  on public.site_credentials (key_id, status, valid_from, valid_until);

create unique index used_nonces_credential_nonce_hash_key
  on public.used_nonces (credential_id, nonce_hash);

create index used_nonces_expires_at_idx
  on public.used_nonces (expires_at);

create unique index idempotency_records_site_key_hash_key
  on public.idempotency_records (site_id, idempotency_key_hash);

create index idempotency_records_locked_until_idx
  on public.idempotency_records (locked_until)
  where status = 'processing';

create index idempotency_records_expires_at_idx
  on public.idempotency_records (expires_at);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create trigger lead_attributions_set_updated_at
  before update on public.lead_attributions
  for each row execute function public.set_updated_at();

create trigger site_credentials_set_updated_at
  before update on public.site_credentials
  for each row execute function public.set_updated_at();

create trigger idempotency_records_set_updated_at
  before update on public.idempotency_records
  for each row execute function public.set_updated_at();

create or replace function public.lead_site_matches_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.sites s
    where s.id = new.site_id
      and s.organization_id = new.organization_id
  ) then
    raise exception 'site does not belong to organization'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.lead_assignment_is_allowed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.assigned_to is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = new.organization_id
      and om.user_id = new.assigned_to
      and om.role in ('organization_owner', 'agent')
  ) then
    raise exception 'lead assignee must be an owner or agent in the organization'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.lead_duplicate_is_same_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.duplicate_of is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.leads duplicate
    where duplicate.id = new.duplicate_of
      and duplicate.organization_id = new.organization_id
      and duplicate.id <> new.id
  ) then
    raise exception 'duplicate lead must belong to the same organization'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.lead_attribution_matches_lead()
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
      and l.site_id = new.site_id
  ) then
    raise exception 'attribution must match lead organization and site'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

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

  if auth.uid() is not null and new.changed_by <> auth.uid() then
    raise exception 'changed_by must match current user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.lead_note_matches_lead_and_author()
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
    raise exception 'note must match lead organization'
      using errcode = '23514';
  end if;

  if auth.uid() is not null and new.author_user_id <> auth.uid() then
    raise exception 'author_user_id must match current user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.site_credential_matches_site()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.sites s
    where s.id = new.site_id
      and s.organization_id = new.organization_id
  ) then
    raise exception 'credential must match site organization'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger leads_site_matches_organization
  before insert or update of organization_id, site_id on public.leads
  for each row execute function public.lead_site_matches_organization();

create trigger leads_assignment_is_allowed
  before insert or update of organization_id, assigned_to on public.leads
  for each row execute function public.lead_assignment_is_allowed();

create trigger leads_duplicate_is_same_organization
  before insert or update of organization_id, duplicate_of on public.leads
  for each row execute function public.lead_duplicate_is_same_organization();

create trigger lead_attributions_matches_lead
  before insert or update of lead_id, organization_id, site_id
  on public.lead_attributions
  for each row execute function public.lead_attribution_matches_lead();

create trigger lead_status_history_matches_lead_and_actor
  before insert on public.lead_status_history
  for each row execute function public.lead_history_matches_lead_and_actor();

create trigger lead_notes_matches_lead_and_author
  before insert on public.lead_notes
  for each row execute function public.lead_note_matches_lead_and_author();

create trigger site_credentials_matches_site
  before insert or update of site_id, organization_id
  on public.site_credentials
  for each row execute function public.site_credential_matches_site();

alter table public.leads enable row level security;
alter table public.lead_attributions enable row level security;
alter table public.lead_status_history enable row level security;
alter table public.lead_notes enable row level security;
alter table public.site_credentials enable row level security;
alter table public.used_nonces enable row level security;
alter table public.idempotency_records enable row level security;

create policy "members can read organization leads"
  on public.leads
  for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "members can read organization lead attributions"
  on public.lead_attributions
  for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "members can read organization lead status history"
  on public.lead_status_history
  for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "members can read organization lead notes"
  on public.lead_notes
  for select
  to authenticated
  using (public.is_org_member(organization_id) and deleted_at is null);

create policy "owners and agents can add lead notes"
  on public.lead_notes
  for insert
  to authenticated
  with check (
    public.is_org_member(organization_id, array['organization_owner', 'agent'])
    and author_user_id = auth.uid()
  );

revoke all on function public.lead_site_matches_organization() from public;
revoke all on function public.lead_assignment_is_allowed() from public;
revoke all on function public.lead_duplicate_is_same_organization() from public;
revoke all on function public.lead_attribution_matches_lead() from public;
revoke all on function public.lead_history_matches_lead_and_actor() from public;
revoke all on function public.lead_note_matches_lead_and_author() from public;
revoke all on function public.site_credential_matches_site() from public;
