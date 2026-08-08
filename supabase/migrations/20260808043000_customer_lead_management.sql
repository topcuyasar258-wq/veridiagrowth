create index if not exists leads_organization_created_id_idx
  on public.leads (organization_id, created_at desc, id desc)
  where deleted_at is null;

create index if not exists leads_organization_source_created_id_idx
  on public.leads (organization_id, source_category, created_at desc, id desc)
  where deleted_at is null;

create or replace function public.require_lead_customer_actor(target_lead_id uuid)
returns table (
  actor_user_id uuid,
  actor_role text,
  target_organization_id uuid,
  current_version integer
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  return query
  select
    auth.uid(),
    om.role,
    l.organization_id,
    l.version
  from public.leads l
  join public.organization_members om
    on om.organization_id = l.organization_id
   and om.user_id = auth.uid()
  where l.id = target_lead_id
    and l.deleted_at is null
    and om.role in ('organization_owner', 'agent', 'viewer')
  limit 1;
end;
$$;

create or replace function public.update_customer_lead_status(
  target_lead_id uuid,
  expected_version integer,
  next_status text,
  status_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor record;
  current_lead public.leads%rowtype;
  clean_note text := nullif(trim(coalesce(status_note, '')), '');
  next_version integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if next_status not in ('new', 'contacted', 'offer_sent', 'won', 'lost') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  if clean_note is not null and length(clean_note) > 2000 then
    raise exception 'status note is too long' using errcode = '22023';
  end if;

  select * into current_lead
  from public.leads
  where id = target_lead_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'lead not found' using errcode = '02000';
  end if;

  select * into actor
  from public.require_lead_customer_actor(target_lead_id);

  if not found then
    raise exception 'lead not found' using errcode = '02000';
  end if;

  if actor.actor_role not in ('organization_owner', 'agent') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if current_lead.version <> expected_version then
    raise exception 'stale lead version' using errcode = '40001';
  end if;

  next_version := current_lead.version + 1;

  update public.leads
  set status = next_status,
      version = next_version,
      last_activity_at = now()
  where id = target_lead_id;

  insert into public.lead_status_history (
    organization_id,
    lead_id,
    old_status,
    new_status,
    actor_type,
    actor_user_id,
    assigned_to,
    note
  )
  values (
    current_lead.organization_id,
    current_lead.id,
    current_lead.status,
    next_status,
    'user',
    auth.uid(),
    current_lead.assigned_to,
    clean_note
  );

  insert into public.audit_logs (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_lead.organization_id,
    auth.uid(),
    'lead.status_changed',
    'lead',
    current_lead.id,
    public.sanitize_audit_metadata(jsonb_build_object(
      'oldStatus', current_lead.status,
      'newStatus', next_status,
      'version', next_version
    ))
  );

  return jsonb_build_object(
    'leadId', current_lead.id,
    'status', next_status,
    'version', next_version
  );
end;
$$;

create or replace function public.add_customer_lead_note(
  target_lead_id uuid,
  note_body text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor record;
  current_lead public.leads%rowtype;
  clean_body text := trim(coalesce(note_body, ''));
  inserted_note_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if length(clean_body) = 0 or length(clean_body) > 5000 then
    raise exception 'invalid note body' using errcode = '22023';
  end if;

  select * into current_lead
  from public.leads
  where id = target_lead_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'lead not found' using errcode = '02000';
  end if;

  select * into actor
  from public.require_lead_customer_actor(target_lead_id);

  if not found then
    raise exception 'lead not found' using errcode = '02000';
  end if;

  if actor.actor_role not in ('organization_owner', 'agent') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.lead_notes (
    organization_id,
    lead_id,
    author_user_id,
    body
  )
  values (
    current_lead.organization_id,
    current_lead.id,
    auth.uid(),
    clean_body
  )
  returning id into inserted_note_id;

  update public.leads
  set last_activity_at = now(),
      version = version + 1
  where id = target_lead_id;

  insert into public.audit_logs (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_lead.organization_id,
    auth.uid(),
    'lead.note_added',
    'lead',
    current_lead.id,
    public.sanitize_audit_metadata(jsonb_build_object(
      'noteId', inserted_note_id,
      'bodyLength', length(clean_body)
    ))
  );

  return jsonb_build_object(
    'leadId', current_lead.id,
    'noteId', inserted_note_id
  );
end;
$$;

create or replace function public.assign_customer_lead(
  target_lead_id uuid,
  expected_version integer,
  assignee_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor record;
  current_lead public.leads%rowtype;
  target_role text;
  next_version integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into current_lead
  from public.leads
  where id = target_lead_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'lead not found' using errcode = '02000';
  end if;

  select * into actor
  from public.require_lead_customer_actor(target_lead_id);

  if not found then
    raise exception 'lead not found' using errcode = '02000';
  end if;

  if actor.actor_role not in ('organization_owner', 'agent') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if current_lead.version <> expected_version then
    raise exception 'stale lead version' using errcode = '40001';
  end if;

  if assignee_user_id is null then
    if actor.actor_role <> 'organization_owner'
       and current_lead.assigned_to is distinct from auth.uid() then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  else
    select role into target_role
    from public.organization_members
    where organization_id = current_lead.organization_id
      and user_id = assignee_user_id
      and role in ('organization_owner', 'agent');

    if target_role is null then
      raise exception 'invalid assignee' using errcode = '42501';
    end if;

    if actor.actor_role = 'agent' and assignee_user_id <> auth.uid() then
      raise exception 'agents can only self-assign' using errcode = '42501';
    end if;
  end if;

  next_version := current_lead.version + 1;

  update public.leads
  set assigned_to = assignee_user_id,
      version = next_version,
      last_activity_at = now()
  where id = target_lead_id;

  insert into public.audit_logs (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_lead.organization_id,
    auth.uid(),
    case when assignee_user_id is null then 'lead.unassigned' else 'lead.assigned' end,
    'lead',
    current_lead.id,
    public.sanitize_audit_metadata(jsonb_build_object(
      'assignmentChanged', true,
      'version', next_version
    ))
  );

  return jsonb_build_object(
    'leadId', current_lead.id,
    'assignedTo', assignee_user_id,
    'version', next_version
  );
end;
$$;

create or replace function public.list_customer_leads(
  target_organization_id uuid,
  search_query text default null,
  status_filter text default null,
  source_filter text default null,
  assignee_filter uuid default null,
  unassigned_only boolean default false,
  site_filter uuid default null,
  created_after timestamptz default null,
  page_limit integer default 25,
  page_offset integer default 0
)
returns table (
  id uuid,
  organization_id uuid,
  site_id uuid,
  first_name text,
  last_name text,
  phone text,
  phone_normalized text,
  email text,
  service text,
  city text,
  status text,
  assigned_to uuid,
  is_duplicate boolean,
  duplicate_of uuid,
  is_suspicious boolean,
  suspicion_reasons text[],
  source_category text,
  version integer,
  last_activity_at timestamptz,
  created_at timestamptz,
  total_count bigint
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  with scoped as (
    select l.*
    from public.leads l
    where l.organization_id = target_organization_id
      and l.deleted_at is null
      and public.is_org_member(target_organization_id)
      and (status_filter is null or l.status = status_filter)
      and (source_filter is null or l.source_category = source_filter)
      and (assignee_filter is null or l.assigned_to = assignee_filter)
      and (unassigned_only is false or l.assigned_to is null)
      and (site_filter is null or l.site_id = site_filter)
      and (created_after is null or l.created_at >= created_after)
      and (
        nullif(trim(coalesce(search_query, '')), '') is null
        or length(trim(search_query)) < 2
        or lower(
          coalesce(l.first_name, '') || ' ' ||
          coalesce(l.last_name, '') || ' ' ||
          coalesce(l.phone_normalized, '') || ' ' ||
          coalesce(l.email_normalized, '') || ' ' ||
          coalesce(l.service, '') || ' ' ||
          coalesce(l.city, '')
        ) like '%' || lower(trim(search_query)) || '%'
      )
  ),
  counted as (
    select scoped.*, count(*) over () as total_count
    from scoped
  )
  select
    counted.id,
    counted.organization_id,
    counted.site_id,
    counted.first_name,
    counted.last_name,
    counted.phone,
    counted.phone_normalized,
    counted.email,
    counted.service,
    counted.city,
    counted.status,
    counted.assigned_to,
    counted.is_duplicate,
    counted.duplicate_of,
    counted.is_suspicious,
    counted.suspicion_reasons,
    counted.source_category,
    counted.version,
    counted.last_activity_at,
    counted.created_at,
    counted.total_count
  from counted
  order by counted.created_at desc, counted.id desc
  limit greatest(1, least(page_limit, 25))
  offset greatest(0, page_offset);
$$;

revoke all on function public.require_lead_customer_actor(uuid) from public;
revoke all on function public.update_customer_lead_status(uuid, integer, text, text) from public;
revoke all on function public.add_customer_lead_note(uuid, text) from public;
revoke all on function public.assign_customer_lead(uuid, integer, uuid) from public;
revoke all on function public.list_customer_leads(uuid, text, text, text, uuid, boolean, uuid, timestamptz, integer, integer) from public;

grant execute on function public.update_customer_lead_status(uuid, integer, text, text) to authenticated;
grant execute on function public.add_customer_lead_note(uuid, text) to authenticated;
grant execute on function public.assign_customer_lead(uuid, integer, uuid) to authenticated;
grant execute on function public.list_customer_leads(uuid, text, text, text, uuid, boolean, uuid, timestamptz, integer, integer) to authenticated;
