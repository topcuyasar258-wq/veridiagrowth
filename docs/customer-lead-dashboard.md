# Customer Lead Dashboard

02D adds the customer-facing lead management surface for existing lead data.

Routes:

- `/dashboard`
- `/dashboard/leads`
- `/dashboard/leads/[leadId]`

The UI uses customer terminology only: Talep, Kaynak, Benzer Talep, İncelenmeli, Atanan Kişi. It does not expose ingestion, HMAC, Turnstile, worker, outbox, delivery, or other technical operations.

Reads are tenant-scoped through Supabase Auth and RLS. Lead list search and filters use the `list_customer_leads` RPC with explicit parameters, deterministic ordering by `created_at desc, id desc`, and a fixed page size of 25.

Mutations are available only through server actions that call controlled RPCs:

- `update_customer_lead_status`
- `add_customer_lead_note`
- `assign_customer_lead`

The browser never receives service-role credentials and does not perform unrestricted table updates.
