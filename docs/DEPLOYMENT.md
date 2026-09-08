# AURA deployment runbook

The release contains eight Vercel projects: six portals, Identity and Core. The current UX agreement is `PORTAL_EXPERIENCE_SPEC.md`. Use `RELEASE_EVIDENCE.md` for the deployed release and verified limitations.

## Release unit

| Project | Production domain |
| --- | --- |
| aura-student-portal | https://aura-student-portal.vercel.app |
| aura-parent-portal | https://aura-parent-portal.vercel.app |
| aura-faculty-portal | https://aura-faculty-portal.vercel.app |
| aura-hod-portal | https://aura-hod-portal.vercel.app |
| aura-ai-governance | https://aura-ai-governance.vercel.app |
| aura-lms-portal | https://aura-lms-portal.vercel.app |
| aura-identity-service | https://aura-identity-service.vercel.app |
| aura-core-api | https://aura-core-api.vercel.app |

Each project uses Node 22 and its `platform/apps/...` or `platform/services/...` root directory. Always name the Vercel project explicitly: the repository's local Vercel link is not an environment selector.

## Verify a candidate

Run npm commands from `platform/`. Install with `npm ci`, then run `npm run lint`, `npm run build:all`, `npm run typecheck`, `npm test`, `npm run test:core`, `npm audit --omit=dev --audit-level=high`, and `npm run chapter11:build`.

Run the four database suites explicitly against separate `aura_core_test_*` schemas. The generic Core suite deliberately skips those integration tests. Never reset the production schema to run tests.

`submission/LOCAL_SETUP.md` describes isolated local initialization. `prepare-lms-demo.ts` and `prepare-rebuild-browser.ts` are restricted to test schemas. With eight local services running, `RUN_REBUILD_MUTATIONS=1 npm run test:e2e` exercises registration, records, fees, mentor decisions and all six portal layouts. The tests default to local URLs. They preserve history instead of resetting the dataset.

## Apply and deploy

Commit the tested candidate and record its full SHA. For a scoped UI-only patch with unchanged data/auth contracts, deploy affected sites and record a per-component release map; do not imply every service runs the newest UI commit. Apply additive Core migrations using the private Core environment; verify the schema name before running. Provision six production OAuth clients using the private Identity environment with `AURA_CLIENT_PROFILE=production`. Reuse existing demo identities; the additive identity seed now links 24 fictional accounts without resetting existing passwords. Do not copy the local test-schema environment to production. See DEMO_COHORT.md for additive population; production resets are not part of that workflow.

Every portal needs `CORE_API_URL`, `AURA_IDENTITY_URL`, its own `PORTAL_ORIGIN`, and an independent `PORTAL_SESSION_SECRET`. LMS accepts the existing student, faculty and HoD roles; AI Activity also accepts the HoD. Private database and signing credentials belong in provider settings, never source or evidence files.

From the repository root, deploy Core and Identity first, then the six portals:

```bash
npx vercel deploy . --project PROJECT_NAME --scope TEAM_ID --prod --yes --force --env RELEASE_SHA=FULL_COMMIT_SHA --build-env RELEASE_SHA=FULL_COMMIT_SHA
```

Substitute verified project, team and commit values. Record each immutable deployment URL. If a provider failure interrupts release, inspect existing outcomes and resume only the missing components.

## Hosted acceptance

- Verify HTTP success, security headers and expected per-component `RELEASE_SHA` for all eight services. Core health is `/api/v1/health`; other services use `/api/health`.
- Check Identity discovery advertises the production issuer.
- Open fresh PINless demo sessions for all six portals. Verify HoD Home contains department summaries without individual students.
- Set the six `*_PORTAL_URL` variables to production and run the read-only quality suite. Inspect desktop and mobile captures.
- Exercise course → lesson → assignment → feedback on synthetic records; confirm changes persist across separate student/faculty sessions and reach the mentor's LMS evidence.
- Exercise a mentor decision and its student/parent publication without clearing existing records.
- Record the actual suggestion method. Rules with validation must not be described as hosted language-model execution.

Copy only safe screenshots and sanitized summaries into submission evidence. Browser traces, cookies, private environment files and authorization headers must stay outside the archive.

## Rollback and boundaries

Promote prior known-good deployments for affected projects, and verify a coherent release. PostgreSQL changes require a forward correction or reviewed provider recovery; changing the synthetic generation is not a database rollback.

PINless entry and simulated payments are deliberate demonstration settings. Real institutional operation requires actual authentication, approved data access, official grade/payment rules and a professor-approved case. The recurring release automation remains paused.
