# Staging Validation

Do not commit real URLs, project refs, service-role keys, or access tokens.

Use separate project refs:

- Staging: set `SUPABASE_STAGING_PROJECT_REF` locally or in CI secrets.
- Production: set `SUPABASE_PRODUCTION_PROJECT_REF` only in protected release workflows.

Before linking or applying migrations, confirm the target:

```bash
test "$SUPABASE_PROJECT_REF" = "$SUPABASE_STAGING_PROJECT_REF"
test "$SUPABASE_PROJECT_REF" != "$SUPABASE_PRODUCTION_PROJECT_REF"
```

Staging setup checklist:

1. Login with the Supabase CLI:

   ```bash
   supabase login
   ```

2. Link the staging project only:

   ```bash
   supabase link --project-ref "$SUPABASE_STAGING_PROJECT_REF"
   ```

3. Review migration drift before applying:

   ```bash
   supabase db diff --linked
   supabase migration list
   ```

4. Apply migrations to staging:

   ```bash
   supabase db push --linked
   ```

5. Apply non-production seed/test users only when staging is confirmed:

   ```bash
   test "$SUPABASE_PROJECT_REF" = "$SUPABASE_STAGING_PROJECT_REF"
   supabase db execute --linked --file supabase/seed.sql
   ```

6. Run smoke checks:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   NEXT_PUBLIC_SUPABASE_URL="$STAGING_SUPABASE_URL" \
     NEXT_PUBLIC_SUPABASE_ANON_KEY="$STAGING_SUPABASE_ANON_KEY" \
     SUPABASE_SERVICE_ROLE_KEY="$STAGING_SUPABASE_SERVICE_ROLE_KEY" \
     npm run build
   ```

7. Verify RLS manually with staging test users:

   ```sql
   select count(*) from public.organizations;
   select count(*) from public.sites;
   select count(*) from public.audit_logs;
   ```

   Run these as owner, agent, viewer, unauthenticated, and service-role contexts. Customer users must never read `audit_logs`.

Production guardrails:

- Never run `supabase db reset` against linked staging or production.
- Never use production project refs in pull-request CI.
- Keep staging and production secrets in separate secret stores.
- Require a human approval gate before any production `supabase db push`.
