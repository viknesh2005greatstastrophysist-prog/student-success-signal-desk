# AURA project runbook

This edition uses the supplied college records and generated supporting operations. The hosted edition uses the six existing Vercel URLs; a separate private local launcher remains available. Original report units and academic periods remain unknown.

## Open the hosted project

The public links are Student `https://aura-student-portal.vercel.app`, Parent `https://aura-parent-portal.vercel.app`, Mentor `https://aura-faculty-portal.vercel.app`, HoD `https://aura-hod-portal.vercel.app`, AI Activity `https://aura-ai-governance.vercel.app` and LMS `https://aura-lms-portal.vercel.app`.

The private login card and exact six-portal presentation steps are in `runtime/hosted-project/PRESENTATION_GUIDE.md`. Student021 and its Family account are paired; Mentor3 is assigned to that student. LMS uses the same Student identity. Old PINless persona entry is disabled. Each portal requests a fresh account sign-in. Keep the six tabs open and enter the matching credentials.

The current source/deployment map, acceptance and model limitations are in `HOSTED_PROJECT_RELEASE_REPORT.md`. Stored Qwen runs originated locally. A new hosted review can use the validated rule path; activating new cloud model calls requires a funded reachable provider. Gateway returned 403 requiring a card on file.

## Start the private local project

Requires Node.js 22 or newer, npm, and a supported macOS/Linux/Windows host for the embedded PostgreSQL binary. Run these commands from `platform/`:

```sh
npm ci
npm run check
npm run project:setup
npm run project:start
```

The launcher creates a persistent private PostgreSQL database and 647 project accounts on first setup. Later starts preserve account passwords, records, edits and review history. Stop with Ctrl+C. Restart with the same command. Do not delete the private runtime folder to reset the application.

| Workspace | Address | Account |
|---|---|---|
| Student | http://127.0.0.1:3101 | Student account |
| Parent | http://127.0.0.1:3102 | Linked Family account |
| Faculty | http://127.0.0.1:3103 | Assigned mentor |
| HoD | http://127.0.0.1:3104 | Department head |
| AI Operations | http://127.0.0.1:3105 | Operations account |
| LMS | http://127.0.0.1:3106 | Same Student account |

Credentials are in `runtime/project-final/accounts.json`, outside Git. Open this file locally. It contains unique passwords and must remain private. Students and parents are paired by the generated cohort map; three mentors each have 107 students. The identity service uses port 3200, Core API 3300 and PostgreSQL 55432. All services bind to 127.0.0.1.

## Run agent reviews

The current workspace already contains the full-cohort review. A fresh source package has no database or credentials. Run its review after setup:

```sh
npm run project:command -- --import tsx services/core-api/scripts/run-project-agents.ts --final-cycle
```

For local model inference, set `CH11_MODEL` and `CH11_MODEL_BASE_URL` before first setup. The endpoint must be loopback and expose `/chat/completions` in the expected OpenAI-compatible format. The configured model for the verified run was `qwen3.8:27b-mlx` at a local endpoint. A model installation is not included in the source package. If no provider is configured, or every provider fails, nothing is drafted: the review waits as "AI unavailable, retry" with the audited reasons. There is no rule-based draft. Model errors are never silent successes.

Configuration is generated at `runtime/project-final/environment.json`. It contains secrets. Edit only locally while stopped; service and model URLs must remain loopback. Do not print it to terminal logs. When rotating the authentication secret, also invalidate the local signing keys and sessions before restarting, because private signing keys are encrypted with that secret. Preserve users and password hashes.

## Presentation route

1. Sign in as a Student. Open dashboard, registration, attendance, marks, timetable and college source records.
2. Use the same Student account in LMS. Open a lesson and submit an assignment.
3. Sign in as the assigned Faculty mentor. Open Academic support review, inspect evidence, edit the due date and save a new artifact version. Confirm that exact reviewed version with a rationale.
4. Refresh Student and linked Parent support. The approved plan is visible. Drafts are private to authorized staff.
5. Withdraw the intervention through Faculty review. It disappears from shared support. Restore it to planned to publish the same approved version again.
6. Open HoD for department operations and AI Operations for governed job history, policy, checks and recorded-run verification. Operations cannot approve or modify academic records.
7. Parent fees supports a local test payment and receipt. No money is collected.

Original report source notes preserve unknown meanings. Generated operational percentages are separate records, never inferred from unexplained source cells.

## Hosted verification

From `platform/`, run `node scripts/verify-project.mjs --hosted --student-index=24`. This changes the selected LMS submission, mentor case and project payment, and creates one fresh bounded rule review. Use a different fresh pending case when rerunning the full journey. Keep Student021/index20 for the presentation. Reports/screenshots are private under `runtime/hosted-project/`; call logs are sanitized to omit session cookies.

## Private local verification

```sh
node scripts/verify-project.mjs
```

This is a stateful acceptance harness using actual project account sign-ins. It respects authentication rate limits and tests all six workspaces. The full journey changes an LMS submission and a mentor plan, so use a fresh review or inspect its resulting state before rerunning. It writes private evidence under `runtime/project-final/` and redacts student names and register numbers from screenshots. Check its exit code and `browser-acceptance.json`; an old success file does not prove a later run passed.

Use `npm run check` for lint, type checking, eight application/service builds and unit checks. Database integration tests require a dedicated disposable schema; do not run fixture resets against the project schemas. Original files and live database files belong in private storage, never a public repository or deployment bundle.

## Delivery boundaries

The source archive includes the six original workbooks and their parsed private inputs, so keep the entire archive private. It excludes credentials, environment secrets, model weights, node_modules, build output and the current PostgreSQL cluster. Fresh setup creates new credentials and current operational dates. Nothing further is required to run this private edition. Public hosting is now implemented with named-data authorization and individual account logins. Verified institutional mappings and official report definitions remain separate inputs.
