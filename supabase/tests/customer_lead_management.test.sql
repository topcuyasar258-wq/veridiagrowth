begin;

create extension if not exists pgtap;

select plan(20);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('08000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'dash-owner-a@example.test', '', now(), now(), now()),
  ('08000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'dash-agent-a@example.test', '', now(), now(), now()),
  ('08000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'dash-viewer-a@example.test', '', now(), now(), now()),
  ('08000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'dash-agent-b@example.test', '', now(), now(), now()),
  ('08000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'dash-owner-b@example.test', '', now(), now(), now());

insert into public.organizations (id, name, slug, status)
values
  ('18000000-0000-0000-0000-000000000001', 'Dashboard Organization A', 'dashboard-org-a', 'active'),
  ('18000000-0000-0000-0000-000000000002', 'Dashboard Organization B', 'dashboard-org-b', 'active');

insert into public.organization_members (organization_id, user_id, role)
values
  ('18000000-0000-0000-0000-000000000001', '08000000-0000-0000-0000-000000000001', 'organization_owner'),
  ('18000000-0000-0000-0000-000000000001', '08000000-0000-0000-0000-000000000002', 'agent'),
  ('18000000-0000-0000-0000-000000000001', '08000000-0000-0000-0000-000000000003', 'viewer'),
  ('18000000-0000-0000-0000-000000000002', '08000000-0000-0000-0000-000000000004', 'agent'),
  ('18000000-0000-0000-0000-000000000002', '08000000-0000-0000-0000-000000000005', 'organization_owner');

insert into public.sites (id, organization_id, name, status)
values
  ('28000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001', 'Dashboard Site A', 'active'),
  ('28000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000002', 'Dashboard Site B', 'active');

insert into public.leads (
  id,
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
  status,
  assigned_to,
  source_category,
  is_duplicate,
  is_suspicious,
  suspicion_reasons
)
values
  (
    '48000000-0000-0000-0000-000000000001',
    '18000000-0000-0000-0000-000000000001',
    '28000000-0000-0000-0000-000000000001',
    'Ahmet',
    'Yilmaz',
    '0532 111 22 33',
    '+905321112233',
    'ahmet@example.test',
    'ahmet@example.test',
    'Statik Proje',
    'Istanbul',
    'new',
    null,
    'paid_search',
    false,
    true,
    array['rate_limit']
  ),
  (
    '48000000-0000-0000-0000-000000000002',
    '18000000-0000-0000-0000-000000000001',
    '28000000-0000-0000-0000-000000000001',
    'Mehmet',
    'Kaya',
    null,
    null,
    'mehmet@example.test',
    'mehmet@example.test',
    'Kentsel Donusum',
    'Ankara',
    'new',
    null,
    'organic',
    true,
    false,
    '{}'
  ),
  (
    '48000000-0000-0000-0000-000000000003',
    '18000000-0000-0000-0000-000000000002',
    '28000000-0000-0000-0000-000000000002',
    'Tenant',
    'B',
    null,
    null,
    'tenant-b-dashboard@example.test',
    'tenant-b-dashboard@example.test',
    'B Service',
    'Izmir',
    'new',
    null,
    'unknown',
    false,
    false,
    '{}'
  );

insert into public.lead_attributions (lead_id, organization_id, site_id, landing_page, utm_source, source_category)
values
  ('48000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001', 'https://example.test/landing', 'google', 'paid_search'),
  ('48000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001', 'https://example.test/organic', null, 'organic'),
  ('48000000-0000-0000-0000-000000000003', '18000000-0000-0000-0000-000000000002', '28000000-0000-0000-0000-000000000002', 'https://other.test', null, 'unknown');

set local role authenticated;
select set_config('request.jwt.claim.sub', '08000000-0000-0000-0000-000000000001', true);

select is((select count(*)::integer from public.leads), 2, 'Owner sees only own organization leads');
select is((select count(*)::integer from public.leads where is_suspicious), 1, 'Suspicious indicator is visible to tenant members');
select is((select count(*)::integer from public.lead_attributions where source_category = 'paid_search'), 1, 'Attribution source is tenant scoped');
select is((select count(*)::integer from public.leads where lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(email_normalized, '') || ' ' || coalesce(service, '') || ' ' || coalesce(city, '')) like '%ahmet%'), 1, 'Tenant search fields find matching lead');
select is((select count(*)::integer from public.leads where source_category = 'organic'), 1, 'Tenant source filter returns matching lead');

select lives_ok(
  $$ select public.update_customer_lead_status('48000000-0000-0000-0000-000000000001', 1, 'contacted', 'Arandi') $$,
  'Owner can update lead status'
);

select is((select status from public.leads where id = '48000000-0000-0000-0000-000000000001'), 'contacted', 'Status update persists');
select is((select version from public.leads where id = '48000000-0000-0000-0000-000000000001'), 2, 'Status update increments version');
select is((select count(*)::integer from public.lead_status_history where lead_id = '48000000-0000-0000-0000-000000000001' and new_status = 'contacted'), 1, 'Status update writes history');
reset role;
set local role service_role;
select is((select count(*)::integer from public.audit_logs where action = 'lead.status_changed' and entity_id = '48000000-0000-0000-0000-000000000001'), 1, 'Status update writes audit log');

set local role authenticated;
select set_config('request.jwt.claim.sub', '08000000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$ select public.update_customer_lead_status('48000000-0000-0000-0000-000000000001', 1, 'offer_sent', null) $$,
  '40001',
  null,
  'Stale status update is rejected'
);

select lives_ok(
  $$ select public.add_customer_lead_note('48000000-0000-0000-0000-000000000001', 'Pazartesi tekrar aranacak.') $$,
  'Owner can add append-only note'
);

select is((select body from public.lead_notes where lead_id = '48000000-0000-0000-0000-000000000001' order by created_at desc limit 1), 'Pazartesi tekrar aranacak.', 'Note body is trimmed and stored');

select lives_ok(
  $$ select public.assign_customer_lead('48000000-0000-0000-0000-000000000001', 3, '08000000-0000-0000-0000-000000000002') $$,
  'Owner can assign an agent'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '08000000-0000-0000-0000-000000000002', true);

select lives_ok(
  $$ select public.assign_customer_lead('48000000-0000-0000-0000-000000000002', 1, '08000000-0000-0000-0000-000000000002') $$,
  'Agent can self-assign'
);

select throws_ok(
  $$ select public.assign_customer_lead('48000000-0000-0000-0000-000000000002', 2, '08000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'Agent cannot assign another member'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '08000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$ select public.update_customer_lead_status('48000000-0000-0000-0000-000000000001', 4, 'offer_sent', null) $$,
  '42501',
  null,
  'Viewer cannot update status'
);

select throws_ok(
  $$ select public.add_customer_lead_note('48000000-0000-0000-0000-000000000001', 'Viewer note') $$,
  '42501',
  null,
  'Viewer cannot add notes'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '08000000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$ select public.assign_customer_lead('48000000-0000-0000-0000-000000000001', 4, '08000000-0000-0000-0000-000000000003') $$,
  '42501',
  null,
  'Owner cannot assign viewer'
);

select throws_ok(
  $$ select public.add_customer_lead_note('48000000-0000-0000-0000-000000000003', 'Cross tenant') $$,
  '02000',
  null,
  'Cross-tenant lead behaves as not found'
);

select * from finish();

rollback;
