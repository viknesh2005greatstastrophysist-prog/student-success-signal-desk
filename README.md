# AURA student-support ecosystem

AURA is a production-shaped, synthetic college simulation composed of six
independent websites, one central identity service, and one authoritative Core
API backed by PostgreSQL.

Start in the mentor portal. Use the sidebar to open a timetable, a mentee profile, or support and follow-ups. HoD Home contains department totals and shortcuts; individual students appear in Students.

The six connected portals are:

- Student: one semester course selection, timetable, progress and confirmed support.
- Parent: linked-child attendance, marks/GPA, simulated fee payment, receipts and mentor updates.
- Mentor: timetable/class records, assigned mentees, support decisions and follow-ups.
- HoD: department summaries, faculty/students, courses/timetables and AI controls.
- LMS: courses, lessons, assignments, private submissions and faculty feedback.
- AI Activity: review status, evidence, rules/model method, failure recovery and history.

This repository contains no real student data and performs no real payment.
Governance may propose support, but it cannot alter academic records or approve
its own artifacts.

## Chapter 11 agentic worklet

The connected worklet now includes four source collectors, a clarifying coordinator,
locked plans, risk calculation, scoped retrieval, three recommendation specialists,
validation and bounded repair, saved checkpoints, mentor edits and approval,
intervention tracking, and reversible publication. A configured local model can
make bounded recommendation choices; fallback is always labelled.

Start with the [submission guide](submission/README.md),
[project report](submission/PROJECT_REPORT.md), and
[14-lab acceptance ledger](docs/CHAPTER11_COMPLETION.md).
Run `cd platform && npm run chapter11:build` for the credential-free lab build.
The professor's real-case and actual mentor-approval requirements remain separate
from the included synthetic demonstration.

## Architecture

```text
Student site  ─┐
Parent site   ─┤
Faculty site  ─┼─> same-origin BFFs ─> Core API ─> Neon PostgreSQL
HOD site      ─┤          │                 │              │
AI Activity   ─┤
LMS           ─┘          └─ OIDC tokens    ├─ audit ledger
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

Requirements: Node.js 22.12 or newer, npm, and a PostgreSQL database.

```bash
cd platform
npm ci
cp .env.example .env.local
# Fill the private database connection and random secrets before continuing.
npm run initialize:local
npm run dev:local
```

The initializer requires separate local or test schemas, creates missing identity and Core tables, provisions public PKCE clients, and links the synthetic logins. It preserves an existing institutional generation. Use Node 22.12 or newer. For a new setup, see [LOCAL_SETUP.md](submission/LOCAL_SETUP.md).

Local services:

| Surface | URL |
| --- | --- |
| Student | `http://127.0.0.1:3101` |
| Parent | `http://127.0.0.1:3102` |
| Faculty | `http://127.0.0.1:3103` |
| HOD | `http://127.0.0.1:3104` |
| Governance | `http://127.0.0.1:3105` |
| LMS | `http://127.0.0.1:3106` |
| Identity | `http://127.0.0.1:3200` |
| Core API | `http://127.0.0.1:3300` |

Keep secrets in ignored `.env.local` files. Never commit database URLs, OIDC
client secrets or session secrets. Demo login itself requires no password.

## Verification

```bash
cd platform
npm run check
npm audit --omit=dev --audit-level=high
RUN_REBUILD_MUTATIONS=1 npx playwright test e2e/walking-skeleton.spec.ts
npx playwright test e2e/quality-gates.spec.ts
```

`npm run check` builds, lints, and type-checks all eight deployables, validates
the action manifest and security configuration, and runs Core unit tests. The
database integration test is opt-in and must target a disposable schema:

```bash
RUN_DB_TESTS=1 CORE_DATABASE_SCHEMA=aura_core_test_release npm run test:db --workspace=@aura/core-api
```

The three browser suites cover registration persistence, academic records reaching parents, simulated payment/receipt access, current-record AI reviews, mentor publication, six-portal navigation, accessibility and responsive layout. Database suites separately exercise scope, parent grants, concurrency, reconnect persistence, immutable versions and reversible publication.

## Deployment

Eight Vercel projects deploy a committed application release. Each has its own root directory and private environment. Verify the full release through every health endpoint, then fresh hosted sessions and cross-portal workflows. Do not reset production as test setup.

Stable production domains:

- <https://aura-student-portal.vercel.app>
- <https://aura-parent-portal.vercel.app>
- <https://aura-faculty-portal.vercel.app>
- <https://aura-hod-portal.vercel.app>
- <https://aura-ai-governance.vercel.app>
- <https://aura-lms-portal.vercel.app>
- <https://aura-identity-service.vercel.app>
- <https://aura-core-api.vercel.app>

See the current release procedure and rollback boundaries in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Release evidence is recorded in
`docs/RELEASE_EVIDENCE.md` only after exact-commit production verification.

## Current agreement and historical contracts

[`docs/PORTAL_EXPERIENCE_SPEC.md`](docs/PORTAL_EXPERIENCE_SPEC.md) is the current interface authority. The documents below retain earlier architectural and acceptance context; where they differ, use the six-portal agreement and latest release evidence.

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
