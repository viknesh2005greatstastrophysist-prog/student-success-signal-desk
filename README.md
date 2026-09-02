# AURA Student Success Ecosystem

A governed agentic AI capstone built from Chapter 11 of the *Agentic AI: 15 Worklets / 14-Lab Build Book* and the supplied *Student Success and Early Warning System* brief.

![Signal Desk queue](artifacts/screenshots/signal-desk-home.png)

This is a **synthetic-data educational demonstration**. It joins source operations, cohort triage, mentor casework, intervention tracking, a self-scoped student portal, aggregate leadership analytics, agent operations, and governance. It does not predict student failure, diagnose wellbeing, contact students, or alter institutional records.

## Ecosystem surfaces

- **AURA Coordinator:** ecosystem map, cohort command centre, connector and agent operations, policy, permissions, and audit.
- **Faculty Mentor:** assigned worklist, evidence, validated recommendations, human decisions, correction/replay, and intervention delivery.
- **Synthetic Student:** only that identity's approved support and source-update status, with no peer comparison or predictive label.
- **HoD / Dean:** aggregate trends and outcomes with no student-level drill-down.

The sidebar identity switcher demonstrates role rules. It is not authentication.

## Run

```bash
uv sync --python 3.12 --extra dev
uv run student-success demo
uv run streamlit run src/student_success/ui/app.py
```

The UI opens at `http://localhost:8501`. Its default offline mode is the deterministic baseline/fallback. Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` to exercise the schema-constrained LLM composer:

```bash
OPENAI_API_KEY=... uv run streamlit run src/student_success/ui/app.py
```

On an empty runtime database, the interface automatically creates a synthetic
demo cohort. No student data or API key is required. Deployment and rollback
instructions are in `docs/DEPLOYMENT.md`.

## Test

```bash
uv run pytest
uv run pytest --cov=student_success --cov-report=term-missing
```

## CLI

```bash
uv run student-success seed
uv run student-success create SYN-0001 --mentor mentor-01
uv run student-success run CASE-XXXXXXXXXX
uv run student-success decide CASE-XXXXXXXXXX approve --mentor mentor-01 --reason "Evidence reviewed"
uv run student-success rollback CASE-XXXXXXXXXX --version 1 --mentor mentor-01 --reason "Restore reviewed packet"
uv run student-success export CASE-XXXXXXXXXX
uv run student-success evaluate
```

`PROJECT_CONTRACT.md` is the authority for the case workflow. `docs/ECOSYSTEM_CONTRACT.md` defines the role surfaces, intervention lifecycle, aggregate boundaries, and ecosystem acceptance criteria. `docs/ADR-001-governed-agentic-runtime.md` records why the implementation uses a deterministic spine and only one optional LLM composer.

The build evidence is in `artifacts/reports/BUILD_EVIDENCE.md`; the lab-by-lab map is in `docs/REQUIREMENTS_TRACEABILITY.md`.
