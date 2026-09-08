# Six-portal rebuild release evidence

Verified 8 September 2026. This section is the current handoff. Earlier release records below are historical.

## Deployed components

The six-portal backend release is `7243e5664b7de9d0b5d1ce950f93e1921470b5db`. All eight services were deployed and their health responses/security headers verified. A subsequent UI-only patch, `8b2677a92ae7ef04fc2f5b6bea44b11955f10e38`, updates the Mentor, HoD and AI Activity sites: review execution controls appear only for faculty/HoD with unfinished work. The AI viewing screen retains status and evidence controls. Student, Parent, LMS and Core retain the tested backend release. Identity now runs `f967727bde78c243c2418106d81536a31ef48506`, adding the cohort account choices with a compact selector for longer lists. The five roles and six OAuth clients are unchanged.

Exact stable URLs, immutable deployment URLs and per-component commits are recorded in `platform/artifacts/rebuild/production-deployments.json`. Baseline rebuild health/header evidence is in `production-health.json`; `platform/artifacts/cohort/production-health.json` verifies the newer Identity release and retained Core release. The source/evidence commit in the submission manifest may be newer because it includes documentation and screenshots.

## Implemented experience

- Student: one final course selection per semester, timetable, attendance/results/GPA and confirmed support. HoD can reopen registration with a reason.
- Parent: linked-child attendance, marks/GPA, simulated fee payment, downloadable demo receipts and shared mentor updates.
- Mentor: teaching timetable and class records, separate mentee assignments, complete scoped student profiles, decisions, follow-ups and outcomes.
- HoD: department summaries on Home; faculty, students, courses/timetables and scoped AI controls in separate sections. No individual students on Home.
- LMS: existing registrations → lessons → assignments → private submission versions → published scores and feedback. Files up to 2 MB are stored durably and access-controlled.
- AI Activity: actual review stages, timestamps, evidence, failure reasons and suggestion method. The mentor decides before publication. HoD/faculty can start/pause/resume/retry appropriate reviews.

Additive migrations 005 and 006 preserve the current synthetic generation. Six public OAuth clients use five roles; the cohort account seed now links 24 fictional identities. Demo entry requires no PIN. Teaching and mentorship are distinct. A mentor change immediately removes historical case/list/export access from the former mentor while preserving new-mentor case access and department oversight. Old audit/evidence records are not rewritten.

## Verification

The later ten-student population used source `f967727bde78c243c2418106d81536a31ef48506` against the existing generation `16e1d1b9-dceb-4a98-a827-517af57fb1e4`. Mentor distribution is 4–3–3. All ten students have courses, attendance, marks, results, a fee invoice and a follow-up. Three four-source reviews completed: six suggestions await mentor decisions and four students are not flagged. All 17 pre-existing registration, result, payment, LMS and support/review records checked by row hash were preserved unchanged. No production reset occurred. Exact cohort records and preservation evidence are in `platform/artifacts/cohort/`.

The population change passed Core/Auth/Contracts lint and type checks, the Identity production build, and all 18 Core unit tests. The new isolated cohort database test passed in 427 seconds, including a repeat with no duplicate events, preservation of a later manual mentor edit, all-ten-student scope checks, teaching permissions and retention of newly linked identity subjects through an explicit isolated reset. The other four database suites remain covered by the earlier rebuild results below. Current population data is fictional; its scripted review policies do not establish real faculty approval.

- Local lint: ten packages passed. All eight service builds and type checks passed. Seven platform and eighteen Core unit tests passed. Four database suites skipped by the generic command were run explicitly and passed: base regression, Chapter 11 lifecycle, LMS and portal experience.
- Mentor reassignment regression passed in 49.3 seconds, including the legacy dashboard, historical review list and direct evidence export. Core build/lint passed after the change.
- Hosted walking journey passed in 1.8 minutes: final registration, attendance and final results, parent visibility, simulated payment, receipt download, CSRF and role rejection.
- Hosted six-portal quality passed in 1.9 minutes: all primary sections, widths 390/768/1440, no serious/critical Axe findings, no tested page runtime errors or horizontal page overflow. Six phone captures and selected desktop/workflow captures were inspected.
- Hosted LMS manual journey passed: HoD published CS401 with Dr Mira Sen; Ananya registered once; faculty published a lesson and assignment; student opened the lesson and submitted a labelled demonstration answer; faculty published 18/20 and written feedback; a fresh student login showed the stored result.
- Hosted Chapter 11 journey passed in 2.3 minutes on the final Core: current academic/LMS records, four-source evidence, validated rules, mentor decision, student publication and HoD evidence inspection. Ananya's confirmed review scored 30/100 from the two synthetic career signals; recent LMS activity was not replaced with old fixture inactivity.
- The UI observer patch passed portal-kit lint/type checks and the three affected production builds. Final hosted observer verification is recorded in `hosted-acceptance.json`.
- Credential-free Chapter 11 build passed for eight students with equal sequential/parallel output quality. Controlled-I/O timing is not a production performance result.
- Production dependency audit: zero reported vulnerabilities at check time. Three-page Word/PDF report regenerated, rendered and inspected.

One AI-operator sign-in returned `session_failed` during concurrent hosted acceptance. Stored demo credentials were checked without exposing them. A fresh manual login and a complete subsequent quality run passed. The transient cause was not established; the failed run is not counted as a pass.

## Remaining academic and operational boundaries

All records are synthetic. Native academic/LMS workflows are connected; internship and placement inputs remain labelled synthetic fixtures. There is no institutional Contineo/ERP adapter or real payment processor. GPA uses an editable labelled ten-point demonstration scale until official rules are supplied.

Hosted agents use **Rules with validation**. The model adapter and earlier separately verified local Qwen demonstration remain in the repository. This release does not introduce a hosted model endpoint or claim newly verified cloud LLM execution, predictive accuracy, or improved student outcomes.

Chapter 11 section 11.2 and Lab 14 require a real case and actual mentor acceptance. The team must obtain professor acceptance of the synthetic substitute or demonstrate an authorized real case. Synthetic identities are not real faculty sign-off. The recurring release automation remains paused.

The submission excludes credentials, session traces and real student records. Use `submission/DEMO_SCRIPT.md` for the current walkthrough.

---

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

## 8 September 2026: password-free synthetic demo entry

At the project owner's request, the identity service no longer asks for or checks a demo PIN. Anyone with a portal URL can enter its assigned synthetic demo account; the role-based backend permissions and mentor publication gate remain in place. This mode is for synthetic demonstration data.

Identity release: `fb44da0b8628755df706530ea7711b6850dba3ae`, deployed at `https://aura-identity-service-gdnknuf4k.vercel.app` and the existing stable identity domain. Other services retain release `34424ecb136433a91d37fcafd1663ee637eaeedf`; the original seven-service release checks above describe the previous release.

Validation: identity lint/build passed; all seven platform contract tests passed. A fresh production Faculty sign-out/sign-in reached the role-scoped dashboard without entering any PIN or password. A failed/expired request now offers a registered portal homepage restart link, and display-only error parameters are removed before forwarding the signed OAuth query. No institutional data was changed during this check.

The earlier distributed ZIP and WhatsApp message describe PIN-based entry. The local submission archive has been refreshed with this change.
