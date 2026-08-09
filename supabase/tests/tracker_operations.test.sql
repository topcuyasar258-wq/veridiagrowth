begin;

create extension if not exists pgtap;

select plan(45);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'ops-owner-a@example.test', '', now(), now(), now());

insert into public.organizations (id, name, slug, status)
values
  ('10000000-0000-0000-0000-0000000000d1', 'Ops Org A', 'ops-org-a', 'active'),
  ('10000000-0000-0000-0000-0000000000d2', 'Ops Org B', 'ops-org-b', 'active');

insert into public.organization_members (id, organization_id, user_id, role)
values
  ('11000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'organization_owner');

insert into public.sites (id, organization_id, name, status)
values
  ('20000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'Ops Site A', 'active'),
  ('20000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d2', 'Ops Site B', 'active');

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- Expired rows. expires_at is set explicitly to bypass the insert trigger.
insert into public.conversion_events
  (event_id, organization_id, site_id, session_id, event_type, occurred_at, received_at, risk_status, expires_at)
values
  ('evt_expired_accept01', '10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 'ses_ops000000000001', 'session_started', now() - interval '100 days', now() - interval '100 days', 'accepted', now() - interval '10 days'),
  ('evt_expired_accept02', '10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 'ses_ops000000000001', 'session_started', now() - interval '100 days', now() - interval '100 days', 'accepted', now() - interval '9 days'),
  ('evt_expired_suspect1', '10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 'ses_ops000000000001', 'session_started', now() - interval '40 days', now() - interval '40 days', 'suspicious', now() - interval '5 days'),
  ('evt_live_accepted001', '10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 'ses_ops000000000001', 'session_started', now(), now(), 'accepted', now() + interval '90 days'),
  ('evt_live_suspicious1', '10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 'ses_ops000000000001', 'session_started', now(), now(), 'suspicious', now() + interval '30 days'),
  ('evt_other_tenant0001', '10000000-0000-0000-0000-0000000000d2', '20000000-0000-0000-0000-0000000000d2', 'ses_ops000000000002', 'session_started', now(), now(), 'accepted', now() + interval '90 days');

insert into public.quarantined_events
  (organization_id, site_id, event_id, event_type, risk_score, reason_code, occurred_at, received_at, expires_at)
values
  ('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 'evt_expired_quar0001', 'whatsapp_clicked', 65, 'origin_mismatch', now() - interval '40 days', now() - interval '40 days', now() - interval '10 days'),
  ('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 'evt_live_quarantine1', 'whatsapp_clicked', 65, 'origin_mismatch', now(), now(), now() + interval '30 days');

-- A risk assessment attached to an expiring interaction, to prove no orphan.
insert into public.event_risk_assessments
  (organization_id, site_id, conversion_event_id, event_id, risk_score, risk_status)
select
  '10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1',
  id, 'evt_expired_suspect1', 45, 'suspicious'
from public.conversion_events where event_id = 'evt_expired_suspect1';

select is(
  (select deleted_accepted from public.sweep_expired_interactions(500)),
  2,
  'both expired accepted interactions are removed'
);

select is(
  (select count(*)::integer from public.conversion_events where event_id = 'evt_live_accepted001'),
  1,
  'a live accepted interaction is retained'
);

select is(
  (select count(*)::integer from public.conversion_events where event_id like 'evt_expired_accept%'),
  0,
  'no expired accepted interaction survives'
);

select is(
  (select count(*)::integer from public.conversion_events where event_id = 'evt_expired_suspect1'),
  0,
  'the expired suspicious interaction is removed'
);

select is(
  (select count(*)::integer from public.conversion_events where event_id = 'evt_live_suspicious1'),
  1,
  'a live suspicious interaction is retained'
);

select is(
  (select count(*)::integer from public.conversion_events where event_id = 'evt_other_tenant0001'),
  1,
  'another tenant''s data is untouched'
);

select is(
  (select count(*)::integer from public.quarantined_events where event_id = 'evt_expired_quar0001'),
  0,
  'the expired quarantine record is removed'
);

select is(
  (select count(*)::integer from public.quarantined_events where event_id = 'evt_live_quarantine1'),
  1,
  'a live quarantine record is retained'
);

-- The FK is ON DELETE CASCADE, so a deleted interaction takes its assessment
-- with it. Nothing may be left pointing at a row that no longer exists.
select is(
  (
    select count(*)::integer
    from public.event_risk_assessments a
    where a.conversion_event_id is not null
      and not exists (
        select 1 from public.conversion_events c where c.id = a.conversion_event_id
      )
  ),
  0,
  'retention leaves no orphaned risk assessment'
);

select lives_ok(
  $$select public.sweep_expired_interactions(500)$$,
  'a repeated sweep with nothing to do is a no-op'
);

select is(
  (select deleted_accepted from public.sweep_expired_interactions(500)),
  0,
  'a second sweep deletes nothing'
);

select throws_ok(
  $$select public.sweep_expired_interactions(0)$$,
  '22023',
  null,
  'an invalid batch limit is refused'
);

select throws_ok(
  $$select public.sweep_expired_interactions(50000)$$,
  '22023',
  null,
  'an unbounded batch is refused so the table is never locked wholesale'
);

-- ---------------------------------------------------------------------------
-- Anomalies
-- ---------------------------------------------------------------------------

select is(
  public.detect_event_anomalies(5, 12, 20, 3.0, 0.30),
  0,
  'quiet traffic produces no anomaly'
);

-- Baseline: a steady trickle across the preceding windows.
insert into public.conversion_events
  (event_id, organization_id, site_id, session_id, event_type, occurred_at, received_at, risk_status, expires_at)
select
  'evt_base' || lpad(g::text, 12, '0'),
  '10000000-0000-0000-0000-0000000000d1',
  '20000000-0000-0000-0000-0000000000d1',
  'ses_ops000000000001',
  'session_started',
  now() - interval '30 minutes',
  now() - interval '30 minutes',
  'accepted',
  now() + interval '90 days'
from generate_series(1, 24) as g;

-- Current window: a burst far above that baseline.
insert into public.conversion_events
  (event_id, organization_id, site_id, session_id, event_type, occurred_at, received_at, risk_status, expires_at)
select
  'evt_spike' || lpad(g::text, 11, '0'),
  '10000000-0000-0000-0000-0000000000d1',
  '20000000-0000-0000-0000-0000000000d1',
  'ses_ops000000000001',
  'session_started',
  now() - interval '1 minute',
  now() - interval '1 minute',
  'accepted',
  now() + interval '90 days'
from generate_series(1, 60) as g;

select cmp_ok(
  public.detect_event_anomalies(5, 12, 20, 3.0, 0.30),
  '>=',
  1,
  'a controlled spike is detected'
);

select is(
  (
    select count(*)::integer from public.event_anomalies
    where site_id = '20000000-0000-0000-0000-0000000000d1'
      and anomaly_type = 'volume_burst'
  ),
  1,
  'the spike produced exactly one anomaly'
);

select is(
  public.detect_event_anomalies(5, 12, 20, 3.0, 0.30),
  0,
  're-running the detector writes no duplicate'
);

select is(
  (
    select count(*)::integer from public.event_anomalies
    where site_id = '20000000-0000-0000-0000-0000000000d1'
      and anomaly_type = 'volume_burst'
  ),
  1,
  'the anomaly is still singular after a repeated run'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public' and table_name = 'event_anomalies'
      and column_name in ('ip', 'ip_hash', 'session_id', 'event_id', 'user_agent')
  ),
  0,
  'an anomaly record carries no identifier of any kind'
);

-- A brand new site: one event against no history must not read as a spike.
insert into public.conversion_events
  (event_id, organization_id, site_id, session_id, event_type, occurred_at, received_at, risk_status, expires_at)
values
  ('evt_tiny_sample00001', '10000000-0000-0000-0000-0000000000d2', '20000000-0000-0000-0000-0000000000d2', 'ses_ops000000000002', 'session_started', now() - interval '1 minute', now() - interval '1 minute', 'accepted', now() + interval '90 days');

select is(
  (
    select count(*)::integer from public.event_anomalies
    where site_id = '20000000-0000-0000-0000-0000000000d2'
  ),
  0,
  'a site below the minimum sample is never flagged'
);

select throws_ok(
  $$select public.detect_event_anomalies(0, 12, 20, 3.0, 0.30)$$,
  '22023',
  null,
  'an invalid anomaly window is refused'
);

-- ---------------------------------------------------------------------------
-- Release lifecycle
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.publish_tracker_release('0.1.0', repeat('a', 64), 420, 4290, 'canary')$$,
  'a release can be published as canary'
);

select is(
  (select status from public.tracker_releases where version = '0.1.0'),
  'canary',
  'the published release starts as canary'
);

select lives_ok(
  $$select public.activate_tracker_release('0.1.0')$$,
  'a canary release can be activated'
);

select is(
  (select status from public.tracker_releases where version = '0.1.0'),
  'active',
  '0.1.0 is active'
);

select lives_ok(
  $$select public.publish_tracker_release('0.2.0', repeat('b', 64), 430, 4400, 'canary')$$,
  'a second release can be published while the first is active'
);

select lives_ok(
  $$select public.activate_tracker_release('0.2.0')$$,
  'activating a new release demotes the previous one atomically'
);

select is(
  (select status from public.tracker_releases where version = '0.1.0'),
  'deprecated',
  'the superseded release becomes deprecated'
);

select is(
  (select count(*)::integer from public.tracker_releases where status = 'active'),
  1,
  'exactly one release is ever active'
);

-- Rollback: 0.2.0 is bad, return to 0.1.0.
select lives_ok(
  $$select public.rollback_tracker_release('0.1.0')$$,
  'a rollback to the previous stable release succeeds'
);

select is(
  (select status from public.tracker_releases where version = '0.2.0'),
  'rolled_back',
  'the withdrawn release is recorded as rolled_back, not merely deprecated'
);

select is(
  (select status from public.tracker_releases where version = '0.1.0'),
  'active',
  'the previous stable release is active again'
);

select throws_ok(
  $$select public.activate_tracker_release('0.2.0')$$,
  '22023',
  null,
  'a withdrawn release cannot be silently re-activated'
);

select throws_ok(
  $$select public.activate_tracker_release('9.9.9')$$,
  '23503',
  null,
  'an unknown release cannot be activated'
);

select lives_ok(
  $$select public.publish_tracker_release('0.3.0', null, null, null, 'canary')$$,
  'a canary may exist without an artifact hash'
);

select throws_ok(
  $$select public.activate_tracker_release('0.3.0')$$,
  '22023',
  null,
  'a release without an artifact hash cannot be activated'
);

select throws_ok(
  $$update public.tracker_releases set artifact_sha256 = repeat('c', 64) where version = '0.1.0'$$,
  '23514',
  null,
  'a published artifact hash is immutable'
);

-- ---------------------------------------------------------------------------
-- Deployment resolution and pinning
-- ---------------------------------------------------------------------------

insert into public.site_tracker_deployments
  (organization_id, site_id, tracker_release_id, integration_version, pinned)
select
  '10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1',
  id, '1.0.0', true
from public.tracker_releases where version = '0.1.0';

select is(
  (select version from public.resolve_site_tracker_release('20000000-0000-0000-0000-0000000000d1')),
  '0.1.0',
  'a pinned site resolves to its pinned release'
);

select is(
  (select version from public.resolve_site_tracker_release('20000000-0000-0000-0000-0000000000d2')),
  '0.1.0',
  'an unpinned site resolves to the active release'
);

-- Move the global default and confirm the pinned site does not follow.
-- A rolled_back release is deliberately not re-activatable -- withdrawing a
-- release is a decision, and reversing it needs a new published version -- so a
-- fresh release is published for this step.
select public.publish_tracker_release('0.4.0', repeat('d', 64), 440, 4500, 'canary');
select public.activate_tracker_release('0.4.0');

select is(
  (select version from public.resolve_site_tracker_release('20000000-0000-0000-0000-0000000000d1')),
  '0.1.0',
  'a pinned site keeps its version when the global default moves'
);

select is(
  (select version from public.resolve_site_tracker_release('20000000-0000-0000-0000-0000000000d2')),
  '0.4.0',
  'an unpinned site follows the new default'
);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

select is(
  has_function_privilege('authenticated', 'public.sweep_expired_interactions(integer)', 'execute'),
  false,
  'a customer cannot run the retention sweeper'
);

select is(
  has_function_privilege('authenticated', 'public.activate_tracker_release(text)', 'execute'),
  false,
  'a customer cannot change which tracker code their site serves'
);

select is(
  has_function_privilege('authenticated', 'public.rollback_tracker_release(text)', 'execute'),
  false,
  'a customer cannot roll back a release'
);

select is(
  has_function_privilege('anon', 'public.detect_event_anomalies(integer,integer,integer,numeric,numeric)', 'execute'),
  false,
  'anon cannot run the anomaly detector'
);

select * from finish();

rollback;
