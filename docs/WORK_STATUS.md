# Work status — 14 October 2026, 11:30 IST

Durable handoff note so no state lives only in a chat session. Update this file whenever the state below changes.

## Where the code is

| Item | State |
|---|---|
| Branch | `streamlit-college-project` |
| HEAD | Brief 11 in four local commits: `3f3615f` egress + provider chain, `217b720` packet-v2 + claim validator, `c84c3bf` specialists, then the Streamlit + engine-bundle commit that carries this line — **committed, not pushed** |
| Hosted Streamlit (aura-college-workspace.streamlit.app) | Deployed from `5f7db7e` (Briefs 1–9). Does not yet have Brief 17. Private app; owner sign-in required. |
| Vercel portals (8) | Paused by owner decision. Still 503. |
| Local | `.venv/bin/streamlit run streamlit_app/app.py` on 127.0.0.1:8501 (Codex) / 8502 (Claude). Local Postgres 127.0.0.1:55432 `aura_project`. |

**Push is blocked from this Mac.** Git here authenticates as GitHub user `vikneshwaranmarimuthu-cmyk`; the repo is owned by `viknesh2005greatstastrophysist-prog`. Either the owner pushes (`git push origin streamlit-college-project`), the Codex desktop session pushes (it pushed `5f7db7e` successfully), or the owner adds the other account as a collaborator.

## Verification at HEAD (run 14 Oct 11:25 IST, Brief 11)

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

A senior-dev audit of Briefs 1–9 and 17 is in progress (13 Oct 23:00 IST). Its findings and a revised, slimmer plan for 11–16 will be recorded in `docs/AUDIT_2026-10-13.md` when complete. Do not start Briefs 11–16 until that audit lands.

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
