# AURA project runbook

This edition uses the supplied college records and generated supporting operations. Everything runs on this computer. Original report units and academic periods remain unknown.

## Start the delivered project

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

For local model inference, set `CH11_MODEL` and `CH11_MODEL_BASE_URL` before first setup. The endpoint must be loopback and expose `/chat/completions` in the expected OpenAI-compatible format. The configured model for the verified run was `qwen3.8:27b-mlx` at a local endpoint. A model installation is not included in the source package. If no provider is configured, the pipeline uses its deterministic policy path. Model errors use explicit validated fallback, never silent success.

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

## Verification

```sh
node scripts/verify-project.mjs
```

This is a stateful acceptance harness using actual project account sign-ins. It respects authentication rate limits and tests all six workspaces. The full journey changes an LMS submission and a mentor plan, so use a fresh review or inspect its resulting state before rerunning. It writes private evidence under `runtime/project-final/` and redacts student names and register numbers from screenshots. Check its exit code and `browser-acceptance.json`; an old success file does not prove a later run passed.

Use `npm run check` for lint, type checking, eight application/service builds and unit checks. Database integration tests require a dedicated disposable schema; do not run fixture resets against the project schemas. Original files and live database files belong in private storage, never a public repository or deployment bundle.

## Delivery boundaries

The source archive includes the six original workbooks and their parsed private inputs, so keep the entire archive private. It excludes credentials, environment secrets, model weights, node_modules, build output and the current PostgreSQL cluster. Fresh setup creates new credentials and current operational dates. Nothing further is required to run this private edition. Verified institutional access, official report definitions and public hosting remain separate launch inputs.
