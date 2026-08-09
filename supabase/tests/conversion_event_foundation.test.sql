begin;

create extension if not exists pgtap;

select plan(49);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'events-owner-a@example.test', '', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated', 'events-owner-b@example.test', '', now(), now(), now());

insert into public.organizations (id, name, slug, status)
values
  ('10000000-0000-0000-0000-0000000000e1', 'Events Org A', 'events-org-a', 'active'),
  ('10000000-0000-0000-0000-0000000000e2', 'Events Org B', 'events-org-b', 'active');

insert into public.organization_members (id, organization_id, user_id, role)
values
  ('11000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'organization_owner'),
  ('11000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e2', 'organization_owner');

insert into public.sites (id, organization_id, name, status)
values
  ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', 'Events Site A', 'active'),
  ('20000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-0000000000e2', 'Events Site B', 'active');

-- ---------------------------------------------------------------------------
-- Table shape
-- ---------------------------------------------------------------------------

select has_table('public', 'conversion_events', 'conversion_events exists');
select has_table('public', 'event_risk_assessments', 'event_risk_assessments exists');
select has_table('public', 'quarantined_events', 'quarantined_events exists');
select has_table('public', 'event_quotas', 'event_quotas exists');
select has_table('public', 'event_anomalies', 'event_anomalies exists');
select has_table('public', 'tracker_releases', 'tracker_releases exists');
select has_table('public', 'site_tracker_deployments', 'site_tracker_deployments exists');
select has_table('public', 'site_tracker_keys', 'site_tracker_keys exists');

-- ---------------------------------------------------------------------------
-- PII boundary: no personal-data columns may exist on any event table
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'conversion_events',
        'event_risk_assessments',
        'quarantined_events',
        'event_quotas',
        'event_anomalies'
      )
      and column_name in (
        'first_name', 'last_name', 'full_name', 'name',
        'email', 'email_normalized',
        'phone', 'phone_normalized', 'tel', 'mobile',
        'message', 'comment', 'note', 'address',
        'ip', 'ip_address', 'raw_ip',
        'user_agent', 'metadata', 'payload', 'form_data'
      )
  ),
  0,
  'No PII or raw-IP columns exist on Phase 2 event tables'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'conversion_events', 'quarantined_events', 'event_anomalies'
      )
      and data_type = 'jsonb'
  ),
  0,
  'No arbitrary jsonb payload columns exist on event tables'
);

-- ---------------------------------------------------------------------------
-- Event type contract: the browser can never assert a lead
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at)
    values
      ('evt_aaaaaaaaaaaaaaaa', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'whatsapp_clicked', now())$$,
  'whatsapp_clicked is accepted'
);

select lives_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at)
    values
      ('evt_bbbbbbbbbbbbbbbb', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'session_started', now())$$,
  'session_started is accepted'
);

select throws_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at)
    values
      ('evt_cccccccccccccccc', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'lead_created', now())$$,
  '23514',
  null,
  'lead_created cannot be stored as a conversion event'
);

select throws_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at)
    values
      ('evt_dddddddddddddddd', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'purchase', now())$$,
  '23514',
  null,
  'arbitrary event types are rejected'
);

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at)
    values
      ('evt_aaaaaaaaaaaaaaaa', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'phone_clicked', now())$$,
  '23505',
  null,
  'the same event id cannot be stored twice for one site'
);

select lives_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at)
    values
      ('evt_aaaaaaaaaaaaaaaa', '10000000-0000-0000-0000-0000000000e2',
       '20000000-0000-0000-0000-0000000000e2', 'ses_bbbbbbbbbbbbbbbb',
       'phone_clicked', now())$$,
  'event ids are scoped per site, so one site cannot burn another site''s id space'
);

-- ---------------------------------------------------------------------------
-- Sanitization invariants enforced at the database level
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at, page_path)
    values
      ('evt_eeeeeeeeeeeeeeee', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'form_started', now(), '/form?email=ada@example.com')$$,
  '23514',
  null,
  'a page path carrying a query string is rejected'
);

select throws_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at, page_path)
    values
      ('evt_ffffffffffffffff', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'form_started', now(), '/a#fragment')$$,
  '23514',
  null,
  'a page path carrying a fragment is rejected'
);

select throws_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at)
    values
      ('short', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'form_started', now())$$,
  '23514',
  null,
  'a malformed event id is rejected'
);

select throws_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at, utm_source)
    values
      ('evt_gggggggggggggggg', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'form_started', now(), repeat('a', 200))$$,
  '23514',
  null,
  'an over-long utm value is rejected'
);

select throws_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at, source_category)
    values
      ('evt_hhhhhhhhhhhhhhhh', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'form_started', now(), 'made_up')$$,
  '23514',
  null,
  'source_category is limited to the six Phase 1 categories'
);

-- ---------------------------------------------------------------------------
-- Retention defaults
-- ---------------------------------------------------------------------------

select is(
  (
    select (expires_at::date - received_at::date)
    from public.conversion_events
    where event_id = 'evt_aaaaaaaaaaaaaaaa'
      and site_id = '20000000-0000-0000-0000-0000000000e1'
  ),
  90,
  'accepted conversion events expire after 90 days'
);

select lives_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at, risk_status)
    values
      ('evt_iiiiiiiiiiiiiiii', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'form_started', now(), 'suspicious')$$,
  'suspicious events can be stored'
);

select is(
  (
    select (expires_at::date - received_at::date)
    from public.conversion_events
    where event_id = 'evt_iiiiiiiiiiiiiiii'
  ),
  30,
  'suspicious conversion events expire after 30 days'
);

select throws_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at, risk_status)
    values
      ('evt_jjjjjjjjjjjjjjjj', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'form_started', now(), 'quarantined')$$,
  '23514',
  null,
  'quarantined rows belong in quarantined_events, not conversion_events'
);

select lives_ok(
  $$insert into public.quarantined_events
      (organization_id, site_id, event_id, event_type, risk_score, reason_code, occurred_at)
    values
      ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1',
       'evt_kkkkkkkkkkkkkkkk', 'whatsapp_clicked', 65, 'origin_mismatch', now())$$,
  'quarantined events can be stored with an enumerated reason'
);

select is(
  (
    select (expires_at::date - received_at::date)
    from public.quarantined_events
    where event_id = 'evt_kkkkkkkkkkkkkkkk'
  ),
  30,
  'quarantined events expire after 30 days'
);

select throws_ok(
  $$insert into public.quarantined_events
      (organization_id, site_id, event_id, event_type, risk_score, reason_code, occurred_at)
    values
      ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1',
       'evt_llllllllllllllll', 'whatsapp_clicked', 65, 'because the user looked odd', now())$$,
  '23514',
  null,
  'a free-form quarantine reason is rejected'
);

-- ---------------------------------------------------------------------------
-- Risk score bands
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.event_risk_assessments
      (organization_id, site_id, event_id, risk_score, risk_status)
    values
      ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1',
       'evt_aaaaaaaaaaaaaaaa', 10, 'accepted')$$,
  'a low score maps to accepted'
);

select throws_ok(
  $$insert into public.event_risk_assessments
      (organization_id, site_id, event_id, risk_score, risk_status)
    values
      ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1',
       'evt_bbbbbbbbbbbbbbbb', 90, 'accepted')$$,
  '23514',
  null,
  'a score and status that disagree are rejected'
);

select throws_ok(
  $$insert into public.event_risk_assessments
      (organization_id, site_id, event_id, risk_score, risk_status)
    values
      ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1',
       'evt_bbbbbbbbbbbbbbbb', 150, 'rejected')$$,
  '23514',
  null,
  'a score outside 0-100 is rejected'
);

-- ---------------------------------------------------------------------------
-- Tracker releases and deployments
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.tracker_releases (id, version, status, released_at)
    values ('40000000-0000-0000-0000-0000000000e1', '1.0.0', 'active', now())$$,
  'a release can be activated'
);

select throws_ok(
  $$insert into public.tracker_releases (version, status, released_at)
    values ('1.1.0', 'active', now())$$,
  '23505',
  null,
  'only one release can be active at a time'
);

select throws_ok(
  $$insert into public.tracker_releases (version, status) values ('latest', 'draft')$$,
  '23514',
  null,
  'a release version must be semantic and immutable'
);

select lives_ok(
  $$insert into public.site_tracker_deployments
      (organization_id, site_id, tracker_release_id, integration_version, pinned)
    values
      ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1',
       '40000000-0000-0000-0000-0000000000e1', '1.0.0', true)$$,
  'a site can be pinned to a release'
);

select throws_ok(
  $$insert into public.site_tracker_deployments
      (organization_id, site_id, pinned)
    values
      ('10000000-0000-0000-0000-0000000000e2', '20000000-0000-0000-0000-0000000000e2', true)$$,
  '23514',
  null,
  'a pinned deployment must name the release it is pinned to'
);

-- ---------------------------------------------------------------------------
-- Tracker keys are public identifiers, kept apart from HMAC credentials
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.site_tracker_keys (organization_id, site_id, public_key)
    values
      ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1',
       'vtk_abcdef0123456789abcdef0123456789')$$,
  'a public tracker key can be issued'
);

select throws_ok(
  $$insert into public.site_tracker_keys (organization_id, site_id, public_key)
    values
      ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1',
       'vtk_00000000000000000000000000000000')$$,
  '23505',
  null,
  'a site has at most one active tracker key'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'site_tracker_keys'
      and column_name in ('secret', 'encrypted_secret', 'secret_fingerprint')
  ),
  0,
  'the public tracker key table holds no signing secret'
);

-- ---------------------------------------------------------------------------
-- RLS: customers cannot read raw event data (requirement 29)
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::integer
    from pg_tables
    where schemaname = 'public'
      and tablename in (
        'conversion_events', 'event_risk_assessments', 'quarantined_events',
        'event_quotas', 'event_anomalies', 'tracker_releases',
        'site_tracker_deployments', 'site_tracker_keys'
      )
      and rowsecurity = false
  ),
  0,
  'RLS is enabled on every Phase 2 table'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and table_name in (
        'conversion_events', 'event_risk_assessments', 'quarantined_events',
        'event_quotas', 'event_anomalies', 'tracker_releases',
        'site_tracker_deployments', 'site_tracker_keys'
      )
  ),
  0,
  'anon and authenticated hold no grants on Phase 2 tables'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'service_role'
      and privilege_type = 'SELECT'
      and table_name in (
        'conversion_events', 'event_risk_assessments', 'quarantined_events',
        'event_quotas', 'event_anomalies', 'tracker_releases',
        'site_tracker_deployments', 'site_tracker_keys'
      )
  ),
  8,
  'service_role can read every Phase 2 table'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "role": "authenticated"}';

select throws_ok(
  $$select count(*) from public.conversion_events$$,
  '42501',
  null,
  'an organization owner cannot read raw conversion events, not even their own'
);

select throws_ok(
  $$select count(*) from public.quarantined_events$$,
  '42501',
  null,
  'an organization owner cannot read quarantined events'
);

select throws_ok(
  $$select count(*) from public.event_risk_assessments$$,
  '42501',
  null,
  'an organization owner cannot read risk assessments'
);

select throws_ok(
  $$select count(*) from public.event_anomalies$$,
  '42501',
  null,
  'an organization owner cannot read anomalies'
);

select throws_ok(
  $$select count(*) from public.event_quotas$$,
  '42501',
  null,
  'an organization owner cannot read quotas'
);

select throws_ok(
  $$select count(*) from public.site_tracker_keys$$,
  '42501',
  null,
  'an organization owner cannot read tracker keys directly'
);

select throws_ok(
  $$insert into public.conversion_events
      (event_id, organization_id, site_id, session_id, event_type, occurred_at)
    values
      ('evt_mmmmmmmmmmmmmmmm', '10000000-0000-0000-0000-0000000000e1',
       '20000000-0000-0000-0000-0000000000e1', 'ses_aaaaaaaaaaaaaaaa',
       'whatsapp_clicked', now())$$,
  '42501',
  null,
  'an authenticated user cannot write conversion events'
);

reset role;

select * from finish();

rollback;
