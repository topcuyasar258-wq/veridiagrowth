-- prevent_last_owner_removal() blocked every organization delete.
--
-- The guard exists to stop an organization from losing its last owner while it
-- is still alive. It fired on every organization_members DELETE, including the
-- rows removed by the ON DELETE CASCADE of the parent organization. That made
-- `delete from public.organizations` fail with
-- 'organization must retain at least one owner', so no organization could ever
-- be deleted -- neither an acceptance fixture nor a real offboarded customer.
--
-- PostgreSQL deletes the parent row before cascading to children, so inside the
-- cascade the organizations row is already gone in this transaction. Skipping
-- the guard when the parent no longer exists keeps the live-organization
-- protection intact while allowing whole-organization deletion.

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
    -- Parent organization already removed: this DELETE is part of the cascade.
    if not exists (
      select 1
      from public.organizations o
      where o.id = old.organization_id
    ) then
      return old;
    end if;

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
