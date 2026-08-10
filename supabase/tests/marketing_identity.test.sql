begin;

create extension if not exists pgtap;

select plan(11);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'marketing-owner-a@example.test', '', now(), now(), now());

insert into public.organizations (id, name, slug, status)
values
  ('10000000-0000-0000-0000-0000000000d1', 'Marketing Org A', 'marketing-org-a', 'active');

insert into public.organization_members (id, organization_id, user_id, role)
values
  ('11000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'organization_owner');

insert into public.sites (id, organization_id, name, status)
values
  ('20000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'Marketing Site A', 'active');

-- ---------------------------------------------------------------------------
-- Callers that predate marketing identity keep working
-- ---------------------------------------------------------------------------
-- The 19-argument call is the signature every existing caller uses. It must
-- still resolve after the function grew five defaulted parameters, otherwise
-- the migration is a breaking change disguised as an addition.

select is(
  public.ingest_interaction_event(
    '20000000-0000-0000-0000-0000000000d1',
    'evt_marketing000001', 'whatsapp_clicked', 'ses_marketing000001', now(),
    'example.com', '/iletisim', null, 'organic',
    null, null, null, null, null, '0.1.0', null,
    'accepted', 0, '{}'::text[]
  ),
  'accepted',
  'a call without marketing arguments is still accepted'
);

select is(
  (select visitor_id from public.conversion_events
   where event_id = 'evt_marketing000001'),
  null,
  'an event sent without consent stores no visitor id'
);

select is(
  (select gclid from public.conversion_events
   where event_id = 'evt_marketing000001'),
  null,
  'an event sent without consent stores no click id'
);

-- ---------------------------------------------------------------------------
-- Consented events carry identity through
-- ---------------------------------------------------------------------------

select is(
  public.ingest_interaction_event(
    '20000000-0000-0000-0000-0000000000d1',
    'evt_marketing000002', 'phone_clicked', 'ses_marketing000002', now(),
    'example.com', '/iletisim', null, 'paid_search',
    'google', 'cpc', null, null, null, '0.1.0', null,
    'accepted', 0, '{}'::text[],
    'vis_0123456789abcdef', 'gclid-value', null, null, 'fbclid-value'
  ),
  'accepted',
  'a consented event is accepted'
);

select is(
  (select visitor_id from public.conversion_events
   where event_id = 'evt_marketing000002'),
  'vis_0123456789abcdef',
  'the visitor id is stored'
);

select is(
  (select gclid from public.conversion_events
   where event_id = 'evt_marketing000002'),
  'gclid-value',
  'the google click id is stored'
);

select is(
  (select fbclid from public.conversion_events
   where event_id = 'evt_marketing000002'),
  'fbclid-value',
  'the meta click id is stored'
);

-- An empty string is a missing value, not a value. Storing "" would produce
-- audiences keyed on nothing.
select is(
  public.ingest_interaction_event(
    '20000000-0000-0000-0000-0000000000d1',
    'evt_marketing000003', 'form_started', 'ses_marketing000003', now(),
    'example.com', '/iletisim', null, 'direct',
    null, null, null, null, null, '0.1.0', null,
    'accepted', 0, '{}'::text[],
    '', '', '', '', ''
  ),
  'accepted',
  'empty marketing arguments are accepted'
);

select is(
  (select visitor_id from public.conversion_events
   where event_id = 'evt_marketing000003'),
  null,
  'an empty visitor id is stored as null'
);

-- ---------------------------------------------------------------------------
-- A quarantined event never enters an audience
-- ---------------------------------------------------------------------------
-- The risk model did not trust this event. Letting its identity through would
-- put suspected bot traffic into a remarketing list.

select is(
  public.ingest_interaction_event(
    '20000000-0000-0000-0000-0000000000d1',
    'evt_marketing000004', 'whatsapp_clicked', 'ses_marketing000004', now(),
    'example.com', '/iletisim', null, 'organic',
    null, null, null, null, null, '0.1.0', null,
    'quarantined', 80, '{bot_user_agent}'::text[],
    'vis_fedcba9876543210', 'gclid-quarantined', null, null, null
  ),
  'quarantined',
  'a quarantined event is quarantined'
);

select is(
  (select count(*)::integer from public.conversion_events
   where event_id = 'evt_marketing000004'),
  0,
  'a quarantined event writes no conversion row, so no identity is stored'
);

select finish();

rollback;
