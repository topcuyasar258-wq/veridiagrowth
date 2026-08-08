begin;

create extension if not exists pgtap;

select plan(24);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('02000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ingestion-owner@example.test', '', now(), now(), now()),
  ('02000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ingestion-viewer@example.test', '', now(), now(), now());

insert into public.organizations (id, name, slug, status)
values ('13000000-0000-0000-0000-000000000001', 'Ingestion Organization', 'ingestion-org', 'active');

insert into public.organization_members (organization_id, user_id, role)
values
  ('13000000-0000-0000-0000-000000000001', '02000000-0000-0000-0000-000000000001', 'organization_owner'),
  ('13000000-0000-0000-0000-000000000001', '02000000-0000-0000-0000-000000000002', 'viewer');

insert into public.sites (id, organization_id, name, status)
values ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'Ingestion Site', 'active');

insert into public.idempotency_records (
  id,
  site_id,
  idempotency_key_hash,
  request_hash,
  status,
  locked_until,
  expires_at
)
values (
  '60000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001',
  'idem-1',
  'request-1',
  'processing',
  now() + interval '30 seconds',
  now() + interval '24 hours'
);

set local role service_role;

select lives_ok(
  $$ select public.complete_lead_ingestion(
    '60000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000001',
    '{
      "firstName":"Ada",
      "lastName":"Lovelace",
      "phone":"+905321234567",
      "phoneNormalized":"+905321234567",
      "email":"ada@example.test",
      "emailNormalized":"ada@example.test",
      "service":"Kentsel Donusum",
      "city":"Istanbul",
      "message":"Bilgi almak istiyorum.",
      "isSuspicious":false,
      "suspicionReasons":[]
    }'::jsonb,
    '{
      "landingPage":"/landing",
      "conversionPage":"/form",
      "referrer":"https://www.google.com/",
      "utmSource":"google",
      "utmMedium":"cpc",
      "utmCampaign":"campaign",
      "sourceCategory":"paid_search",
      "firstTouch":{"source":"google","medium":"organic","campaign":null,"referrer":"https://www.google.com/","occurredAt":"2026-08-07T00:00:00.000Z"},
      "lastTouch":{"source":"google","medium":"cpc","campaign":"campaign","referrer":null,"occurredAt":"2026-08-08T00:00:00.000Z"}
    }'::jsonb,
    '{}'::jsonb
  ) $$,
  'Service role can atomically create a lead'
);

select is((select count(*)::integer from public.leads), 1, 'Lead is created');
select is((select count(*)::integer from public.lead_attributions), 1, 'Attribution is created');
select is((select count(*)::integer from public.lead_status_history), 1, 'Initial status history is created');
select is((select count(*)::integer from public.domain_events where event_type = 'lead_created'), 1, 'Internal lead_created domain event is created');
select is((select count(*)::integer from public.outbox_events), 2, 'Two outbox jobs are created');
select is((select count(*)::integer from public.outbox_events where job_key like 'notify-business:%'), 1, 'Notify business job is created');
select is((select count(*)::integer from public.outbox_events where job_key like 'update-metrics:%'), 1, 'Update metrics job is created');
select is((select status from public.idempotency_records where id = '60000000-0000-0000-0000-000000000001'), 'completed', 'Idempotency is completed');

select is(
  (
    select count(*)::integer
    from public.outbox_events
    where payload ? 'phone'
       or payload ? 'email'
       or payload ? 'message'
       or payload ? 'turnstileToken'
       or payload ? 'ip'
  ),
  0,
  'Outbox payload does not copy PII or security tokens'
);

insert into public.idempotency_records (
  id,
  site_id,
  idempotency_key_hash,
  request_hash,
  status,
  locked_until,
  expires_at
)
values (
  '60000000-0000-0000-0000-000000000002',
  '23000000-0000-0000-0000-000000000001',
  'idem-2',
  'request-2',
  'processing',
  now() + interval '30 seconds',
  now() + interval '24 hours'
);

select lives_ok(
  $$ select public.complete_lead_ingestion(
    '60000000-0000-0000-0000-000000000002',
    '13000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000001',
    '{"phone":"+905321234567","phoneNormalized":"+905321234567","email":null,"emailNormalized":null,"isSuspicious":true,"suspicionReasons":["form_completed_too_quickly"]}'::jsonb,
    '{"sourceCategory":"direct"}'::jsonb,
    '{}'::jsonb
  ) $$,
  'Second matching contact creates a business duplicate'
);

select is((select count(*)::integer from public.leads), 2, 'Duplicate still creates a new lead');
select ok((select is_duplicate from public.leads order by created_at desc, id desc limit 1), 'Newest matching lead is marked duplicate');
select isnt((select duplicate_of from public.leads order by created_at desc, id desc limit 1), null, 'Duplicate points at original lead');
select is((select count(*)::integer from public.security_events where event_type = 'lead.duplicate_detected'), 1, 'Duplicate security event is recorded');
select is((select count(*)::integer from public.security_events where event_type = 'lead.suspicious_created'), 1, 'Suspicious lead event is recorded without rejecting');

insert into public.idempotency_records (
  id,
  site_id,
  idempotency_key_hash,
  request_hash,
  status,
  locked_until,
  expires_at
)
values (
  '60000000-0000-0000-0000-000000000003',
  '23000000-0000-0000-0000-000000000001',
  'idem-3',
  'request-3',
  'processing',
  now() + interval '30 seconds',
  now() + interval '24 hours'
);

select throws_ok(
  $$ select public.complete_lead_ingestion(
    '60000000-0000-0000-0000-000000000003',
    '13000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000001',
    '{"email":"rollback@example.test","emailNormalized":"rollback@example.test"}'::jsonb,
    '{"sourceCategory":"unknown","lastTouch":{"occurredAt":"not-a-date"}}'::jsonb,
    '{}'::jsonb
  ) $$,
  '22007',
  null,
  'Attribution failure aborts the transaction'
);

select is((select count(*)::integer from public.leads where email = 'rollback@example.test'), 0, 'Failed attribution leaves no partial lead');
select is((select count(*)::integer from public.outbox_events where payload->>'leadId' is null), 0, 'Failed transaction leaves no malformed outbox event');

select lives_ok(
  $$ select public.claim_lead_rate_limit(
    '23000000-0000-0000-0000-000000000001',
    'site_ip',
    'hashed-ip-bucket',
    300,
    1
  ) $$,
  'Service role can claim a rate limit bucket'
);

select is(
  (
    select (public.claim_lead_rate_limit(
      '23000000-0000-0000-0000-000000000001',
      'site_ip',
      'hashed-ip-bucket',
      300,
      1
    )->>'allowed')::boolean
  ),
  false,
  'Burst over the configured bucket is rejected'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '02000000-0000-0000-0000-000000000001', true);

select throws_ok($$ select count(*) from public.outbox_events $$, '42501', null, 'Customer cannot read outbox');
select throws_ok($$ insert into public.outbox_events (organization_id, event_type, aggregate_type, aggregate_id, job_key, payload) values ('13000000-0000-0000-0000-000000000001', 'x', 'lead', gen_random_uuid(), 'x', '{}'::jsonb) $$, '42501', null, 'Customer cannot mutate outbox');
select throws_ok($$ select count(*) from public.security_events $$, '42501', null, 'Customer cannot read security events');

select * from finish();

rollback;
