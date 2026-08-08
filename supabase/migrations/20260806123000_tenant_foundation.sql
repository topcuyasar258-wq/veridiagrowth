create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_status_check check (status in ('active', 'suspended', 'archived')),
  constraint organizations_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_members_role_check check (
    role in ('organization_owner', 'agent', 'viewer')
  ),
  constraint organization_members_unique_user_per_org unique (organization_id, user_id)
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sites_status_check check (status in ('active', 'paused', 'archived'))
);

create table public.site_domains (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  domain text not null,
  normalized_domain text not null,
  is_primary boolean not null default false,
  verified_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint site_domains_normalized_domain_check check (
    normalized_domain = lower(trim(both from normalized_domain))
    and normalized_domain !~ '^https?://'
    and normalized_domain !~ '/'
  )
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete set null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index site_domains_normalized_domain_key
  on public.site_domains (normalized_domain);

create index organization_members_user_id_idx
  on public.organization_members (user_id);

create index sites_organization_id_idx
  on public.sites (organization_id);

create index site_domains_site_id_idx
  on public.site_domains (site_id);

create index audit_logs_organization_id_idx
  on public.audit_logs (organization_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger organization_members_set_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();

create trigger sites_set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

create or replace function public.normalize_site_domain()
returns trigger
language plpgsql
as $$
begin
  new.normalized_domain = lower(trim(both from new.normalized_domain));
  return new;
end;
$$;

create trigger site_domains_normalize_domain
  before insert or update on public.site_domains
  for each row execute function public.normalize_site_domain();

create or replace function public.is_org_member(
  target_organization_id uuid,
  allowed_roles text[] default array['organization_owner', 'agent', 'viewer']
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_organization_id
      and om.user_id = auth.uid()
      and om.role = any(allowed_roles)
  );
$$;

create or replace function public.is_org_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(target_organization_id, array['organization_owner']);
$$;

create or replace function public.site_belongs_to_visible_org(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sites s
    where s.id = target_site_id
      and public.is_org_member(s.organization_id)
  );
$$;

create or replace function public.site_belongs_to_owned_org(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sites s
    where s.id = target_site_id
      and public.is_org_owner(s.organization_id)
  );
$$;

create or replace function public.sanitize_audit_metadata(value jsonb)
returns jsonb
language plpgsql
immutable
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

  if jsonb_typeof(value) = 'object' then
    for item in select key, value as nested_value from jsonb_each(value)
    loop
      if item.key ~* '(secret|token|cookie|password|passwd|authorization|auth|session|jwt|api[_-]?key|email|phone|name|address|ip)' then
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
end;
$$;

create or replace function public.sanitize_audit_log_metadata()
returns trigger
language plpgsql
as $$
begin
  new.metadata = public.sanitize_audit_metadata(new.metadata);
  return new;
end;
$$;

create trigger audit_logs_sanitize_metadata
  before insert or update on public.audit_logs
  for each row execute function public.sanitize_audit_log_metadata();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.sites enable row level security;
alter table public.site_domains enable row level security;
alter table public.audit_logs enable row level security;

create policy "members can read their organizations"
  on public.organizations
  for select
  to authenticated
  using (public.is_org_member(id));

create policy "owners can update their organizations"
  on public.organizations
  for update
  to authenticated
  using (public.is_org_owner(id))
  with check (public.is_org_owner(id));

create policy "members can read memberships in their organizations"
  on public.organization_members
  for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "owners can create memberships"
  on public.organization_members
  for insert
  to authenticated
  with check (public.is_org_owner(organization_id));

create policy "owners can update memberships"
  on public.organization_members
  for update
  to authenticated
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

create policy "owners can delete memberships"
  on public.organization_members
  for delete
  to authenticated
  using (public.is_org_owner(organization_id));

create policy "members can read organization sites"
  on public.sites
  for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "owners can create organization sites"
  on public.sites
  for insert
  to authenticated
  with check (public.is_org_owner(organization_id));

create policy "owners can update organization sites"
  on public.sites
  for update
  to authenticated
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

create policy "owners can delete organization sites"
  on public.sites
  for delete
  to authenticated
  using (public.is_org_owner(organization_id));

create policy "members can read organization site domains"
  on public.site_domains
  for select
  to authenticated
  using (public.site_belongs_to_visible_org(site_id));

create policy "owners can create organization site domains"
  on public.site_domains
  for insert
  to authenticated
  with check (public.site_belongs_to_owned_org(site_id));

create policy "owners can update organization site domains"
  on public.site_domains
  for update
  to authenticated
  using (public.site_belongs_to_owned_org(site_id))
  with check (public.site_belongs_to_owned_org(site_id));

create policy "owners can delete organization site domains"
  on public.site_domains
  for delete
  to authenticated
  using (public.site_belongs_to_owned_org(site_id));

revoke all on function public.is_org_member(uuid, text[]) from public;
revoke all on function public.is_org_owner(uuid) from public;
revoke all on function public.site_belongs_to_visible_org(uuid) from public;
revoke all on function public.site_belongs_to_owned_org(uuid) from public;
grant execute on function public.is_org_member(uuid, text[]) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;
grant execute on function public.site_belongs_to_visible_org(uuid) to authenticated;
grant execute on function public.site_belongs_to_owned_org(uuid) to authenticated;
