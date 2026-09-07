# Chapter 11 completion ledger

Authority: Chapter 11 of `Agentic_AI_15_Worklets_14Lab_Build_Book.docx`, read on 7 September 2026. This ledger supersedes the older requirements mapping wherever it claimed equivalence without testing the actual lab acceptance criterion.

## Objective

One deployed, connected student-support workflow: clarify and lock a plan; collect four authorized sources; calculate transparent risk; retrieve scoped references; draft and validate recommendations; repair bounded failures; pause for mentor approval; publish, track, export and roll back. The five portals share the same backend state.

## Execution milestones

1. Correct acceptance mapping and establish the current baseline.
2. Implement typed coordinator, connector, specialist workers, retrieval, policy and validation contracts in the current backend.
3. Add durable plans, checkpoints, cohort execution and mentor decisions to the shared database and portals.
4. Verify failure recovery, privacy, citations, model/fallback behavior, approval and rollback.
5. Verify the complete browser journey and deploy the exact tested release.
6. Produce submission guide, architecture, lab evidence, demo script and limitations.

## Acceptance requirements

| Lab | Implementation and evidence | Remaining boundary |
| --- | --- | --- |
| 1 | Typed coordinator asks three missing constraints; editable, versioned plan then hash lock; unit and browser checks | No arbitrary natural-language tool autonomy |
| 2 | Four source envelopes, normalized percentages and transparent policy arithmetic; boundary tests | External sources use synthetic normalized fixtures |
| 3 | Reusable `planSkill` and `formatSkill`; executable notebook | None for the demonstrated scope |
| 4 | Scoped tags plus cosine ranking of lexical embeddings; prior support history separate from checkpoints | Not a pretrained semantic embedding model |
| 5 | Authenticated Core connector routes and typed source interface; assignment scope checks | Institution-specific Contineo/LMS adapters require authorized source contracts |
| 6 | PostgreSQL checkpoints, leases, timeout, concurrency and repair budgets; reconnect/resume test | Four jobs per request; repeat to continue larger cohorts |
| 7 | Explicit collection, validation, risk, recommendation, repair and mentor stages | Implemented in TypeScript; book pseudocode is language-neutral |
| 8 | Eight-student sequential/parallel comparison with identical output hashes; candidate selection recorded | Controlled source-I/O timing, not a production load test |
| 9 | Exact evidence paths/statements and full trigger coverage; unsupported prose rejected | Synthetic evidence is not verified institutional evidence |
| 10 | Field-level repairs, two-attempt budget, injected failures and labelled fallback | Model availability is external |
| 11 | `npm run chapter11:build` emits artifact, hashes and acceptance report; publish hard gate | Credential-free build does not publish |
| 12 | Assigned mentor edits, exact-version approval, outcomes, withdrawal/restoration, role and browser tests | Test identities are not actual faculty approval |
| 13 | Academic, attendance and wellbeing-referral registry; all three validated in cohort build | Approved action catalogue intentionally bounds model freedom |
| 14 | Five connected portals and complete local model journey implemented; hosted release verification in progress | Real-case demonstration and actual mentor approval remain external |

## Claim boundaries

- Existing Python tests passing does not prove all labs are satisfied.
- Synthetic records and demonstration thresholds are not institutional data or faculty approval.
- Model execution, fallback execution and test doubles must be separately reported.
- No agent directly contacts students or changes marks, attendance or financial records.
- A real-case demonstration requires authorized data, or faculty acceptance of a synthetic substitute. Neither may be invented.
- Automated release scheduling remains paused; this user-authorized run performs work directly.

## Verification log

7 September 2026:
- `npm run check`: 25 build/lint/type tasks, 7 platform tests and 14 Core tests passed; 2 database tests deliberately skipped in the generic suite.
- Explicit Chapter 11 database suite passed, including reconnect/resume, scoped approval, edited-artifact replay and withdrawal/restoration.
- Existing full database regression passed after migration table/trigger counts were updated.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- Credential-free build: 8 students, 3 specialists, identical sequential/parallel results. Exact measured timing is in `platform/artifacts/chapter11/build-acceptance.json`.
- Notebook: all four code cells executed successfully; outputs retained.
- Live local model `qwen3.8:27b-mlx` passed the standalone packet check. A later browser run exposed a 20-second timeout; the bounded timeout is now 45 seconds with a 180-second job lease. Final browser rerun passed with real-model execution after correcting the local reasoning-channel response format.
- Earlier full browser checks also identified low-contrast Governance text and a stale expected label in the older journey test; both corrected before the rerun.
- Submission report DOCX and PDF rendered and inspected across all three pages. Source, notebook and demo script are in `submission/`.
- Production Core environment has no Chapter 11 model credential or endpoint. Cloud live-model execution must not be claimed.

Final local acceptance:
- Chapter 11 live-model browser journey: passed in 2.1 minutes. Evidence exported before mentor approval; the subsequent browser assertions verified approval, separate student/parent views, withdrawal, restoration, responsive layouts and accessibility.
- Existing J01-J10 browser journey: passed in 2.2 minutes after updating its renamed label and reusing the already authenticated Governance session.
- All-portal quality suite: passed after fixing Governance text contrast.
- Latest explicit database integration rerun: passed after a transient network interruption. No failed or cancelled run is counted as a pass.
- Ten Chapter 11 unit tests pass, including final-answer decoding and malformed-output repair.
- Model transport follows the distinction between thinking and final content described in https://docs.ollama.com/capabilities/thinking; the observed local compatibility response included a closing thinking delimiter, now decoded before packet validation.

- Final `npm run check` after all fixes: 25 tasks passed, 7 platform tests passed, 16 Core tests passed; 2 database-only tests skipped there and exercised separately.
