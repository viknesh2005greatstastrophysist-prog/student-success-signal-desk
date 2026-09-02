# AURA multi-portal deployment runbook

This runbook covers the seven-project Vercel release for the independent AURA
ecosystem. It supersedes the legacy Clerk single-portal procedure.

## Release unit

One application commit is deployed to seven projects:

| Project | Production domain |
| --- | --- |
| `aura-student-portal` | <https://aura-student-portal.vercel.app> |
| `aura-parent-portal` | <https://aura-parent-portal.vercel.app> |
| `aura-faculty-portal` | <https://aura-faculty-portal.vercel.app> |
| `aura-hod-portal` | <https://aura-hod-portal.vercel.app> |
| `aura-ai-governance` | <https://aura-ai-governance.vercel.app> |
| `aura-identity-service` | <https://aura-identity-service.vercel.app> |
| `aura-core-api` | <https://aura-core-api.vercel.app> |

All seven must report the same full application commit. A successful deployment
of an older commit is not a successful release.

## Preconditions

- The candidate commit is pushed to `multi-portal-architecture` and the worktree
  is clean.
- Node, package, static, Core, action-contract, and security tests pass.
- The database integration test passes against a disposable schema.
- `npm audit --omit=dev --audit-level=high` reports no high-severity production
  vulnerability.
- Production environment values exist in Vercel. Do not print or copy secrets
  into logs or evidence files.
- Migrations are forward-compatible and applied once with the unpooled database
  connection before application promotion.

## Candidate verification

From `platform/`:

```bash
npm ci
npm run check
npm audit --omit=dev --audit-level=high
RUN_DB_TESTS=1 CORE_DATABASE_SCHEMA=aura_core_test_release npm run test:db --workspace=@aura/core-api
```

Start all seven local services, reset the synthetic dataset, then run both
Playwright suites. The walking-skeleton suite must finish its reset, so a green
run also leaves the shared synthetic database in a known clean generation.

```bash
npx turbo run dev --parallel
npx playwright test e2e/walking-skeleton.spec.ts
npx playwright test e2e/quality-gates.spec.ts
```

## Production deployment

Run deployments from the repository root. Explicit project names prevent the
local `.vercel` link from silently sending code to the wrong project.

```bash
npx vercel deploy . --project aura-core-api --prod --yes --force
npx vercel deploy . --project aura-identity-service --prod --yes --force
npx vercel deploy . --project aura-student-portal --prod --yes --force
npx vercel deploy . --project aura-parent-portal --prod --yes --force
npx vercel deploy . --project aura-faculty-portal --prod --yes --force
npx vercel deploy . --project aura-hod-portal --prod --yes --force
npx vercel deploy . --project aura-ai-governance --prod --yes --force
```

Deploy Core and Identity first, then the five portals. If the provider quota or
another external limit interrupts the sequence, stop. Do not describe a partial
set as released and do not spend quota redeploying projects already proven to
serve the candidate commit.

## Exact-version verification

For every production URL:

1. Confirm HTTP success.
2. Confirm the expected Content Security Policy, HSTS, frame denial,
   `nosniff`, referrer, permissions, opener, and resource policies.
3. Confirm the portal footer contains the candidate commit prefix.
4. Confirm Core health reports the full candidate commit.
5. Confirm Identity discovery advertises the production issuer.

Then run the complete production journey three consecutive times using the
private demo PIN from the environment and `RELEASE_SHA` set to the full
candidate commit. Each pass begins from a deterministic generation and must
complete J01 through J10 without retrying failed assertions.

Run the production quality suite with a dedicated evidence directory. Inspect
the five desktop and five mobile portal screenshots manually. Inspect tablet
captures when any responsive boundary looks suspicious.

## Release evidence

Create `docs/RELEASE_EVIDENCE.md` only after the checks above are green. Record:

- full application commit and evidence commit;
- all seven stable domains and immutable deployment URLs;
- migration and seed version;
- static, database, security, three-journey, and quality results;
- screenshot inventory;
- deterministic agent mode exercised;
- optional live-model mode status;
- synthetic-only and sandbox-payment limitations;
- any accepted limitation and its owner.

Evidence must not contain session cookies, database URLs, PINs, OIDC secrets,
authorization headers, or raw environment output.

## Rollback

Promote the previous known-good deployment independently for each affected
project. Verify that all seven again report one coherent release before reopening
the demo. Application rollback does not roll back PostgreSQL. Use a reviewed
forward migration or Neon point-in-time recovery for schema or data incidents.

The Governance reset creates a new deterministic synthetic generation and keeps
prior audit history. It is not a database rollback and must never be described as
one.
