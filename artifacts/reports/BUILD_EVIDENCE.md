# Build evidence

**Build:** `1.0.0`
**Contract:** `student-success-contract-v1`
**Policy:** `demo-policy-v1`
**Dataset:** `synthetic-cohort-v1`
**Verified:** 2026-09-02, Asia/Kolkata

## Outcome

The Chapter 11 project is implemented as a working, mentor-governed case manager. It runs locally, collects all four synthetic source groups in parallel, blocks unusable required evidence, applies deterministic support-priority rules, composes a schema-bound packet, validates it, repairs named failing fields within budget, falls back deterministically, pauses durably for the assigned mentor, records decisions, supports correction/reopen/revoke/rollback, exports an audit trace, and renders the real event history.

## Verification results

| Check | Result |
|---|---|
| Automated tests | 26 passed |
| Business/runtime branch-aware coverage | 88.98% |
| Ruff static checks | Passed |
| Python compilation | Passed |
| Streamlit startup test | Passed |
| Browser render | Queue, Evidence, Review, Replay rendered with 0 app exceptions |
| Unsafe-output loop | Prohibited action failed validation, one named-field repair applied, revalidation passed |
| Restart recovery | Mentor interrupt resumed from a new application instance exactly once |
| Source correction | Stale LMS case resumed through a bundled, versioned override |
| Human control | Approve, edit+approve, reject, reopen, revoke, and rollback implemented and tested |

Verification command:

```bash
uvx ruff check src tests
uv run pytest --cov=student_success --cov-report=term-missing
```

## Curated cases

| Scenario | Case | Final observed state | Evidence |
|---|---|---|---|
| Normal completion | `CASE-7629D4C90D` | `CLOSED / approve` | Stored mentor decision and immutable replay |
| Bad-data recovery | `CASE-315DDB9CA0` | `AWAITING_MENTOR` | `DATA_BLOCKED`, source correction, resumed collection, new snapshot |
| Unsafe-output recovery | `CASE-119358D74B` | `AWAITING_MENTOR` | Failed prohibited-action validation, targeted repair, pass, interrupt |

## Live-model boundary

The OpenAI Responses API adapter is implemented and its structured-output contract is tested with a fake client against the installed SDK. `OPENAI_API_KEY` is not present, so no live model call was made and no LLM quality, cost, latency, or mentor-usability result is claimed. The evaluation artifact records isolated-LLM and governed-agentic variants as skipped instead of inventing numbers.

To run the live comparison intentionally:

```bash
OPENAI_API_KEY=... uv run student-success evaluate --allow-live-model
```

Human usability still requires the blinded reviewer protocol in `PROJECT_CONTRACT.md`. A provider call alone does not answer whether the LLM earns its place.

## Visual inspection

- `artifacts/screenshots/signal-desk-home.png`
- `artifacts/screenshots/signal-desk-evidence.png`
- `artifacts/screenshots/signal-desk-review.png`
- `artifacts/screenshots/signal-desk-replay-repair.png`

## Scope boundary

These results prove software behavior on synthetic inputs. They do not prove educational impact, fairness, institutional readiness, or lawful use of real student records.
