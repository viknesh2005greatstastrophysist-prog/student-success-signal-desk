# Work status — 14 October 2026, 13:00 IST

Durable handoff note so no state lives only in a chat session. Update this file whenever the state below changes.

## Where the code is

| Item | State |
|---|---|
| Branch | `streamlit-college-project` |
| HEAD | Hygiene batch (audit 0.3, 0.4, 0.6) on top of `6ec8189` (Brief 16-lite): `7c8e15c` (0.3), `6f01f5c` (0.4), `855d5e4` (0.6), then a docs commit; pushed to `origin/streamlit-college-project` once all checks below passed. Earlier: Brief 16-lite (`6ec8189`), Brief 12 (`1aceac0`, `9892467`, `bb92e3d`). |
| Hosted Streamlit (aura-college-workspace.streamlit.app) | Deployed from `5f7db7e` (Briefs 1–9). Does not yet have Brief 17. Private app; owner sign-in required. |
| Vercel portals (8) | Paused by owner decision. Still 503. |
| Local | `.venv/bin/streamlit run streamlit_app/app.py` on 127.0.0.1:8501 (Codex) / 8502 (Claude). Local Postgres 127.0.0.1:55432 `aura_project`. |

**Pushing.** Plain `git push` fails here (keychain holds `vikneshwaranmarimuthu-cmyk`; the repo belongs to `viknesh2005greatstastrophysist-prog`). Both accounts are signed in to `gh`, so push with:
`gh auth switch --user viknesh2005greatstastrophysist-prog && git -c credential.helper='!gh auth git-credential' push origin streamlit-college-project && gh auth switch --user vikneshwaranmarimuthu-cmyk`.
Streamlit Cloud redeploys from the branch on every push. Codex's subscription ended 14 Oct; Claude implements under a strict usage cap (one agent at a time).

## Verification at HEAD (run 14 Oct 13:00 IST, hygiene batch 0.3 / 0.4 / 0.6)

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
- Hosted model order: Groq `qwen/qwen3.8-27b` (drafting) and `openai/gpt-oss-120b` (judge) → Gemini Flash-Lite → labelled rule-based path. `GROQ_API_KEY` is in the private root `.env` (git-ignored, mode 600) and verified; not yet in Streamlit secrets.
- Remote models receive **anonymised numbers only** (case alias, values, thresholds, course aliases, relative time). Local Qwen may receive full context.
- Preserve all 321-student / 647-account records; additive migrations only; **Student 021 stays pending** for the presentation.
- Codex desktop session = orchestrator on gpt-6-astra, delegating to gpt-6.1-sol (implementation) and gpt-6-luna (bounded checks). Claude sessions use Opus for sub-agents to conserve usage.
- Three Groq keys for other accounts were pasted into chats on 13 Oct; they were never stored or used. Owner should revoke them.

## Known gaps still open

- Hosted app is private; decide sharing before the viva.
- Lab manual DoD needs a real case approved by an actual mentor in one session (Brief 10).
- Local Qwen is laptop-only; hosted path uses Groq/Gemini/rules.
