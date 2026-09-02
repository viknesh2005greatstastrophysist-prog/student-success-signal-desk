# AURA five-portal academic ecosystem

AURA is a production-shaped, synthetic college simulation composed of five
independent websites, one central identity service, and one authoritative Core
API backed by PostgreSQL.

The portals are deliberately separate deployments:

- Student Portal: registration, published academics, fee status, approved
  support, and parent-grant control.
- Parent Portal: grant-scoped child academics, support, sandbox fee payment,
  and receipt export.
- Faculty Portal: assigned roster, attendance submission, mark publication,
  and accountable support decisions.
- HOD Portal: department-scoped people, course publication, faculty assignment,
  finance summary, and case oversight.
- AI Governance Console: evidence freezing, deterministic policy execution,
  validation, faculty handoff, audit, replay, export, and synthetic reset.

This repository contains no real student data and performs no real payment.
Governance may propose support, but it cannot alter academic records or approve
its own artifacts.

## Architecture

```text
Student site  ─┐
Parent site   ─┤
Faculty site  ─┼─> same-origin BFFs ─> Core API ─> Neon PostgreSQL
HOD site      ─┤          │                 │              │
Governance    ─┘          └─ OIDC tokens    ├─ audit ledger
                           Identity service  └─ deterministic agent runtime
```

Browser sessions are encrypted, HttpOnly, secure in production, and isolated
per portal origin. Mutations require a session-bound CSRF token, exact-origin
validation, server-owned role scope, input validation, optimistic concurrency,
idempotency, one database transaction, a domain event, and an audit row.

The implementation authority is [`platform/`](platform/). The earlier
single-portal prototype remains in the repository as historical reference and
is not part of this release architecture.

## Local development

Requirements: Node.js 20.9 or newer, npm, and a PostgreSQL database.

```bash
cd platform
npm install
cp .env.example .env.local
npm run prerequisites
npm run db:migrate
CORE_RESET_CONFIRMATION=AURA-SYNTHETIC-SEED-V1 npm run db:reset
npx turbo run dev --parallel
```

Local services:

| Surface | URL |
| --- | --- |
| Student | `http://localhost:3101` |
| Parent | `http://localhost:3102` |
| Faculty | `http://localhost:3103` |
| HOD | `http://localhost:3104` |
| Governance | `http://localhost:3105` |
| Identity | `http://localhost:3200` |
| Core API | `http://localhost:3300` |

Keep secrets in ignored `.env.local` files. Never commit database URLs, OIDC
client secrets, session secrets, or the private demonstration PIN.

## Verification

```bash
cd platform
npm run check
npm audit --omit=dev --audit-level=high
npx playwright test e2e/walking-skeleton.spec.ts
npx playwright test e2e/quality-gates.spec.ts
```

`npm run check` builds, lints, and type-checks all seven deployables, validates
the action manifest and security configuration, and runs Core unit tests. The
database integration test is opt-in and must target a disposable schema:

```bash
RUN_DB_TESTS=1 CORE_DATABASE_SCHEMA=aura_core_test_release npm run test:db --workspace=@aura/core-api
```

The walking skeleton is the binding cross-portal proof. It covers course
publication and registration, attendance and marks propagation, sandbox payment
and receipt access, grant revocation, governed support generation, exact-artifact
faculty decision, replay with zero academic side effects, CSRF/origin rejection,
deep links, and deterministic reset.

## Deployment

Seven Vercel projects deploy from the same repository and production branch.
Each project uses its own root or build configuration and production
environment. A release is not complete merely because Vercel returned seven
green builds. The exact application commit must be visible in every portal
footer and Core health response, then the production journey must pass three
times against clean seeded generations.

Stable production domains:

- <https://aura-student-portal.vercel.app>
- <https://aura-parent-portal.vercel.app>
- <https://aura-faculty-portal.vercel.app>
- <https://aura-hod-portal.vercel.app>
- <https://aura-ai-governance.vercel.app>
- <https://aura-identity-service.vercel.app>
- <https://aura-core-api.vercel.app>

See the current release procedure and rollback boundaries in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Release evidence is recorded in
`docs/RELEASE_EVIDENCE.md` only after exact-commit production verification.

## Project contracts

- [`docs/FULL_COLLEGE_ECOSYSTEM_BUILD_PLAN.md`](docs/FULL_COLLEGE_ECOSYSTEM_BUILD_PLAN.md)
- [`docs/MULTI_PORTAL_ARCHITECTURE.md`](docs/MULTI_PORTAL_ARCHITECTURE.md)
- [`docs/FIVE_PORTAL_ACCEPTANCE_CONTRACT.md`](docs/FIVE_PORTAL_ACCEPTANCE_CONTRACT.md)
- [`docs/TEST_STRATEGY.md`](docs/TEST_STRATEGY.md)
- [`docs/PREREQUISITE_AUDIT.md`](docs/PREREQUISITE_AUDIT.md)

## Honest limitations

- All people, records, money, and events are synthetic.
- Payment is a deterministic sandbox outcome, not a processor integration.
- The governed deterministic agent path is part of the release contract. The
  optional live-model composer remains unverified unless a release record says
  otherwise.
- A real college deployment still requires institutional SSO, authoritative
  SIS/LMS/ERP integrations, approved data-retention policy, key rotation,
  disaster-recovery drills, accessibility review, privacy review, and formal
  operational ownership.
