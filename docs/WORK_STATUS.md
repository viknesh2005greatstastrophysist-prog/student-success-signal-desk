# Work status — 14 October 2026, 11:45 IST

Durable handoff note so no state lives only in a chat session. Update this file whenever the state below changes.

## Where the code is

| Item | State |
|---|---|
| Branch | `streamlit-college-project` |
| HEAD | Phase 0.8 (job-lease and snapshot fixes B1–B7) is the commit that carries this line, on top of `631a651` (Brief 11 + status) — **committed, not pushed**: held because two opt-in DB tests fail (pre-existing, see Verification), so the owner decides whether to push. |
| Hosted Streamlit (aura-college-workspace.streamlit.app) | Deployed from `5f7db7e` (Briefs 1–9). Does not yet have Brief 17. Private app; owner sign-in required. |
| Vercel portals (8) | Paused by owner decision. Still 503. |
| Local | `.venv/bin/streamlit run streamlit_app/app.py` on 127.0.0.1:8501 (Codex) / 8502 (Claude). Local Postgres 127.0.0.1:55432 `aura_project`. |

**Pushing.** Plain `git push` fails here (keychain holds `vikneshwaranmarimuthu-cmyk`; the repo belongs to `viknesh2005greatstastrophysist-prog`). Both accounts are signed in to `gh`, so push with:
`gh auth switch --user viknesh2005greatstastrophysist-prog && git -c credential.helper='!gh auth git-credential' push origin streamlit-college-project && gh auth switch --user vikneshwaranmarimuthu-cmyk`.
Streamlit Cloud redeploys from the branch on every push. Codex's subscription ended 14 Oct; Claude implements under a strict usage cap (one agent at a time).

## Verification at HEAD (run 14 Oct 11:40 IST, Phase 0.8)

- Core `tsc --noEmit` clean; Core tests 102: 95 pass, 0 fail, 7 skipped (opt-in DB suites). New: `chapter11-lease.test.ts` (5 stubbed unit tests for B2/B3/B5/B6/B7) and the gated `chapter11-lease-database.test.ts` (B1 sweep, B4 pause during escalation).
- Opt-in DB run (`RUN_CH11_LEASE_DB_TESTS=1`, schema `aura_core_test_ch11_lease`, via the existing `.env.local` loading): lease DB test passes; against the pre-fix code it fails at B1 and, with only B1 applied, at B4. Schema left in place like the other `aura_core_test_*` schemas.
- Two opt-in tests fail identically on `631a651` and are **not** caused by 0.8: `chapter11-database.test.ts` (`replayAgentRun(...).replay.matched` is false, line ~407) and `database.test.ts` (53 tables where 51 are expected). Triage separately.
- `npm run check:engine` passes after `node scripts/build-streamlit-engine.mjs` (bundle rebuilt: Core changed). `verify_ui.py` passes (6 logins, 21 pages). The local project Postgres had to be restarted for it (`node --env-file-if-exists=.env.local scripts/project-runtime.mjs --database-only`).

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
| 11 (grounded drafting + egress + specialists) | `docs/CHAPTER11_AGENTIC_BRIEFS.md`, audit Phase 1 | **Done locally by Claude (14 Oct).** Ledger row in `docs/CHAPTER11_GAP_IMPLEMENTATION.md`. Next: 12 (tool-using investigator + planner), 16-lite; 14 deferred. |
| 17 (visual redesign) | `docs/STREAMLIT_DESIGN_BRIEF.md` | Done by Claude in `6b34843`. Codex's "before" captures are in `runtime/streamlit-project/design/before/`; "after" captures in `.../design/after/` (git-ignored). |

The senior-dev audit and revised plan are in `docs/AUDIT_2026-10-13.md`. Remaining order: Brief 12 → Brief 16-lite → Sonnet hygiene batch (0.3, 0.4, 0.6) → 0.5 / 0.2 only if budget remains. Brief 14 deferred.

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
