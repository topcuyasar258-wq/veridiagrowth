begin;

create extension if not exists pgtap;

select plan(28);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'agent-a@example.test', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'viewer-a@example.test', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'second-owner-a@example.test', '', now(), now(), now());

insert into public.organizations (id, name, slug, status)
values
  ('10000000-0000-0000-0000-000000000001', 'Organization A', 'org-a', 'active'),
  ('10000000-0000-0000-0000-000000000002', 'Organization B', 'org-b', 'active');

insert into public.organization_members (id, organization_id, user_id, role)
values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'organization_owner'),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'agent'),
  ('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'viewer'),
  ('11000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'organization_owner');

insert into public.sites (id, organization_id, name, status)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Site A', 'active'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Site B', 'active');

insert into public.site_domains (id, site_id, domain, normalized_domain, is_primary)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'https://www.example.com/', 'example.com', true),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'tenant-b.test', 'tenant-b.test', true);

select is(
  (select proconfig from pg_proc where oid = 'public.is_org_member(uuid,text[])'::regprocedure),
  array['search_path=pg_catalog, public'],
  'SECURITY DEFINER membership helper uses a safe search_path'
);

select is(
  has_function_privilege('anon', 'public.is_org_member(uuid,text[])', 'execute'),
  false,
  'Anon cannot directly execute membership helper'
);

select is(
  has_function_privilege('authenticated', 'public.is_org_member(uuid,text[])', 'execute'),
  true,
  'Authenticated role can execute membership helper for policy evaluation'
);

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_get_function_arguments(p.oid) ~* 'user_id uuid|target_user_id|actor_user_id'
  ),
  0,
  'SECURITY DEFINER helpers do not accept arbitrary user id parameters'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select is(
  (select count(*)::integer from public.organizations),
  0,
  'Unauthenticated user cannot read organizations'
);

select is(
  (select count(*)::integer from public.sites),
  0,
  'Unauthenticated user cannot read sites'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

select is(
  (select count(*)::integer from public.organizations where slug = 'org-b'),
  0,
  'Organization A user cannot read Organization B'
);

select is(
  (select count(*)::integer from public.organization_members where organization_id = '10000000-0000-0000-0000-000000000002'),
  0,
  'Organization A user cannot read Organization B memberships'
);

select is(
  (select count(*)::integer from public.sites where organization_id = '10000000-0000-0000-0000-000000000002'),
  0,
  'Organization A user cannot read Organization B sites'
);

select is(
  (select count(*)::integer from public.site_domains where id = '30000000-0000-0000-0000-000000000002'),
  0,
  'Organization A user cannot read Organization B domains'
);

update public.sites
set name = 'Updated by wrong tenant'
where id = '20000000-0000-0000-0000-000000000002';

reset role;
select is(
  (select name from public.sites where id = '20000000-0000-0000-0000-000000000002'),
  'Site B',
  'Organization A user cannot update Organization B site'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

delete from public.sites
where id = '20000000-0000-0000-0000-000000000002';

reset role;
select is(
  (select count(*)::integer from public.sites where id = '20000000-0000-0000-0000-000000000002'),
  1,
  'Organization A user cannot delete Organization B site'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

update public.site_domains
set is_primary = false
where id = '30000000-0000-0000-0000-000000000002';

reset role;
select is(
  (select is_primary from public.site_domains where id = '30000000-0000-0000-0000-000000000002'),
  true,
  'Organization A user cannot update Organization B domain'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

delete from public.site_domains
where id = '30000000-0000-0000-0000-000000000002';

reset role;
select is(
  (select count(*)::integer from public.site_domains where id = '30000000-0000-0000-0000-000000000002'),
  1,
  'Organization A user cannot delete Organization B domain'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$ insert into public.sites (organization_id, name, status)
     values ('10000000-0000-0000-0000-000000000001', 'Viewer Site', 'active') $$,
  '42501',
  null,
  'Viewer cannot create a site'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role)
     values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'viewer') $$,
  '42501',
  null,
  'Agent cannot create memberships'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$ insert into public.sites (id, organization_id, name, status)
     values ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Owner Site', 'active') $$,
  'Owner can add a site to own organization'
);

select throws_ok(
  $$ insert into public.sites (organization_id, name, status)
     values ('10000000-0000-0000-0000-000000000002', 'Wrong Org Site', 'active') $$,
  '42501',
  null,
  'Owner cannot add a site to another organization'
);

select throws_ok(
  $$ delete from public.organization_members
     where id = '11000000-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'Single owner cannot delete their own owner membership'
);

select throws_ok(
  $$ update public.organization_members
     set role = 'agent'
     where id = '11000000-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'Single owner cannot demote the last owner'
);

select lives_ok(
  $$ insert into public.organization_members (id, organization_id, user_id, role)
     values ('11000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'organization_owner') $$,
  'Owner can add a second owner'
);

select lives_ok(
  $$ update public.organization_members
     set role = 'viewer'
     where id = '11000000-0000-0000-0000-000000000005' $$,
  'One of two owners can be demoted'
);

select throws_ok(
  $$ insert into public.site_domains (site_id, domain, normalized_domain, is_primary)
     values ('20000000-0000-0000-0000-000000000003', 'example.com', 'example.com', false) $$,
  '23505',
  null,
  'Two active domains cannot share a normalized domain'
);

update public.site_domains
set status = 'inactive'
where id = '30000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ insert into public.site_domains (site_id, domain, normalized_domain, is_primary)
     values ('20000000-0000-0000-0000-000000000003', 'example.com', 'example.com', true) $$,
  'Inactive domain can be reassigned'
);

select is(
  (
    select normalized_domain
    from public.site_domains
    where domain = 'example.com'
    order by created_at desc
    limit 1
  ),
  'example.com',
  'Domain normalization is deterministic'
);

reset role;

insert into public.audit_logs (organization_id, action, entity_type, metadata)
values (
  '10000000-0000-0000-0000-000000000001',
  'test.audit',
  'site',
  '{"token":"raw","nested":{"api_secret":"raw","value":"safe"},"x-veridia-signature":"raw"}'::jsonb
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

select is(
  (select count(*)::integer from public.audit_logs),
  0,
  'Customer user cannot read audit logs'
);

reset role;

select is(
  (
    select metadata
    from public.audit_logs
    where action = 'test.audit'
    limit 1
  ),
  '{"token":"[REDACTED]","nested":{"api_secret":"[REDACTED]","value":"safe"},"x-veridia-signature":"[REDACTED]"}'::jsonb,
  'SQL audit metadata sanitizer masks token, secret, and signature fields'
);

set local role service_role;

select is(
  (select count(*)::integer from public.organizations),
  2,
  'Service role can bypass tenant RLS in controlled database tests'
);

select * from finish();

rollback;
