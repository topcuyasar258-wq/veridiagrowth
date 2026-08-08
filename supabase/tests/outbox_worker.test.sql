begin;

create extension if not exists pgtap;

select plan(22);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('03000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'worker-owner@example.test', '', now(), now(), now()),
  ('03000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'worker-agent@example.test', '', now(), now(), now()),
  ('03000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'worker-viewer@example.test', '', now(), now(), now());

insert into public.organizations (id, name, slug, status)
values ('14000000-0000-0000-0000-000000000001', 'Worker Org', 'worker-org', 'active');

insert into public.organization_members (organization_id, user_id, role)
values
  ('14000000-0000-0000-0000-000000000001', '03000000-0000-0000-0000-000000000001', 'organization_owner'),
  ('14000000-0000-0000-0000-000000000001', '03000000-0000-0000-0000-000000000002', 'agent'),
  ('14000000-0000-0000-0000-000000000001', '03000000-0000-0000-0000-000000000003', 'viewer');

insert into public.sites (id, organization_id, name, status)
values ('24000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', 'Worker Site', 'active');

insert into public.outbox_events (
  id,
  organization_id,
  site_id,
  event_type,
  aggregate_type,
  aggregate_id,
  job_key,
  payload,
  status,
  available_at
)
select
  ('70000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  '14000000-0000-0000-0000-000000000001',
  '24000000-0000-0000-0000-000000000001',
  case when i % 2 = 0 then 'notify_business' else 'update_metrics' end,
  'lead',
  gen_random_uuid(),
  'job-' || i::text,
  jsonb_build_object('leadId', gen_random_uuid(), 'siteId', '24000000-0000-0000-0000-000000000001'),
  'pending',
  now()
from generate_series(1, 100) as i;

insert into public.outbox_events (
  id,
  organization_id,
  site_id,
  event_type,
  aggregate_type,
  aggregate_id,
  job_key,
  payload,
  status,
  available_at
)
values (
  '70000000-0000-0000-0000-000000000200',
  '14000000-0000-0000-0000-000000000001',
  '24000000-0000-0000-0000-000000000001',
  'notify_business',
  'lead',
  gen_random_uuid(),
  'future-job',
  '{"leadId":"00000000-0000-0000-0000-000000000000","siteId":"24000000-0000-0000-0000-000000000001"}',
  'pending',
  now() + interval '1 hour'
);

set local role service_role;

create temp table claimed_ids (id uuid primary key, worker text not null) on commit drop;

insert into claimed_ids
select id, 'worker-1' from public.claim_outbox_events('worker-1', 20, 120);
insert into claimed_ids
select id, 'worker-2' from public.claim_outbox_events('worker-2', 20, 120);
insert into claimed_ids
select id, 'worker-3' from public.claim_outbox_events('worker-3', 20, 120);
insert into claimed_ids
select id, 'worker-4' from public.claim_outbox_events('worker-4', 20, 120);
insert into claimed_ids
select id, 'worker-5' from public.claim_outbox_events('worker-5', 20, 120);

select is((select count(*)::integer from claimed_ids), 100, 'Five workers claim 100 jobs');
select is((select count(*)::integer from (select id from claimed_ids group by id having count(*) > 1) duplicate), 0, 'No job is claimed twice');
select is((select count(*)::integer from public.outbox_events where status = 'processing'), 100, 'Claimed jobs move to processing');
select is((select count(*)::integer from claimed_ids where id = '70000000-0000-0000-0000-000000000200'), 0, 'Future available_at job is not claimed');
select is((select count(*)::integer from public.claim_outbox_events('worker-6', 10, 120)), 0, 'Processing jobs are not claimed before timeout');

update public.outbox_events
set locked_at = now() - interval '5 minutes'
where id = (select id from claimed_ids limit 1);

select is((select count(*)::integer from public.claim_outbox_events('worker-recover', 1, 120)), 1, 'Stuck processing job is reclaimable after timeout');

select lives_ok(
  $$ select public.finish_outbox_success(
    (select id from public.outbox_events where locked_by = 'worker-recover' limit 1),
    'worker-recover'
  ) $$,
  'Worker can complete a claimed job'
);

select is((select count(*)::integer from public.claim_outbox_events('worker-after-complete', 10, 120)), 0, 'Completed job is not reclaimed while remaining processing locks are fresh');

update public.outbox_events
set locked_at = now() - interval '5 minutes'
where id = (select id from claimed_ids offset 1 limit 1);

select is((select count(*)::integer from public.claim_outbox_events('worker-fail', 1, 120)), 1, 'Worker claims a job for retry failure');

select is(
  (
    select public.finish_outbox_failure(
      (select id from public.outbox_events where locked_by = 'worker-fail' limit 1),
      'worker-fail',
      true,
      5,
      now() + interval '1 minute',
      'provider_429',
      'provider',
      'provider_429'
    )
  ),
  'pending',
  'Retryable failure with attempts remaining returns to pending'
);

select is((select attempt_count from public.outbox_events where last_error_code = 'provider_429' limit 1), 1, 'Retry increments attempt count');
select ok((select available_at > now() from public.outbox_events where last_error_code = 'provider_429' limit 1), 'Retry moves available_at forward');

update public.outbox_events
set status = 'processing',
    locked_by = 'worker-dead',
    locked_at = now(),
    attempt_count = 4
where id = (select id from claimed_ids offset 2 limit 1);

select is(
  (
    select public.finish_outbox_failure(
      (select id from public.outbox_events where locked_by = 'worker-dead' limit 1),
      'worker-dead',
      true,
      5,
      now() + interval '1 hour',
      'provider_5xx',
      'provider',
      'provider_5xx'
    )
  ),
  'dead_letter',
  'Max attempt failure moves to dead-letter'
);

select is((select count(*)::integer from public.dead_letter_events), 1, 'Dead-letter event is recorded');
select is((select payload_reference ? 'leadId' from public.dead_letter_events limit 1), true, 'Dead-letter payload reference includes leadId');
select is((select payload_reference ? 'phone' from public.dead_letter_events limit 1), false, 'Dead-letter payload reference does not include phone');

insert into public.notification_settings (organization_id, site_id, channel, recipient_email)
values ('14000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', 'email', 'ops@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub', '03000000-0000-0000-0000-000000000001', true);
select is((select count(*)::integer from public.notification_settings), 1, 'Owner can read notification settings');
select throws_ok($$ insert into public.notification_settings (organization_id, channel, recipient_email) values ('14000000-0000-0000-0000-000000000001', 'email', 'owner-write@example.test') $$, '42501', null, 'Owner cannot directly mutate notification settings');

set local role authenticated;
select set_config('request.jwt.claim.sub', '03000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.notification_settings), 0, 'Agent cannot read notification settings directly');
select throws_ok($$ select count(*) from public.job_executions $$, '42501', null, 'Customer cannot read job executions');
select throws_ok($$ select count(*) from public.delivery_attempts $$, '42501', null, 'Customer cannot read delivery attempts');
select throws_ok($$ select count(*) from public.dead_letter_events $$, '42501', null, 'Customer cannot read dead letters');

select * from finish();

rollback;
