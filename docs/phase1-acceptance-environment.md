# Phase 1 Acceptance Environment

Phase 1 acceptance must run outside production. Use a hosted staging Supabase project, staging dashboard deployment, staging Turnstile config, staging Resend config, and synthetic demo users only.

## Required Secrets

Set these in the staging deployment and in the local shell that runs the acceptance harness:

```text
VERIDIA_ENV=staging
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
VERIDIA_CREDENTIAL_ENCRYPTION_KEYS=
VERIDIA_CREDENTIAL_ENCRYPTION_KEY_VERSION=v1
TURNSTILE_SECRET_KEY=
VERIDIA_IP_RISK_KEY=
RESEND_API_KEY=
VERIDIA_EMAIL_FROM=
VERIDIA_EMAIL_REPLY_TO=
VERIDIA_WORKER_SECRET=
VERIDIA_ACCEPTANCE_APP_URL=
VERIDIA_ACCEPTANCE_RECIPIENT_EMAIL=
ACCEPTANCE_USER_PASSWORD=
ACCEPTANCE_TURNSTILE_SUCCESS_TOKEN=
ACCEPTANCE_TURNSTILE_FAILURE_TOKEN=
VERIDIA_PRODUCTION_SUPABASE_URL=
```

Do not commit real values. Keep production and staging secrets separate. `VERIDIA_PRODUCTION_SUPABASE_URL` lets the harness refuse accidental production runs.

## Generated Keys

Generate staging-only cryptographic material:

```bash
node -e 'console.log(crypto.randomBytes(32).toString("base64url"))'
node -e 'console.log(crypto.randomBytes(32).toString("hex"))'
node -e 'console.log(crypto.randomBytes(32).toString("base64url"))'
```

Use the first value as the credential encryption key payload:

```text
VERIDIA_CREDENTIAL_ENCRYPTION_KEYS=v1:<base64url-32-byte-key>
```

Use separate generated values for `VERIDIA_IP_RISK_KEY` and `VERIDIA_WORKER_SECRET`.

## Hosted Supabase

Apply the same migrations as production code. Do not create staging-only schema forks.

Minimum checks:

- all migrations applied
- RLS enabled
- RPC functions present
- indexes present
- auth admin API works for synthetic users
- service-role key is available only server-side

## Acceptance Fixtures

The harness creates only synthetic data:

- `acceptance.owner@example.com`
- `acceptance.agent@example.com`
- `acceptance.viewer@example.com`
- `acceptance.orgb.owner@example.com`
- `acceptance-veridia-demo-business`
- `acceptance-veridia-demo-other-business`

The controlled email recipient must be an acceptance-only address, such as `acceptance@example.test` or an address containing `+acceptance`.
