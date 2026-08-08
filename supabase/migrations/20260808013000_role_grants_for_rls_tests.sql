grant usage on schema public to anon, authenticated, service_role;

grant select on
  public.organizations,
  public.organization_members,
  public.sites,
  public.site_domains,
  public.audit_logs,
  public.leads,
  public.lead_attributions,
  public.lead_status_history,
  public.lead_notes,
  public.site_credentials,
  public.used_nonces,
  public.idempotency_records
to anon, authenticated;

grant insert, update, delete on
  public.organizations,
  public.organization_members,
  public.sites,
  public.site_domains
to authenticated;

grant insert on public.lead_notes to authenticated;

grant all on
  public.organizations,
  public.organization_members,
  public.sites,
  public.site_domains,
  public.audit_logs,
  public.leads,
  public.lead_attributions,
  public.lead_status_history,
  public.lead_notes,
  public.site_credentials,
  public.used_nonces,
  public.idempotency_records
to service_role;
