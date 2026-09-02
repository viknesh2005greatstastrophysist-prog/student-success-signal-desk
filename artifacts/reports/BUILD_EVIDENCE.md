# Build evidence

**Build:** `2.0.0`
**Contract:** `student-success-contract-v1`
**Policy:** `demo-policy-v1`
**Dataset:** `synthetic-cohort-v1`
**Verified:** 2026-09-02, Asia/Kolkata

## Outcome

The Chapter 11 project is implemented as a working, governed student-success ecosystem. It includes coordinator, mentor, synthetic-student, HoD, and Dean identities; role-scoped product surfaces; parallel four-source collection; a versioned non-predictive concern index; deterministic priority; bounded packet generation; validation and targeted repair; durable mentor approval; atomic intervention creation; guarded intervention delivery; cohort-run operations; connector health; aggregate-only leadership analytics; and immutable audit export.

The identity selector, connectors, student records, and outcomes are explicitly synthetic. They are not represented as institutional authentication, real integrations, or production evidence.

## Verification results

| Check | Result |
|---|---|
| Automated tests | 34 passed |
| Business/runtime branch-aware coverage | 88.66% |
| Ruff static checks | Passed |
| Python compilation | Passed |
| Streamlit startup test | Passed |
| Browser render | Ecosystem Map, Command Centre, Mentor Workspace, Interventions, Student Portal, Leadership Cockpit, Agent Operations, and Governance rendered with 0 app exceptions |
| Unsafe-output loop | Prohibited action failed validation, one named-field repair applied, revalidation passed |
| Restart recovery | Mentor interrupt resumed from a new application instance exactly once |
| Source correction | Stale LMS case resumed through a bundled, versioned override |
| Human control | Approve, edit+approve, reject, reopen, revoke, and rollback implemented and tested |
| Intervention lifecycle | Approval creates ledger items; owner guard, transition guard, CSV export, and audit update tested |
| Student isolation | Self-scoped portal rejects cross-student access and omits predictive labels |
| Leadership isolation | Aggregate serialization contains no synthetic student references |
| Cohort operations | Bootstrap and repeat cohort runs preserve case membership, completion, and blocked counts |

Verification command:

```bash
uv run ruff check .
uv run pytest --cov=student_success --cov-report=term-missing
```

## Curated scenarios

| Scenario | Fixture | Expected state | Evidence |
|---|---|---|---|
| Approved support publication | `SYN-0001` | `CLOSED / approve` | Atomic decision, intervention ledger, private student view |
| High multi-signal review | `SYN-0002` | `AWAITING_MENTOR` | Concern index 100, cited reasoning, durable interrupt |
| Missing required record | `SYN-0003` | `DATA_BLOCKED` | No composer call |
| Bad-data recovery | `SYN-0004` | `AWAITING_MENTOR` | Stale block, versioned correction, resumed collection |
| Contradictory required record | `SYN-0005` | `DATA_BLOCKED` | Conflicting values preserved; no averaging or inference |
| No concerning signals | `SYN-0006` | `AWAITING_MENTOR` | Low priority still requires human judgement |
| Unsafe-output recovery | `SYN-0002` labelled fault fixture | `AWAITING_MENTOR` | Failed prohibited-action validation, named-field repair, revalidation pass |

## Live-model boundary

The OpenAI Responses API adapter is implemented and its structured-output contract is tested with a fake client against the installed SDK. `OPENAI_API_KEY` is not present, so no live model call was made and no LLM quality, cost, latency, or mentor-usability result is claimed. The evaluation artifact records isolated-LLM and governed-agentic variants as skipped instead of inventing numbers.

To run the live comparison intentionally:

```bash
OPENAI_API_KEY=... uv run student-success evaluate --allow-live-model
```

Human usability still requires the blinded reviewer protocol in `PROJECT_CONTRACT.md`. A provider call alone does not answer whether the LLM earns its place.

## Visual inspection

- Live browser QA covered all role surfaces and a disposable second cohort run.
- The `artifacts/screenshots/signal-desk-*.png` files preserve the original case-manager visual evidence from Build 1.0.

## Scope boundary

These results prove software behavior on synthetic inputs. They do not prove educational impact, fairness, institutional readiness, or lawful use of real student records.
