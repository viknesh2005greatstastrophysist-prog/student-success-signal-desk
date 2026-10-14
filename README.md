# AURA: Student Success and Early Warning System

AURA is an agentic AI system that spots students who are starting to struggle and drafts a support plan for
each one. AI agents gather the evidence, score the risk, investigate with tools and write the draft. A mentor
reviews every draft and decides; nothing reaches a student or their family without that approval.

It is the Chapter 11 capstone of the *Agentic AI: 15 Worklets / 14-Lab Build Book*.

**Live app:** https://aura-college-workspace.streamlit.app (private while in testing; ask the owner for access)

## What it does

One web app with six workspaces, each showing only what that role is allowed to see:

| Workspace | Who | What they do |
| --- | --- | --- |
| Student | Students | Courses, attendance, marks, fees, and support their mentor has approved |
| Parent | Parents | Their child's attendance, marks, fees and receipts, and mentor updates |
| Mentor | Faculty mentors | Classroom records, mentees, the AI review queue, approvals and follow-ups |
| Department head | HoD | Department trends, risk across cohorts, mentor workload, faculty-set policies |
| AI activity | Operations | Every agent run: steps, models used, tool calls, checks, failures and repairs |
| Learning (LMS) | Students and faculty | Lessons, assignments, submissions and feedback |

## How the agents work

```text
Mentor request ──> Planner agent (asks clarifying questions, then a plan is locked)
                         │
                         v
Coordinator ──> 4 collectors in parallel: academic records · LMS · internships · placements
                         │
                         v
Evidence validator ──> Risk analysis (faculty-set thresholds) ──> History retrieval
                         │
                         v
Investigator agent (read-only tools) ──> Specialist drafts: academic · attendance · wellbeing referral
                         │
                         v
Packet validator ⇄ Regenerator (diagnoses each failed check, repairs only that part, at most 2 repairs)
                         │
                         v
Mentor gate (edit, approve or decline the exact version) ──> Publisher (student, parent, dashboards)
```

- **Models:** Groq first (`qwen/qwen3.8-27b` drafts, `openai/gpt-oss-120b` judges), then Gemini 3.1
  Flash-Lite, then a local Qwen model when running on the owner's laptop. Requests are rate- and token-limited
  to stay inside free tiers. Every plan and every review runs on AI: there is no rule-based mode. If every model
  fails, the case waits as "AI unavailable, retry" with an audited reason (the planner asks the mentor to retry),
  and no template draft is made. Drafts from the earlier rule-based path stay on record under "Legacy drafts"
  and are never decided.
- **Roles:** only a student's assigned mentor creates, revises, locks, runs or pauses a review plan and sees that
  student's risk score and evidence. The department head and the AI-activity workspace observe plans and
  department-level aggregates; the Core enforces this, not only the pages.
- **Scope:** the mentor's own "Students in scope" selection is authoritative. The planner may narrow it or ask a
  question, never silently replace or widen it; if the request describes a different set, the plan shows the
  conflict and nothing changes until the mentor confirms.
- **Grounded drafts:** every claim in a draft must cite a piece of collected evidence. Uncited numbers,
  diagnostic wording, wrong-domain actions and personal details are caught by the validator and repaired or
  escalated to the mentor.
- **Privacy:** hosted models never see names or IDs. Students, courses and evidence are replaced by aliases
  and only anonymised numbers leave the server; an egress guard blocks anything else.
- **Governance:** approval is tied to the exact draft version (content hash and revision). Every step is
  written to an append-only audit ledger, and any run can be replayed and checked.

## Repository layout

| Path | What it is |
| --- | --- |
| `streamlit_app/` | The app: `app.py` (pages), `ui.py` (components), `labels.py` (plain-language text), `bridge.py` (talks to the engine), `engine.mjs` (bundled engine) |
| `platform/services/core-api/` | The engine in TypeScript: agents, validators, privacy guard, database layer, migrations and tests |
| `platform/services/core-api/lib/chapter11/` | The agentic pipeline: planner, investigator, agent loop, providers, packet validation, diagnosis |
| `docs/` | Status, audit, briefs and test log (start with `docs/WORK_STATUS.md`) |
| `platform/apps/` | Earlier six-site Next.js version, kept for reference and not deployed |

The repository contains no student records and no secrets. The app reads records from a private PostgreSQL
database, and credentials live only in ignored `.env` files or Streamlit secrets.

## Run it yourself

These steps run a private copy on your own computer. Requirements: Python 3.12, Node.js 22 or newer and
PostgreSQL.

```bash
python3 -m venv .venv
.venv/bin/pip install -r streamlit_app/requirements.txt
cd platform && npm ci && cd ..
```

Create a private `.env` in the repo root (never commit it) with your database connection and model keys; see
`streamlit_app/secrets.example.toml` for the settings the app expects. Then:

```bash
.venv/bin/streamlit run streamlit_app/app.py
```

The app opens at `http://localhost:8501` on your own machine. After any change to the TypeScript engine, rebuild
the bundle with `cd platform && npm run build:engine`.

## Tests

```bash
cd platform/services/core-api && npx tsx --test tests/*.test.ts   # engine unit tests
cd platform && npm run check:engine                                # bundle matches the source
.venv/bin/python streamlit_app/verify_ui.py                        # every role and page loads
```

Database suites are opt-in and must use a throwaway `aura_core_test_*` schema; see `docs/WORK_STATUS.md`.

## Status

- Current state, verification results and the remaining work: [`docs/WORK_STATUS.md`](docs/WORK_STATUS.md)
- End-to-end test passes and open findings: [`docs/E2E_TEST_LOG.md`](docs/E2E_TEST_LOG.md)
- Senior-developer audit and plan: [`docs/AUDIT_2026-10-13.md`](docs/AUDIT_2026-10-13.md)
- Lab-manual coverage: [`docs/CHAPTER11_COMPLETION.md`](docs/CHAPTER11_COMPLETION.md)

In progress: the end-to-end test-and-fix passes (pass A removed the rule-based path and fixed planner scope,
privacy and read-only roles; the live AI run and the remaining findings follow), and a visual redesign.
