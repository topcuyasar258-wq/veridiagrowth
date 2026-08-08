alter table public.site_domains
  add column if not exists status text not null default 'active',
  add column if not exists deleted_at timestamptz null;

alter table public.site_domains
  drop constraint if exists site_domains_normalized_domain_check,
  add constraint site_domains_status_check check (status in ('active', 'inactive', 'deleted')),
  add constraint site_domains_deleted_at_check check (
    (status = 'deleted' and deleted_at is not null)
    or (status <> 'deleted' and deleted_at is null)
  ),
  add constraint site_domains_normalized_domain_check check (
    normalized_domain = lower(trim(both from normalized_domain))
    and normalized_domain !~ '^https?://'
    and normalized_domain !~ '^www\.'
    and normalized_domain !~ '[:/?#]'
  );

drop index if exists public.site_domains_normalized_domain_key;

create unique index if not exists site_domains_active_normalized_domain_key
  on public.site_domains (normalized_domain)
  where status = 'active' and deleted_at is null;

create or replace function public.normalize_domain(input_domain text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(trim(both from coalesce(input_domain, ''))),
          '^https?://',
          ''
        ),
        '^www\.',
        ''
      ),
      '[:/?#].*$',
      ''
    ),
    ''
  );
$$;

create or replace function public.normalize_site_domain()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.normalized_domain = public.normalize_domain(coalesce(new.domain, new.normalized_domain));

  if new.normalized_domain is null then
    raise exception 'site domain cannot be normalized'
      using errcode = '22023';
  end if;

  if new.status = 'deleted' and new.deleted_at is null then
    new.deleted_at = now();
  end if;

  if new.status <> 'deleted' then
    new.deleted_at = null;
  end if;

  return new;
end;
$$;

create or replace function public.is_org_member(
  target_organization_id uuid,
  allowed_roles text[] default array['organization_owner', 'agent', 'viewer']
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
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
set search_path = pg_catalog, public
as $$
  select public.is_org_member(target_organization_id, array['organization_owner']);
$$;

create or replace function public.site_belongs_to_visible_org(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
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
set search_path = pg_catalog, public
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
      if item.key ~* '(password|secret|client[_-]?secret|site[_-]?secret|token|access[_-]?token|refresh[_-]?token|authorization|cookie|set[_-]?cookie|signature|x[_-]?veridia[_-]?signature|supabase[_-]?service[_-]?role[_-]?key|session|jwt|api[_-]?key|email|phone|address|ip)' then
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

create or replace function public.sanitize_audit_log_metadata()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.metadata = public.sanitize_audit_metadata(new.metadata);
  return new;
end;
$$;

create or replace function public.prevent_last_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  remaining_owner_count integer;
begin
  if tg_op = 'DELETE' and old.role = 'organization_owner' then
    select count(*) into remaining_owner_count
    from public.organization_members om
    where om.organization_id = old.organization_id
      and om.role = 'organization_owner'
      and om.id <> old.id;

    if remaining_owner_count = 0 then
      raise exception 'organization must retain at least one owner'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and old.role = 'organization_owner'
    and new.role <> 'organization_owner'
  then
    select count(*) into remaining_owner_count
    from public.organization_members om
    where om.organization_id = old.organization_id
      and om.role = 'organization_owner'
      and om.id <> old.id;

    if remaining_owner_count = 0 then
      raise exception 'organization must retain at least one owner'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;

  return old;
end;
$$;

drop trigger if exists organization_members_prevent_last_owner_delete
  on public.organization_members;
drop trigger if exists organization_members_prevent_last_owner_update
  on public.organization_members;

create trigger organization_members_prevent_last_owner_delete
  before delete on public.organization_members
  for each row execute function public.prevent_last_owner_removal();

create trigger organization_members_prevent_last_owner_update
  before update of role on public.organization_members
  for each row execute function public.prevent_last_owner_removal();

revoke all on function public.normalize_domain(text) from public;
revoke all on function public.is_org_member(uuid, text[]) from public;
revoke all on function public.is_org_owner(uuid) from public;
revoke all on function public.site_belongs_to_visible_org(uuid) from public;
revoke all on function public.site_belongs_to_owned_org(uuid) from public;
revoke all on function public.sanitize_audit_metadata(jsonb) from public;
revoke all on function public.prevent_last_owner_removal() from public;

grant execute on function public.normalize_domain(text) to authenticated, service_role;
grant execute on function public.is_org_member(uuid, text[]) to authenticated, service_role;
grant execute on function public.is_org_owner(uuid) to authenticated, service_role;
grant execute on function public.site_belongs_to_visible_org(uuid) to authenticated, service_role;
grant execute on function public.site_belongs_to_owned_org(uuid) to authenticated, service_role;
grant execute on function public.sanitize_audit_metadata(jsonb) to service_role;
