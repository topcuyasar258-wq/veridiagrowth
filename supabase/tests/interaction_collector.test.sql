begin;

create extension if not exists pgtap;

select plan(35);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'collector-owner-a@example.test', '', now(), now(), now());

insert into public.organizations (id, name, slug, status)
values
  ('10000000-0000-0000-0000-0000000000c1', 'Collector Org A', 'collector-org-a', 'active'),
  ('10000000-0000-0000-0000-0000000000c2', 'Collector Org B', 'collector-org-b', 'active');

insert into public.organization_members (id, organization_id, user_id, role)
values
  ('11000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'organization_owner');

insert into public.sites (id, organization_id, name, status)
values
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'Collector Site A', 'active'),
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c2', 'Collector Site B', 'active');

-- ---------------------------------------------------------------------------
-- ingest_interaction_event: accepted path
-- ---------------------------------------------------------------------------

select is(
  public.ingest_interaction_event(
    '20000000-0000-0000-0000-0000000000c1',
    'evt_collect0000001', 'whatsapp_clicked', 'ses_collect0000001', now(),
    'example.com', '/iletisim', null, 'organic',
    null, null, null, null, null, '0.1.0', null,
    'accepted', 0, '{}'::text[]
  ),
  'accepted',
  'a clean event is accepted'
);

select is(
  (select count(*)::integer from public.conversion_events
   where event_id = 'evt_collect0000001'),
  1,
  'the accepted event is stored once'
);

select is(
  (select organization_id from public.conversion_events
   where event_id = 'evt_collect0000001'),
  '10000000-0000-0000-0000-0000000000c1'::uuid,
  'organization is derived from the site, never from the caller'
);

select is(
  (select count(*)::integer from public.event_risk_assessments
   where event_id = 'evt_collect0000001'),
  0,
  'a clean accepted event writes no risk assessment'
);

select is(
  (select (expires_at::date - received_at::date) from public.conversion_events
   where event_id = 'evt_collect0000001'),
  90,
  'the accepted event gets the 90 day retention deadline'
);

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------

select is(
  public.ingest_interaction_event(
    '20000000-0000-0000-0000-0000000000c1',
    'evt_collect0000001', 'whatsapp_clicked', 'ses_collect0000001', now(),
    'example.com', '/iletisim', null, 'organic',
    null, null, null, null, null, '0.1.0', null,
    'accepted', 0, '{}'::text[]
  ),
  'duplicate',
  'redelivering the same event reports duplicate instead of failing'
);

select is(
  (select count(*)::integer from public.conversion_events
   where event_id = 'evt_collect0000001'),
  1,
  'redelivery creates no second interaction'
);

-- Twenty deliveries, one row. Duplicate delivery is normal transport behaviour
-- for sendBeacon, so it must never raise an error to the caller.
select lives_ok(
  $$select public.ingest_interaction_event(
      '20000000-0000-0000-0000-0000000000c1',
      'evt_collect0000001', 'whatsapp_clicked', 'ses_collect0000001', now(),
      'example.com', '/iletisim', null, 'organic',
      null, null, null, null, null, '0.1.0', null,
      'accepted', 0, '{}'::text[]
    ) from generate_series(1, 20)$$,
  'twenty redeliveries raise no error'
);

select is(
  (select count(*)::integer from public.conversion_events
   where event_id = 'evt_collect0000001'),
  1,
  'twenty redeliveries still yield exactly one interaction'
);

select is(
  public.ingest_interaction_event(
    '20000000-0000-0000-0000-0000000000c2',
    'evt_collect0000001', 'whatsapp_clicked', 'ses_collect0000002', now(),
    'other.example.com', '/', null, 'direct',
    null, null, null, null, null, '0.1.0', null,
    'accepted', 0, '{}'::text[]
  ),
  'accepted',
  'the same event id is independent on another site'
);

select is(
  (select count(*)::integer from public.conversion_events
   where event_id = 'evt_collect0000001'),
  2,
  'per-site scoping keeps both sites'' events'
);

-- ---------------------------------------------------------------------------
-- suspicious / quarantine / reject
-- ---------------------------------------------------------------------------

select is(
  public.ingest_interaction_event(
    '20000000-0000-0000-0000-0000000000c1',
    'evt_collect0000002', 'form_started', 'ses_collect0000001', now(),
    'example.com', '/form', null, 'organic',
    null, null, null, null, null, '0.1.0', null,
    'suspicious', 45, array['referer_mismatch']
  ),
  'suspicious',
  'a suspicious event is stored'
);

select is(
  (select risk_status from public.conversion_events where event_id = 'evt_collect0000002'),
  'suspicious',
  'the suspicious flag is visible on the interaction'
);

select is(
  (select count(*)::integer from public.event_risk_assessments
   where event_id = 'evt_collect0000002'),
  1,
  'a suspicious event writes exactly one risk assessment'
);

select is(
  (select conversion_event_id is not null from public.event_risk_assessments
   where event_id = 'evt_collect0000002'),
  true,
  'the suspicious assessment references its interaction'
);

select is(
  (select (expires_at::date - received_at::date) from public.conversion_events
   where event_id = 'evt_collect0000002'),
  30,
  'a suspicious interaction gets the shorter 30 day retention'
);

select is(
  public.ingest_interaction_event(
    '20000000-0000-0000-0000-0000000000c1',
    'evt_collect0000003', 'phone_clicked', 'ses_collect0000001', now(),
    'example.com', '/', null, 'organic',
    null, null, null, null, null, '0.1.0', null,
    'quarantined', 65, array['origin_mismatch']
  ),
  'quarantined',
  'a quarantined event is isolated'
);

-- A quarantined interaction must never also exist in conversion_events, or one
-- event would be countable as two logical records and could reach a clean
-- metric through a forgotten risk_status filter.
select is(
  (select count(*)::integer from public.conversion_events
   where event_id = 'evt_collect0000003'),
  0,
  'a quarantined event writes no conversion row'
);

select is(
  (select count(*)::integer from public.quarantined_events
   where event_id = 'evt_collect0000003'),
  1,
  'the quarantined event is held for review'
);

select is(
  (select reason_code from public.quarantined_events where event_id = 'evt_collect0000003'),
  'origin_mismatch',
  'the primary risk signal becomes the quarantine reason'
);

select is(
  public.ingest_interaction_event(
    '20000000-0000-0000-0000-0000000000c1',
    'evt_collect0000004', 'phone_clicked', 'ses_collect0000001', now(),
    'example.com', '/', null, 'organic',
    null, null, null, null, null, '0.1.0', null,
    'rejected', 95, array['origin_mismatch', 'site_ip_rate_elevated']
  ),
  'rejected',
  'a rejected event is refused'
);

select is(
  (select count(*)::integer from public.conversion_events
   where event_id = 'evt_collect0000004'),
  0,
  'a rejected event writes no interaction'
);

select is(
  (select count(*)::integer from public.quarantined_events
   where event_id = 'evt_collect0000004'),
  0,
  'a rejected event is not quarantined either'
);

select throws_ok(
  $$select public.ingest_interaction_event(
      '20000000-0000-0000-0000-0000000000c1',
      'evt_collect0000005', 'phone_clicked', 'ses_collect0000001', now(),
      'example.com', '/', null, 'organic',
      null, null, null, null, null, '0.1.0', null,
      'made_up_decision', 0, '{}'::text[]
    )$$,
  '22023',
  null,
  'an unknown decision is refused rather than guessed'
);

select throws_ok(
  $$select public.ingest_interaction_event(
      '20000000-0000-0000-0000-0000000000ff',
      'evt_collect0000006', 'phone_clicked', 'ses_collect0000001', now(),
      'example.com', '/', null, 'organic',
      null, null, null, null, null, '0.1.0', null,
      'accepted', 0, '{}'::text[]
    )$$,
  '23503',
  null,
  'an unknown site cannot be written to'
);

-- ---------------------------------------------------------------------------
-- consume_event_quota
-- ---------------------------------------------------------------------------

select is(
  (select allowed from public.consume_event_quota(
    '10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1',
    'site', '20000000-0000-0000-0000-0000000000c1', 60, 3, 1
  )),
  true,
  'the first request in a window is allowed'
);

select is(
  (select current_count from public.consume_event_quota(
    '10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1',
    'site', '20000000-0000-0000-0000-0000000000c1', 60, 3, 2
  )),
  3,
  'the counter accumulates atomically across calls'
);

select is(
  (select allowed from public.consume_event_quota(
    '10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1',
    'site', '20000000-0000-0000-0000-0000000000c1', 60, 3, 1
  )),
  false,
  'exceeding the limit is reported'
);

select is(
  (select count(*)::integer from public.event_quotas
   where site_id = '20000000-0000-0000-0000-0000000000c1' and scope = 'site'),
  1,
  'one fixed window keeps one row, so storage stays bounded under abuse'
);

select is(
  (select allowed from public.consume_event_quota(
    '10000000-0000-0000-0000-0000000000c2', '20000000-0000-0000-0000-0000000000c2',
    'site', '20000000-0000-0000-0000-0000000000c2', 60, 3, 1
  )),
  true,
  'one site''s quota does not consume another''s'
);

select throws_ok(
  $$select public.consume_event_quota(
      '10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1',
      'site', 'k', 0, 3, 1
    )$$,
  '22023',
  null,
  'an invalid window is refused rather than dividing by zero'
);

-- ---------------------------------------------------------------------------
-- Permissions: customers can never drive ingestion
-- ---------------------------------------------------------------------------

select is(
  has_function_privilege('anon', 'public.ingest_interaction_event(uuid,text,text,text,timestamptz,text,text,text,text,text,text,text,text,text,text,text,text,integer,text[])', 'execute'),
  false,
  'anon cannot execute the ingestion RPC'
);

select is(
  has_function_privilege('authenticated', 'public.ingest_interaction_event(uuid,text,text,text,timestamptz,text,text,text,text,text,text,text,text,text,text,text,text,integer,text[])', 'execute'),
  false,
  'an authenticated customer cannot execute the ingestion RPC'
);

select is(
  has_function_privilege('authenticated', 'public.consume_event_quota(uuid,uuid,text,text,integer,integer,integer)', 'execute'),
  false,
  'an authenticated customer cannot drive quota counters'
);

select is(
  has_function_privilege('service_role', 'public.ingest_interaction_event(uuid,text,text,text,timestamptz,text,text,text,text,text,text,text,text,text,text,text,text,integer,text[])', 'execute'),
  true,
  'the collector service role can ingest'
);

select * from finish();

rollback;
