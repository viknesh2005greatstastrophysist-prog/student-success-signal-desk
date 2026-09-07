# Chapter 11 production release evidence

Verified 7 September 2026. This record supersedes older prototype deployment reports.

## Release identity

Application release: `34424ecb136433a91d37fcafd1663ee637eaeedf`. Its application tree is identical to tested commit `dc98bd4db2de6dac795bda4c051c11dbc6803733`.

Submission evidence and local setup improvements are committed separately on `chapter11-submission-evidence`. Resolve the evidence commit with `git log -1 --format=%H -- docs/RELEASE_EVIDENCE.md`; the archive's source commit is also recorded by Git archive metadata. These later setup/documentation changes are not claimed as the deployed application.

| Component | Stable URL | Immutable deployment |
| --- | --- | --- |
| aura-ai-governance | https://aura-ai-governance.vercel.app | https://aura-ai-governance-kt40avvh4.vercel.app |
| aura-hod-portal | https://aura-hod-portal.vercel.app | https://aura-hod-portal-9snirc151.vercel.app |
| aura-faculty-portal | https://aura-faculty-portal.vercel.app | https://aura-faculty-portal-fkzrx5ld5.vercel.app |
| aura-parent-portal | https://aura-parent-portal.vercel.app | https://aura-parent-portal-azklsjboh.vercel.app |
| aura-student-portal | https://aura-student-portal.vercel.app | https://aura-student-portal-9478es4d3.vercel.app |
| aura-identity-service | https://aura-identity-service.vercel.app | https://aura-identity-service-prcrzmzem.vercel.app |
| aura-core-api | https://aura-core-api.vercel.app | https://aura-core-jpyecq4kt.vercel.app |

All seven deployments reached READY. Every stable health endpoint returned HTTP 200 and the full application release. Eight expected security headers were checked on each service. Identity discovery advertises the production issuer. See `platform/artifacts/chapter11/production-{deployments,health,issuer}.json`.

## Acceptance results

- Local build/lint/types: 25 tasks passed. Platform tests: 7 passed. Core tests: 16 passed; the 2 intentionally skipped database tests were exercised explicitly in separate runs.
- Explicit Chapter 11 database acceptance and existing full database regression passed. Recovery, assignment scope, approval, edited-artifact replay and withdrawal/restoration were exercised.
- Production J01–J10: three consecutive passes, no assertion retries, 15.4 minutes total. Each began and ended with the synthetic reset.
- Production quality: passed in 1.5 minutes, 22 views, zero serious/critical Axe findings, no tested browser runtime errors, no horizontal overflow at 390, 768 and 1440 pixels.
- Five desktop and five phone captures were manually inspected. Fifteen captures are in `submission/cloud-screenshots/`; they show the reset generation before the subsequent Chapter 11 run.
- Local real-model Chapter 11 journey passed in 2.1 minutes. `qwen3.8:27b-mlx` produced a validated packet without fallback; local packet and screenshot evidence are retained separately.
- Cloud Chapter 11 acceptance passed in 4.0 minutes: plan clarification/lock, four sources, validated deterministic draft, mentor approval, separate student/parent publication, withdrawal/restoration, CSRF rejection and final accessibility assertions. `production-execution.json` is the pre-approval export; `production-faculty.png` and the subsequent browser assertions record the approved/restored state. The hosted demo is left in that state.
- Credential-free build: eight students across three domain specialists, identical sequential/parallel result hashes. Controlled source-I/O timing is not a production performance claim.
- Notebook: four code cells executed; outputs retained. Report DOCX/PDF: three pages rendered and visually checked.
- Dependency audit: zero reported production vulnerabilities at verification time.
- Fresh local initialization and a repeated initialization passed in isolated schemas. Repetition preserved the existing generation and linked five identities without duplicates. Production schema names are rejected before database access. Auth provisioning lint/type checks passed.

## State and limitations

Migration `004_chapter11.sql` adds durable Chapter 11 storage to the shared Core. The synthetic seed confirmation is `AURA-SYNTHETIC-SEED-V1`. Governance reset changes the active synthetic generation and preserves prior audit history; it is not a database rollback.

The hosted model endpoint is not configured. Cloud execution uses the explicitly labelled deterministic baseline. The actual language-model workflow runs on the configured local installation. Risk arithmetic, evidence checks and mentor approval are enforced in code in both modes.

External Contineo/LMS/internship/placement institution-specific integrations are not supplied; normalized synthetic sources demonstrate the interface. No predictive accuracy or improved student outcome is claimed. Payments are sandbox simulation only.

The professor's Chapter 11 section 11.2 and Lab 14 require a real case. Vik and the professor must resolve that through an authorized pilot or explicit acceptance of the synthetic substitute. Test mentor identities are not genuine faculty sign-off. This is the remaining academic closure requirement.

The submission excludes credentials, browser traces and real student records. The recurring release automation remains paused.
