# Lead Recovery Phase Gate

## Preflight checklist

- [ ] Correct repository and branch confirmed
- [ ] Base SHA recorded
- [ ] Working tree clean or unrelated changes identified and preserved
- [ ] Relevant `AGENTS.md`, master plan, state, phase prompt, and architecture docs read
- [ ] Current database migrations inventoried
- [ ] Baseline test commands executed or exact blocker recorded
- [ ] Staging target verified distinct from production
- [ ] Required secrets listed without printing values
- [ ] External account actions identified

## Slice completion checklist

- [ ] Slice requirements implemented and no next-slice scope added
- [ ] Database invariants enforced at the correct layer
- [ ] Positive tests added
- [ ] Negative/security/concurrency tests added where relevant
- [ ] Focused tests passed
- [ ] Documentation updated
- [ ] Diff reviewed for unrelated changes
- [ ] Commit created with a scoped message

## Local phase gate

- [ ] `npm ci`
- [ ] `npm run format`
- [ ] `npm run check:sql-arity`
- [ ] `npm run tracker:build`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:browser`
- [ ] `npm run build`
- [ ] `npm run test:client-bundle-secret`
- [ ] `supabase start`
- [ ] `supabase db reset`
- [ ] `supabase db test`

If infrastructure makes any item impossible, result is `BLOCKED`, not `PASS`, unless the phase prompt explicitly marks that item non-applicable and explains why.

## Staging phase gate

- [ ] Exact candidate SHA deployed to staging
- [ ] Staging project identity confirmed and production inequality guard passed
- [ ] Migrations applied without drift or destructive reset
- [ ] Synthetic owner, agent, viewer, second-tenant, and unauthenticated cases exercised as relevant
- [ ] Happy path exercised end to end
- [ ] Permission-denied and malformed-input cases exercised
- [ ] Duplicate/retry/concurrency behavior exercised
- [ ] Logs and Sentry inspected for PII/secret leakage
- [ ] Cleanup executed and verified
- [ ] Acceptance report committed

## Repair loop

For every failure:

1. Save the exact failing command/scenario and output summary.
2. Identify the root cause rather than weakening the assertion.
3. Add or strengthen a regression test that fails before the fix.
4. Implement the smallest safe fix.
5. Rerun the focused test.
6. Rerun the complete local gate.
7. Redeploy the exact new SHA and rerun staging acceptance if staging behavior could be affected.
8. Record both the failure and the final result.

Never delete, skip, quarantine, loosen, or mark flaky a failing test merely to advance a phase.

## Acceptance report template

Create `docs/acceptance/lead-recovery-phase-N.md` with:

```markdown
# Lead Recovery Phase N Acceptance

- Candidate SHA:
- Branch:
- Date/time UTC:
- Executor:
- Local environment:
- Staging environment:
- Production guard result:
- Result: PASS | FAIL | BLOCKED

## Changes verified

## Automated commands and exact results

## PostgreSQL/RLS evidence

## Browser/API evidence

## External provider evidence

## Failures found and repairs

## Security and privacy review

## Cleanup verification

## Known limitations

## Next allowed action
```
