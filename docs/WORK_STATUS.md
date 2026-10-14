# Work status — 15 October 2026, final verification (rework worker 4 of 4)

Durable handoff note so no state lives only in a chat session. Update this file whenever the state below changes. Everything above the line "Older notes" is the current state; everything below is history, newest first.

## Current state

**What works (verified 15 Oct, local database and hosted app)**

- Per-role pages (student, parent, mentor, department head, AI activity), realistic generated data (v2) with attendance anchored to the college report (v3), the Apple-style design, non-typeable pickers. Read-only walk `walk.py --pass final`: 9 sessions, 140 views, 94 screenshots, 0 exceptions, 0 error alerts, 0 console errors, 0 failed requests, 0 overflow, 0 truncated, 0 leaked text, 0 walk errors, 0 forbidden pages.
- Live agentic run (C3, now done): planner, investigator, Academic, Attendance and Wellbeing-referral specialists, packet validator, regenerator (real diagnoses, plus an escalation after the repair budget), judge (scored every draft, injected low score repaired), human gate (Today to gate, edit, revalidate, approve, publish), student, parent, HoD and AI activity views, evidence export. Hosted: one student end to end (mentor1 approves, student and parent see the plan). Evidence: `docs/E2E_TEST_LOG.md`, "Pass 3 / final". About 26 to 34 Groq calls, 0 Gemini.
- Checks at HEAD: Core `tsc` and eslint clean, Core tests 207 (198 pass, 9 opt-in skipped), platform tests, the four DB suites in disposable local schemas (all dropped), `check:engine` passes, every `verify_*.py` except `verify_local.py` and `verify_cloud.py` passes (new: `verify_bridge_pool.py`), CI green on the previous push.

**Hosted speed (the owner's "abhorrently slow")** — `docs/E2E_TEST_LOG.md`, "Rework: hosted speed". Cause: the app runs in the US, Neon is in Singapore (`ap-southeast-1`), about 0.23 s per database round trip and 12 to 25 sequential round trips per engine call. Sign-in to landing page 8.7 to 13.4 s before, 4.7 to 6.5 s after the round-trip cuts; engine pages 4 to 7.5 s before, 2.6 to 4.8 s after; pages without an engine call 0.43 s (browser round trip). The real fix is to move Neon to a US region (owner action, steps in the log); expected result: page switches near 0.5 s.

**Engine**: one Node engine per process, now three processes behind `bridge.py` (two readers, one agent process for planner, plan run and replay), started lazily and warmed while the sign-in card is shown. Sessions and leases are in the database, so any process serves any request.

**Open list**

1. Move Neon to a US region (owner, Neon console; steps in the E2E log). Until then hosted pages that read the database take 2.6 to 4.8 s.
2. Fewer sequential queries inside the Core reads (`experienceOverview`, `experienceStudent`: about ten each); return the role's first batch from the sign-in call (about 0.9 s hosted).
3. The mentor's Risk view shows the last stored evaluation, which can be stale against today's data (P3: show the evaluation date or refresh).
4. A rewrite that fixes one validator failure can create another (length limit); the length-failure instruction does not quote the sentence (P3).
5. Parent-student pairing unchanged; LMS inactivity grows daily because the evidence reads the clock; attendance is "based on the college attendance report", not raw registers; the future option of the college's real course codes (rework 2b) is undecided.
6. Vercel portals remain paused (503) by owner decision; Codex's subscription ended 14 Oct (Claude implements under a usage cap).

**Pushing.** Plain `git push` fails (keychain holds `vikneshwaranmarimuthu-cmyk`; the repo belongs to `viknesh2005greatstastrophysist-prog`): `gh auth switch --user viknesh2005greatstastrophysist-prog >/dev/null && git -c credential.helper='!gh auth git-credential' push origin streamlit-college-project; gh auth switch --user vikneshwaranmarimuthu-cmyk >/dev/null`. Streamlit Cloud redeploys on every push (about two minutes).

**Servers.** Local runs use 8503 (own server, stopped afterwards); 8502 belongs to another session. Local Postgres 127.0.0.1:55432 `aura_project`.

---

## Older notes (history, newest first)


## Rework 2b (15 Oct): attendance anchored to the college report (worker 2b)

Full numbers and method: `docs/E2E_TEST_LOG.md`, "Rework: realistic data", subsection "v3: attendance from the college report".

- Data generation `realistic-v3` (additive, audited, deterministic; same CLI: `att-plan`, `att-apply`, `att-supersede`, `att-stats`; code in `platform/services/core-api/lib/data-refresh/attendance.ts` and `attendance-apply.ts`). Per student the anchor is the mean of the numeric "Recorded attendance" cells (0 to 100) in `project_dataset` (320 of 321 students; one gets a generated anchor from the real distribution). The three app courses get anchor + course effect + student shift + noise, clipped to 0 to 100, on 40 sessions per course (30 added per course, 28,800 records added, 4,259 existing generated records revised with the previous image in `record_changes`). The percentage is no longer a 40/60/80/90 pattern; the courses differ; each student's overall level is within 2.7 points of their anchor on average.
- Applied to the LOCAL database and to hosted Neon (`aura_hosted_project_core` only) after fresh backups; open drafts on the old attendance were marked `superseded` through the audited path (local 9, hosted 3); fresh drafts through the real pipeline (local 4, hosted 2; 15 Groq calls, 0 Gemini). `project_dataset`, evidence snapshots and student 021 (`d398bbc3`, `awaiting_faculty`) are byte-identical before and after on both databases.
- Labelling: the Core adds `attendanceBasis: "college_attendance_report"` to the academic evidence of every student whose attendance was rebuilt (not student 021); the draft provenance panel shows "Attendance figures: College attendance report (... not raw register entries)", and the student, parent and staff attendance views carry a one-line note. Source records (staff only) are unchanged: the original cells.
- **Future option for the owner:** move the app itself onto the college's real course codes (for example 25ECAC220) instead of the three generated courses CS401 to CS403, so attendance, marks and sessions all use the real course identities. Not done: it needs new offerings and registrations, the mapping the project deliberately avoided, and a decision on what the college's per-course cells mean (their unit and definitions are unconfirmed).
- Backups: `runtime/backups/local-pre-attendance-v3-20261014T212040-20261014T212041.sql` and `runtime/backups/neon-hosted-pre-attendance-v3-20261014T212713-20261014T212818.sql` (git-ignored; `pg_dump` is not installed, so `platform/scripts/dump-schemas.mjs`).
- Replays: old evidence snapshots keep their stored numbers, but the live attendance rows behind them changed (as the marks did in v2), so an investigator replay of an already superseded case no longer reproduces its old figures. Expected; those cases are superseded.

## Rework 2 (15 Oct): realistic generated data (worker 2 of 4)

Owner decisions: `~/Personal Brain/brainstorms/2026-10-14-aura-app-rework.md`. Full before/after numbers, method and limits: `docs/E2E_TEST_LOG.md`, "Rework: realistic data".

- Data generation `realistic-v2` applied to the LOCAL database and to hosted Neon (`aura_hosted_project_core` only; `aura_core` and `aura_identity` untouched). Additive and audited: changed rows keep their whole previous image in `record_changes`; the generation is a row in the new append-only `data_generations` table (migration 011, which also allows the case status `superseded`). No delete, no reset. Deterministic generator and CLI in the repo: `platform/services/core-api/lib/data-refresh/` and `scripts/refresh-generated-data.ts` (commands `plan`, `apply`, `policy`, `supersede`, `stats`, `candidates`, `drafts`; always pass `--exclude-email student021@aura.project.test --exclude-case d398bbc3`; `apply` refuses a repeat).
- Results (320 students): the three courses now differ (mean 61.9, 68.2 and 70.3, SD 15.3, 13.4 and 12.3; below 40 in 7.2%, 1.5% and 0.6%); LMS inactivity right-skewed (128 students at 0 days, tail to 20+); overdue assignments mostly 0 or 1; fees 78% paid, 18% partly paid, 4% overdue; internships and placements by semester; mentor loads 112, 113 and 96 by section; risk scores spread (49 distinct values, graded) instead of 4.
- Scoring: new policy field `severity: "graded"` (points scale with the distance beyond the faculty-set threshold; thresholds and weights unchanged; old policies and replays unchanged). `PROJECT-SUPPORT-V2` approved for the three mentors through `approvePolicy`, with V1 kept.
- Review queue: 163 stale open drafts (156 hosted) marked `superseded` through an audited path; student 021's case `d398bbc3` still `awaiting_faculty`, untouched. Fresh drafts through the real pipeline (Groq first): 9 local (three per mentor, attendance, academic and wellbeing routes), 3 hosted plus one escalated to the mentor after its repair budget; 38 Groq calls, 0 Gemini.
- Backups before hosted changes: `runtime/backups/neon-hosted-pre-refresh-20261014T204224.sql` (and the local one, `local-pre-refresh-20261014T195236.sql`), git-ignored, restore-tested table by table. `pg_dump` is not installed, so `platform/scripts/dump-schemas.mjs` produced them.
- Real attendance: `project_dataset` and all 9,630 attendance records unchanged (md5 checks before and after, both databases). **Finding for the owner:** the attendance the app shows and scores is itself a generated pattern (4, 6, 8 or 9 of 10 present, identical in all three courses), not the supplied college cells; it was left as is because of the never-change rule. Deriving it from the supplied cells was then done in rework 2b (above).
- Also fixed: the roster egress guard blocked every wellbeing-referral draft because the generated parent names contain the word "family" (now a stopword); the parent's fee totals counted voided invoices.
- Checks: Core tsc, eslint, 198 tests (189 pass, 9 opt-in skipped); four DB suites in disposable local schemas (dropped); engine rebuilt and `check:engine` passes; every `verify_*.py` except `verify_local.py` and `verify_cloud.py` passes; read-only walk `--pass data1`: 134 views, all counters 0. Servers: own server on 8503 started and stopped; 8502 never touched.
- Open: the hosted app was not opened (private; it reads the same Neon data and redeploys on push); parent-student pairing unchanged; LMS inactivity grows by a day each day because the evidence reads the clock; the shown attendance (above).

## Rework 1 (15 Oct): structure, speed and drop-downs (worker 1 of 4)

Owner decisions: `~/Personal Brain/brainstorms/2026-10-14-aura-app-rework.md`. This worker did the information architecture, speed and drop-down fix; the Apple-style visual system (worker 3), data regeneration and the live run (worker 4) are separate.

- Step 0 (fix pass C) verified and pushed (`46f9a71`, `977526b`, `0e8c8f8`): Core tsc and eslint clean, platform tests 7/7, Core tests 180 (171 pass, 0 fail, 9 skipped opt-in), the four DB suites on the LOCAL Postgres in disposable `aura_core_test_*` schemas (all dropped), engine rebuilt and `check:engine` passes, every `verify_*.py` except `verify_local.py` and `verify_cloud.py` passes. `live_run.py` not run.
- Commits on top: `90324c6` (engine: batched read action, `sources` refused to student and parent), `23950ca` (Streamlit: per-role pages, new IA, non-typeable pickers, batched reads, fragments, verify scripts, CI step), `383fad8` (E2E: timing script, drop-down check, walk), `ad9f43e` (engine: sign-in runs its independent checks together; `verify_ui` checks staff-only sources), then a docs commit. Pushed with the account switch below; CI result in the final message of the session.
- Layout: `streamlit_app/app.py` (thin entry, `st.navigation`), `common.py`, `auth.py`, `views/{student,parent,mentor,hod,operations,lms,profile,sources,reviews,metrics,pages}.py`, `apptest_util.py` (AppTest helpers: open a page by URL path, pick by label, the old single-module namespace for the offline scripts). Pages per role are in `docs/E2E_TEST_LOG.md` ("Rework 1") and the README.
- Speed: see `docs/E2E_TEST_LOG.md`, "Rework: speed". Locally every page was already under the targets; with a simulated 60 ms database round trip, cold page switches went from a 1.38 s median and 3.33 s worst to about 0.12 s median and 1.95 s worst, warm switches stay about 0.1 s, and sign-in plus landing page is 2.8 to 4.1 s (was 3.9 to 5.6 s; not under 2 s). Hosted timing not measured (private app).
- Drop-downs: no typing anywhere (`filter_mode=None`; up to seven plain options are segmented controls; search boxes for long lists); verified in a real browser, 23 drop-downs, 0 failures. Known limit: the two student multi-selects inside the plan forms have no live search.
- Walk `--pass rework1`: 9 sessions, 136 views, 0 exceptions, 0 error alerts, 0 console errors, 0 failed requests, 0 overflow, 0 truncated, 0 leaked-text, 0 walk errors, 0 forbidden pages.
- Servers: own server on 8503 started and stopped; 8502 never touched. Live model calls: 0 Groq, 0 Gemini. Student 021 and `d398bbc3` untouched. No database change (additive or otherwise).
- Open: an HoD "decision turnaround" is shown as the median wait of open drafts plus decisions made and the last decision time, because the Core records no draft-to-decision duration per plan; the sidebar shows the navigation above the brand (visual pass); the engine runs one request at a time per process (a long plan run blocks other users' reads on the same app instance; a small engine pool would help the hosted app but was out of scope); no GitHub Actions ping (the app is private and a plain request does not wake a sleeping Community Cloud app).

## Where the code is

| Item | State |
|---|---|
| Branch | `streamlit-college-project` |
| HEAD | See `git log`: speed commits `604bf39` (engine) and `c09a87c` (bridge), then the E2E harness, then the docs commit (final verification, rework worker 4). Earlier fix-pass history is in the sections below. |
| Hosted Streamlit (aura-college-workspace.streamlit.app) | Public; serves the latest push (verified 15 Oct: the Apple sign-in and the faster engine are live). `GROQ_API_KEY` is in its secrets `[aura]` section. Timings: E2E log, "Rework: hosted speed". |
| Vercel portals (8) | Paused by owner decision. Still 503. |
| Local | `.venv/bin/streamlit run streamlit_app/app.py` on 127.0.0.1:8501 (Codex) / 8502 (Claude) / 8503 (rework runs). Local Postgres 127.0.0.1:55432 `aura_project`. |

**Pushing.** Plain `git push` fails here (keychain holds `vikneshwaranmarimuthu-cmyk`; the repo belongs to `viknesh2005greatstastrophysist-prog`). Both accounts are signed in to `gh`, so push with:
`gh auth switch --user viknesh2005greatstastrophysist-prog && git -c credential.helper='!gh auth git-credential' push origin streamlit-college-project && gh auth switch --user vikneshwaranmarimuthu-cmyk`.
Streamlit Cloud redeploys from the branch on every push. Codex's subscription ended 14 Oct; Claude implements under a strict usage cap (one agent at a time).

## Live agentic run, round 2 (14 Oct evening, Claude as mentor, Groq first)

- What ran: `streamlit_app/e2e/live_run.py` (staged, headless Chromium, real UI, LOCAL server on 8503 and local Postgres, fixture accounts; screenshots and `state.json` in git-ignored `runtime/streamlit-project/e2e/live2/`). Server env: `CH11_PROVIDER_ORDER=groq,gemini,configured` and `CH11_LIMITER_MAX_WAIT_MS=65000` (E2E log #34).
- Case ids: plan `909398ad-5799-4f15-99ef-ba1900cba87d` (3 high-risk mentees, none of them student 021); reviews `aaaf970c`, `e75d0d4e`, `0a125f32`; approved and published case `fbe05729-3a90-4110-a05d-8cbc33841059` (Preetam G, 01FE24BCI018), edited from version 1 to 3 and revalidated before approval.
- Groq completion calls: about 50, not metered (planner 6, investigator about 35, draft about 6, 2 real 429s), a few over the 45 budget because the failed attempts before the #33 fix re-ran the investigators. Gemini and local Qwen: 0.
- Honest statement: the lab-manual definition-of-done flow was exercised end to end with Claude acting as the mentor (describe, planner questions, lock, run, validated AI drafts, mentor edit, revalidation, approval, publish, student and parent views, HoD and AI activity counts, evidence export) on the local database. It is a test run by Claude, not a sign-off by real faculty. Not exercised live: regenerator and diagnoses, the attendance and wellbeing-referral specialists, the judge (not wired).
- Fix made: #33 (P1), `464dec0`: one review per request for a budgeted remote model, with a test; engine rebuilt, `check:engine` passes. Open: #34 to #39 (E2E log).
- Read-only walk `walk.py --pass 2c` (own server 8503): 9 role and workspace sessions, 254 views, 0 Streamlit exceptions, 0 error alerts, 0 browser console errors, 0 failed requests, 0 horizontal overflow, 0 truncated views, 1 leaked-text finding and 1 walk error..
- Hosted run: blocked, app private (303 to `share.streamlit.io/-/auth`). Open item.
- The server on 8503 was stopped afterwards; 8502 (another session) was never touched.

## Verification at HEAD (run 14 Oct, fix pass B: data correctness)

- Core `tsc --noEmit` and eslint clean. Core tests 166: 157 pass, 0 fail, 9 skipped (opt-in DB suites; baseline 163: 154 pass). New: `chapter11-counts.test.ts` (3: awaiting drafts collapse to one per student with history, one latest risk row per student, evaluation totals). The agents DB suite now asserts that the queue, its count and the overview count agree for the mentor and the department head, and that a legacy draft is never counted.
- Opt-in DB suites on the LOCAL Postgres (127.0.0.1:55432) in disposable schemas `aura_core_test_pb1`, `aura_core_test_ch11_pb2`, `aura_core_test_ch11_agent_pb3`, `aura_core_test_ch11_lease_pb4` (all dropped afterwards; nothing run against hosted Neon): `database.test.ts` 1/1, `chapter11-database.test.ts` 1/1, `chapter11-agents-database.test.ts` 2/2, `chapter11-lease-database.test.ts` 1/1.
- `node scripts/build-streamlit-engine.mjs` run; `npm run check:engine` passes.
- Python (`.venv/bin/python`): `verify_data_counts.py` (new, offline, added to the CI Streamlit job), `verify_draft_v2.py`, `verify_agent_trace.py`, `verify_read_cache.py`, `verify_ai_only_ui.py`, and against the local database `verify_ui.py` (6 logins, 21 pages), `verify_attachments.py`, `verify_chapter11_dashboard.py`, `verify_chapter11_trends.py` (now also asserts queue count equals overview count) and `verify_chapter11_planning.py` (now leaves its never-run plan paused) all pass. NOT run: `verify_local.py` and `verify_cloud.py` (live acceptance on fresh cases with the real model).
- Read-only walk `streamlit_app/e2e/walk.py --pass 2b` on my own server (8503, stopped afterwards; 8502 untouched): 9 sessions, 180 views, 0 exceptions, 0 error alerts, 0 console errors, 0 failed requests, 0 overflow, 1 walk error (the "Completed run" selector on operations did not open; rerunning that role alone as `--pass 2bops` gave 0 walk errors, so it was a timing flake); 35 leaked-technical-text hits (36 in pass 2a).
- Live data: counts now agree. Awaiting decision: mentors 52, 51 and 51, department head 154 (before: 112, 57, 329, 161). Risk view for a mentor: 107 students (before: 221 evaluated, 113 flagged). 20 never-run test plans (19 from `verify_chapter11_planning.py`, 1 "Stale refresh acceptance") were paused through the audited `review.paused` command with a recorded reason; no row deleted, no job touched.
- Live model calls: 0 Groq, 0 Gemini. Student 021: the case `d398bbc3` was not touched (the pause step skipped any plan containing it; none did).
- Not done: the live AI run with Groq (round 2), C2 (redesign), C3, C4, C6 and the visual and layout items; #29 is closed as source data (the seed repeats one scenario per student across courses).

## Verification before fix pass B (run 14 Oct, fix pass A: AI-only reviews, planner scope, privacy, read-only roles)

- Core `tsc --noEmit` and eslint clean. Core tests 163: 154 pass, 0 fail, 9 skipped (opt-in DB suites; baseline 140: 132 pass, 8 skipped). New: `chapter11-scope-rule.test.ts` (10: an explicit selection wins and a conflict is surfaced, narrowing only, grounded criteria and determinism, answered questions, notes), `chapter11-ai-unavailable.test.ts` (7: every provider fails gives no draft and recorded reasons, no model configured, mid-repair outage, planner without a fallback), `chapter11-read-only-roles.test.ts` (5: hod, governance, student and parent are rejected from every plan command). Stubs and the local mock server only.
- Opt-in DB suites on the LOCAL Postgres (127.0.0.1:55432) in disposable schemas `aura_core_test_*` (all dropped afterwards; nothing run against hosted Neon): `database.test.ts`, `chapter11-database.test.ts`, `chapter11-agents-database.test.ts` (new scenario: audited AI-unavailable state and retry, scope keep and switch, answered questions, planner outage, mentor-only plan commands, risk privacy for the department head and governance, legacy drafts read-only and undecided), `chapter11-lease-database.test.ts` (adds the AI-unavailable retry loop) all pass (4/4); `demo-cohort.test.ts` (opt-in, not in CI) also passes with a stub composer.
- `node scripts/build-streamlit-engine.mjs` run; `npm run check:engine` passes. Platform `npm test` 7/7.
- Python (`.venv/bin/python`): `verify_draft_v2.py`, `verify_agent_trace.py`, `verify_read_cache.py` and the new offline `verify_ai_only_ui.py` pass (the new one is added to the CI Streamlit job). Against the local database: `verify_ui.py` (6 logins, 21 pages), `verify_chapter11_dashboard.py`, `verify_chapter11_trends.py` (now also asserts the department head gets no per-student risk) and `verify_chapter11_planning.py` pass. The planning check runs the planner against a scripted loopback model through a temporary environment file with no provider keys.
- NOT run: `verify_local.py` and `verify_cloud.py` (one-shot live acceptance on fresh cases: they draft with the real model and publish a plan, so they are round 2; both were updated for the AI-only contract). `verify_attachments.py` was run and passed (it re-submits student 52's LMS assignment, one more revision of that record).
- Read-only walk `streamlit_app/e2e/walk.py --pass 2a` on my own server (8503, stopped afterwards; 8502 untouched): 9 sessions, 180 views, 0 exceptions, 0 error alerts, 0 console errors, 0 failed requests, 0 overflow, 0 walk errors (a first run found one walk error in a collapsed expander, fixed in `walk.py`); 36 leaked-text hits (97 in pass 1), 88 clipped-text views.
- Live model calls: 0 Groq, 0 Gemini. Student 021: the pending case (`d398bbc3`, AI-written draft) is still `awaiting_faculty` with no decision, visible in the active queue; nothing of student 021's was touched. The technical plan from `verify_chapter11_planning.py` was added to the local project database as before.
- Not done: the live AI run with Groq (round 2), C2 to C5 and the other open log items; the legacy support-event flow (`support-commands.ts`) still has a rule-based recommendation (unreachable from Streamlit); a Gemini plus local-Qwen chain on one machine needs a second model slot (`CH11_MODEL` holds one endpoint: Gemini on the hosted app, local Qwen on the laptop).

## Verification before fix pass A (run 14 Oct 13:00 IST, hygiene batch 0.3 / 0.4 / 0.6)

- DB suites re-run 14 Oct after the hygiene batch, on the LOCAL Postgres (127.0.0.1:55432) in disposable schemas `aura_core_test_core_final`, `aura_core_test_ch11_final`, `aura_core_test_ch11_agent_final`, `aura_core_test_ch11_lease_final` (all dropped afterwards; nothing run against Neon): `database.test.ts`, `chapter11-database.test.ts`, `chapter11-agents-database.test.ts`, `chapter11-lease-database.test.ts` all pass (4/4).
- Core `tsc --noEmit` and eslint clean; Core tests 140: 132 pass, 0 fail, 8 skipped (opt-in DB suites) (was 139: 131 pass). New: a positive-control test in `chapter11-escalation.test.ts`; its four fault tests now assert `checks[name] === false`, that no other check flips, and the specific failure code. The Lab 8 timing assertion in `chapter11.test.ts` is now a max-in-flight counter (1 sequential, exactly 4 parallel).
- Core source did not change, so the bundle was not rebuilt: `npm run check:engine` passes. Python: `verify_ui.py` (6 logins, 21 pages), `verify_chapter11_dashboard.py`, `verify_chapter11_planning.py` (picks its student by status), `verify_draft_v2.py`, `verify_agent_trace.py` and the new offline `verify_read_cache.py` pass.
- 0.3: `verify-ch11-escalation.mts` and `verify-ch11-parallel.mts` are deleted (they asserted `aura_project_core` and wrote pending jobs into it). Their unique assertions moved into the DB-gated tests, which only accept `aura_core_test_ch11*` schemas. `migrate-ch11-release.mts` now preserves every student whose latest case is `awaiting_faculty`, selected by status. Synthetic fixture register numbers in unit tests (`01FE24BCI047`, fictional students) remain.
- Opt-in DB suites were NOT run, so the folded assertions in `chapter11-database.test.ts` and `chapter11-lease-database.test.ts` are type-checked and linted but not executed: the local database password lives in a git-ignored runtime file that this batch was told not to read. Run them once in a disposable `aura_core_test_ch11*` schema before relying on them.
- 0.6: `load()` serves ten read-only actions from a 30 s per-session cache in `st.session_state` (not `st.cache_data`, which is process-wide and would hold users' results in shared server memory); `save_action`, sign-in, sign-out and a 401 clear it; writes are never cached. F9/F10: file names use a code span; mentor/faculty free text uses `ui.plain_text`. The mentor-authored review request used as a heading in the plan view still uses `_md_safe`.
- Live model calls: 0 Groq, 0 Gemini. Student 021 untouched (the planning check excludes students with a pending job; it saved one technical plan in the local project database as before).

## Verification before the hygiene batch (run 14 Oct 12:45 IST, Brief 16-lite)

- Core `tsc --noEmit` and eslint clean; Core tests 139: 131 pass, 0 fail, 8 skipped (opt-in DB suites) (was 124: 116 pass). New `chapter11-diagnosis.test.ts` (15 tests, stubbed providers and the local mock server, no network): the six failure injections (ungrounded number, missing trigger citation, diagnostic language, wrong-domain action code, over-length rationale, PII string) each diagnosed with the right code and path; four repaired within budget with the unaffected parts asserted identical, two escalated carrying an accurate diagnosis. Also covers the `labels.ISSUES` wording parity, the instruction allowlist and egress refusal of names, the whole-field fallback, v1 packets and the instruction reaching a sealed mock request.
- `npm run check:engine` passes after `node scripts/build-streamlit-engine.mjs` (Core changed). `verify_ui.py` (6 logins, 21 pages), `verify_draft_v2.py` and `verify_agent_trace.py` pass; the last two gained cases for a stored diagnosis, an open diagnosis and an older record that falls back to the `ISSUES` wording.
- Opt-in DB suites were NOT run: `service.ts` and storage are unchanged (the escalation already stores the whole validation, which now includes the diagnoses), and the local database password lives in a git-ignored runtime file that I did not read. Nothing was run against hosted Neon. The earlier DB-suite results below stand for the code before this change; re-run `chapter11-database.test.ts` on the local Postgres in a disposable schema before relying on it.
- Live model calls for Brief 16-lite: 0 Groq, 0 Gemini. Student 021 and all records untouched (no database access in this change).

## Verification before Brief 16-lite (run 14 Oct 13:00 IST, Brief 12)

- Core `tsc --noEmit` and eslint clean; Core tests 124: 116 pass, 0 fail, 8 skipped (opt-in DB suites). New: `chapter11-agent-loop.test.ts` (budget, canonical call ids, no tool support, planted name blocked, allowlist), `chapter11-investigator.test.ts` (tools, scope, citations, fallback, skip), `chapter11-planner.test.ts` (three vague requests, scope, feedback, fallbacks, no lock/execute), gated `chapter11-agents-database.test.ts`.
- Opt-in DB suites on the LOCAL Postgres (127.0.0.1:55432) in disposable schemas `aura_core_test_ch11_agent`, `_reg` and `_e2e`, all dropped afterwards (nothing run against hosted Neon): `chapter11-agents-database.test.ts` and `chapter11-database.test.ts` pass. Fifteen older `aura_core_test_*` schemas from earlier sessions are still in that database; they are not from this work.
- `npm run check:engine` passes after `node scripts/build-streamlit-engine.mjs`. `verify_ui.py` (6 logins, 21 pages), `verify_chapter11_planning.py`, `verify_draft_v2.py` and the new offline `verify_agent_trace.py` pass.
- Real Groq completion calls spent for Brief 12: 6 (fictional case: 3 planner, 3 investigator). Gemini: 0. See the ledger row for what the live check found. Student 021 (checked read-only after the verify runs): the latest case is still awaiting_faculty with no decision and no support plan; the one historical rejection is unchanged.

## Verification before Brief 12 (run 14 Oct 11:45 IST, replay and table-count fixes)

- Core `tsc --noEmit` clean; Core tests 104: 97 pass, 0 fail, 7 skipped (opt-in DB suites). New: two `chapter11-packet-v2.test.ts` unit tests for `verifyReplay` (v2 and v1 packets match; tampered packet, tampered snapshot and re-recorded hashes all report a mismatch).
- Root cause of the failing replay: `replayAgentRun` revalidated stored Chapter 11 packets with the v1-only `validatePacket`, which rejects every packet-v2 draft (Brief 11). The check is now `verifyReplay`, which dispatches by packet version through `validateAnyPacket` and still compares the input and output hashes and re-derives the risk analysis.
- Opt-in DB suites, run against the LOCAL Postgres (127.0.0.1:55432) in disposable schemas (`aura_core_test_ch11_fix`, `aura_core_test_core_fix`, dropped afterwards; nothing run against hosted Neon): `chapter11-database.test.ts` passes (replay matched); `database.test.ts` passes after updating the stale expectations to match migrations 009/010 (53 tables, 15 append-only triggers).
- `npm run check:engine` passes after `node scripts/build-streamlit-engine.mjs` (bundle rebuilt: Core changed). `verify_ui.py` passes (6 logins, 21 pages).

## Verification before replay fix (run 14 Oct 11:40 IST, Phase 0.8)

- Core tests 102: 95 pass, 0 fail, 7 skipped. New: `chapter11-lease.test.ts` (5 stubbed unit tests for B2/B3/B5/B6/B7) and the gated `chapter11-lease-database.test.ts` (B1 sweep, B4 pause during escalation); lease DB test passed against the pre-fix code failing at B1/B4.
- At that point two opt-in tests failed identically on `631a651` (replay `matched` false; 53 tables where 51 expected); both are fixed above.

## Verification before Phase 0.8 (run 14 Oct 11:25 IST, Brief 11)

- Core `tsc --noEmit` clean; Core tests 96: 90 pass, 0 fail, 6 skipped (opt-in DB suite). Platform tests 7/7.
- `npm run check:engine` (platform) passes: `streamlit_app/engine.mjs` matches a fresh build; `streamlit_app/engine-build.json` records source commit, inputs sha256 and bundle sha256.
- `verify_ui.py`, `verify_chapter11_dashboard.py`, `verify_chapter11_planning.py`, `verify_chapter11_trends.py`, new offline `verify_draft_v2.py` pass.
- Real Groq completion calls spent: 1 (fictional case). Student 021 still has one awaiting_faculty case and no support plan.

## Verification before Brief 11 (run 13 Oct 23:20 IST)

- Core `tsc --noEmit`: clean.
- Core `tsx --test tests/*.test.ts`: 77 tests, 71 pass, 0 fail, 6 skipped (opt-in DB suite, `RUN_DB_TESTS=1` against a disposable schema).
- Platform `tests/*.test.mjs`: 7/7.
- Streamlit AppTest checks: `verify_ui.py` (6 logins, 21 pages), `verify_chapter11_dashboard.py`, `verify_chapter11_trends.py`, `verify_chapter11_planning.py` all pass.
- `streamlit_app/engine.mjs` (esbuild bundle of the Core worker) was rebuilt in `5f7db7e`; it must be rebuilt (`cd platform && node scripts/build-streamlit-engine.mjs`) after any Core change or the hosted app runs stale logic.

## Briefs

| Brief | Doc | Status |
|---|---|---|
| 1–9 (lab-manual gaps) | `docs/CHAPTER11_GAP_BRIEFS.md` | Done by Codex, commits `be3d47d`..`5f7db7e`; ledger in `docs/CHAPTER11_GAP_IMPLEMENTATION.md` |
| 10 (real case + real mentor sign-off) | same | **Owner action.** Not started. Never simulate. |
| 11 (grounded drafting + egress + specialists) | `docs/CHAPTER11_AGENTIC_BRIEFS.md`, audit Phase 1 | **Done locally by Claude (14 Oct).** Ledger row in `docs/CHAPTER11_GAP_IMPLEMENTATION.md`. |
| 12 + 13 (tool-using investigator + planner, one agent loop) | same, audit Phase 1 | **Done locally by Claude (14 Oct), pushed after verification.** Ledger row 12. 14 deferred. Re-run one live Groq check after the prompt fixes (see the ledger row) before relying on the investigator in a demo. |
| 16-lite (diagnosis in the repair loop, no model call) | `docs/CHAPTER11_AGENTIC_BRIEFS.md` Brief 16, audit table | **Done locally by Claude (14 Oct), pushed after verification.** Ledger row 16-lite. |
| 17 (visual redesign) | `docs/STREAMLIT_DESIGN_BRIEF.md` | Done by Claude in `6b34843`. Codex's "before" captures are in `runtime/streamlit-project/design/before/`; "after" captures in `.../design/after/` (git-ignored). |

The senior-dev audit and revised plan are in `docs/AUDIT_2026-10-13.md`. Hygiene batch (0.3, 0.4, 0.6) is done. Remaining order: 0.5 (app.py split) and 0.2 (CI) only if budget remains; owner actions. Brief 14 deferred.

## Standing decisions (owner)

- ₹0 spend; free plans only; **one account and one API key per provider** (no quota rotation; provider terms forbid it).
- Hosted model order: Groq `qwen/qwen3.8-27b` (drafting) and `openai/gpt-oss-120b` (judge) → Gemini Flash-Lite → labelled rule-based path. `GROQ_API_KEY` is in the private root `.env` (git-ignored, mode 600) and verified, and in the hosted app's Streamlit secrets (14 Oct).
- Remote models receive **anonymised numbers only** (case alias, values, thresholds, course aliases, relative time). Local Qwen may receive full context.
- Preserve all 321-student / 647-account records; additive migrations only; **Student 021 stays pending** for the presentation.
- Codex desktop session = orchestrator on gpt-6-astra, delegating to gpt-6.1-sol (implementation) and gpt-6-luna (bounded checks). Claude sessions use Opus for sub-agents to conserve usage.
- Three Groq keys for other accounts were pasted into chats on 13 Oct; they were never stored or used. Owner revoked them on 14 Oct.

## Known gaps still open

- Hosted app is private; decide sharing before the viva.
- Lab manual DoD needs a real case approved by an actual mentor in one session (Brief 10).
- Local Qwen is laptop-only; hosted path uses Groq/Gemini/rules.

## Stopped at the owner's 26% weekly usage cap (14 Oct, evening IST)

Done in the end-to-end loop: round 1 (live mentor test + automated walk, 39 findings), fix passes A and B, the
Signal redesign (rubric 7.35 → 8.0, 17 UI findings fixed), round 2 live agentic run on Groq (definition-of-done
path exercised end to end by Claude acting as the mentor: request → planner → agents → 3 valid drafts → light edit
→ approve → publish → student/parent views; case `fbe05729`), one P1 found and fixed (#33). Rule-based path removed.
CI green after `verify_agent_trace.py` was updated for humanised tool names.

Still open, in priority order:
1. #34 limiter: default max wait (15 s) is shorter than the 60 s window, so calls after a burst are refused rather than queued. Decide between a longer default wait (UI blocks up to a minute) or a queued/retry message.
2. #35 judge agent: `ModelRole "judge"` exists but nothing calls it. Wire it (score each draft with `openai/gpt-oss-120b`) or drop it from the spec.
3. #37 coverage: the regenerator and the attendance / wellbeing-referral specialists are covered only by offline tests; a live run needs a failing-draft case and a wellbeing case.
4. Hosted live run and making the hosted app public: blocked while the Streamlit Cloud menu could not be driven (browser pane hidden). Settings → Sharing → public, then run `streamlit_app/e2e/live_run.py` against the hosted URL for one student.
5. C4 repo tidy (move the first prototype under `legacy/`), C6 code hygiene (`ponytail-audit` + `simplify`, app.py split), round 3 rerun of `walk.py` and `live_run.py`.
6. #36, #38, #39 (P3s) in `docs/E2E_TEST_LOG.md`.
