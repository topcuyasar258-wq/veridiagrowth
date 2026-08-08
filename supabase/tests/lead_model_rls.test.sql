begin;

create extension if not exists pgtap;

select plan(13);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('01000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'lead-owner-a@example.test', '', now(), now(), now()),
  ('01000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'lead-agent-a@example.test', '', now(), now(), now()),
  ('01000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'lead-viewer-a@example.test', '', now(), now(), now()),
  ('01000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'lead-owner-b@example.test', '', now(), now(), now());

insert into public.organizations (id, name, slug, status)
values
  ('12000000-0000-0000-0000-000000000001', 'Lead Organization A', 'lead-org-a', 'active'),
  ('12000000-0000-0000-0000-000000000002', 'Lead Organization B', 'lead-org-b', 'active');

insert into public.organization_members (organization_id, user_id, role)
values
  ('12000000-0000-0000-0000-000000000001', '01000000-0000-0000-0000-000000000001', 'organization_owner'),
  ('12000000-0000-0000-0000-000000000001', '01000000-0000-0000-0000-000000000002', 'agent'),
  ('12000000-0000-0000-0000-000000000001', '01000000-0000-0000-0000-000000000003', 'viewer'),
  ('12000000-0000-0000-0000-000000000002', '01000000-0000-0000-0000-000000000004', 'organization_owner');

insert into public.sites (id, organization_id, name, status)
values
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'Lead Site A', 'active'),
  ('22000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000002', 'Lead Site B', 'active');

insert into public.leads (
  id,
  organization_id,
  site_id,
  phone,
  phone_normalized,
  email,
  email_normalized,
  status,
  assigned_to,
  source_category
)
values
  (
    '40000000-0000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000001',
    '22000000-0000-0000-0000-000000000001',
    '0532 123 45 67',
    '+905321234567',
    null,
    null,
    'new',
    '01000000-0000-0000-0000-000000000002',
    'unknown'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '12000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002',
    null,
    null,
    'tenant-b@example.test',
    'tenant-b@example.test',
    'new',
    null,
    'unknown'
  );

insert into public.lead_attributions (lead_id, organization_id, site_id, landing_page)
values
  ('40000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'https://example.test/a'),
  ('40000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000002', 'https://example.test/b');

insert into public.site_credentials (
  id,
  site_id,
  organization_id,
  key_id,
  secret_ciphertext,
  secret_fingerprint,
  status,
  created_by
)
values (
  '50000000-0000-0000-0000-000000000001',
  '22000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'site_test',
  '{"algorithm":"AES-256-GCM","version":1,"keyVersion":"v1","iv":"safe","tag":"safe","ciphertext":"safe"}',
  'fingerprint',
  'active',
  '01000000-0000-0000-0000-000000000001'
);

insert into public.used_nonces (site_id, credential_id, nonce_hash, request_timestamp, expires_at)
values (
  '22000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  'nonce-hash',
  now(),
  now() + interval '15 minutes'
);

insert into public.idempotency_records (
  site_id,
  idempotency_key_hash,
  request_hash,
  status,
  locked_until,
  expires_at
)
values (
  '22000000-0000-0000-0000-000000000001',
  'key-hash',
  'request-hash',
  'processing',
  now() + interval '30 seconds',
  now() + interval '24 hours'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select is((select count(*)::integer from public.leads), 0, 'Unauthenticated user cannot read leads');

set local role authenticated;
select set_config('request.jwt.claim.sub', '01000000-0000-0000-0000-000000000001', true);

select is(
  (select count(*)::integer from public.leads where organization_id = '12000000-0000-0000-0000-000000000002'),
  0,
  'Organization A cannot read Organization B leads'
);

select is(
  (select count(*)::integer from public.lead_attributions where organization_id = '12000000-0000-0000-0000-000000000002'),
  0,
  'Organization A cannot read Organization B attribution'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '01000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$ insert into public.leads (organization_id, site_id, email)
     values ('12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'viewer@example.test') $$,
  '42501',
  null,
  'Viewer cannot mutate leads'
);

select throws_ok(
  $$ insert into public.lead_attributions (lead_id, organization_id, site_id)
     values ('40000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'Customer roles cannot mutate attribution'
);

select is((select count(*)::integer from public.site_credentials), 0, 'Customer roles cannot read credentials');
select is((select count(*)::integer from public.used_nonces), 0, 'Customer roles cannot read used nonces');
select is((select count(*)::integer from public.idempotency_records), 0, 'Customer roles cannot read idempotency records');

set local role authenticated;
select set_config('request.jwt.claim.sub', '01000000-0000-0000-0000-000000000002', true);

select lives_ok(
  $$ insert into public.lead_notes (organization_id, lead_id, author_user_id, body)
     values ('12000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '01000000-0000-0000-0000-000000000002', 'Agent note') $$,
  'Agent can add append-only notes to own organization lead'
);

select throws_ok(
  $$ update public.lead_notes
     set body = 'edited'
     where lead_id = '40000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'Lead notes are append-only for customer roles'
);

reset role;

select throws_ok(
  $$ insert into public.leads (organization_id, site_id, email, assigned_to)
     values ('12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'viewer@example.test', '01000000-0000-0000-0000-000000000003') $$,
  '23514',
  null,
  'Lead cannot be assigned to a viewer'
);

select throws_ok(
  $$ insert into public.leads (organization_id, site_id, email)
     values ('12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000002', 'wrong-site@example.test') $$,
  '23514',
  null,
  'Lead site must match organization'
);

select throws_ok(
  $$ insert into public.lead_attributions (lead_id, organization_id, site_id)
     values ('40000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000002') $$,
  '23514',
  null,
  'Attribution must match lead organization and site'
);

set local role service_role;

select is((select count(*)::integer from public.site_credentials), 1, 'Service-role can use credential table');
select is((select count(*)::integer from public.leads), 2, 'Service-role can use lead table');

select * from finish();

rollback;
