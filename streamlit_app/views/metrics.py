from __future__ import annotations

from typing import Any

import altair as alt
import labels
import pandas as pd
import streamlit as st
import ui
from views.freshness import render_earlier_reviews_note
from common import pick
from common import dataframe
from views.reviews import provenance_rows, render_diagnoses, render_gate_actions, render_tool_calls


def rate(raw: Any) -> float | None:
    try:
        return None if raw is None else round(float(raw) * 100, 1)
    except (TypeError, ValueError):
        return None


def render_evaluation_metrics(review: dict[str, Any]) -> None:
    cycle_map = cycle_labels(review)
    ui.section(
        "How the agents performed",
        "Calculated from recorded checkpoints, immutable drafts and mentor decisions. Undecided cases are excluded from decision metrics.",
        icon=":material/insights:",
    )
    metrics = review.get("metrics") or {}
    cycles = metrics.get("cycles") or []
    per_run = metrics.get("perRun") or []
    if not per_run:
        ui.empty_state(
            "No evaluated runs yet",
            "Metrics appear after the first review run is validated.",
        )
        return
    decided = [r for r in per_run if r.get("decision")]
    approved = [r for r in decided if r.get("decision") == "approved"]
    totals = metrics.get("totals") or {}
    ui.kpi_row(
        [
            {
                "label": "Passed every check",
                "value": f"{totals.get('validationPassed', 0)} of {totals.get('evaluated', 0)}",
                "icon": ":material/verified:",
                "help": f"{totals.get('validationPassed', 0)} of {totals.get('evaluated', 0)} drafts passed every acceptance check before mentor review. Cycles are listed below.",
            },
            {
                "label": "Fix-ups by the model",
                "value": sum(int(r.get("repairsUsed") or 0) for r in per_run),
                "icon": ":material/build:",
            },
            {
                "label": "Handed to a mentor (all reviews)",
                "value": totals.get("escalated", 0),
                "icon": ":material/front_hand:",
                "help": "Every review the agents could not finish, including students who were later reviewed again. Runs counts only each student's latest review.",
            },
            {
                "label": "Approved as drafted",
                "value": f"{sum(1 for r in approved if r.get('approveAsIs'))} of {len(approved)}"
                if approved
                else "None decided yet",
                "icon": ":material/thumb_up:",
                "help": "Of approved drafts, how many mentors approved without editing.",
            },
        ]
    )
    cycle_rows = [
        {
            "Cycle": f"{cycle_map.get(str(row.get('cycleId')), 'C?')} · {labels.short_ref(row.get('cycleId'))}",
            "Runs": row.get("evaluatedRuns"),
            "Pass rate": rate(row.get("validationPassRate")),
            "Repairs": row.get("repairsUsed"),
            "Escalation rate": rate(row.get("escalationRate")),
            "Approved as drafted": rate(row.get("approveAsIsRate")),
            "AI model runs": row.get("modelRuns"),
            "Legacy rule-based runs": row.get("legacyRuleRuns"),
            "Decided": row.get("decidedRuns"),
            "Avg. decision time (min)": None
            if row.get("averageDecisionSeconds") is None
            else round(float(row["averageDecisionSeconds"]) / 60, 1),
        }
        for row in cycles
    ]
    main_columns = ("Cycle", "Runs", "Pass rate", "Repairs", "Escalation rate", "Approved as drafted")
    if all(row["Approved as drafted"] is None for row in cycle_rows):
        main_columns = main_columns[:-1]  # nothing decided yet: the column says nothing
    dataframe(
        [{k: v for k, v in row.items() if k in main_columns} for row in cycle_rows],
        column_config={
            name: st.column_config.NumberColumn(name, format="%.0f%%")
            for name in ("Pass rate", "Escalation rate", "Approved as drafted")
        },
    )
    with st.expander("More per cycle", icon=":material/table_rows:"):
        dataframe(
            [
                {k: v for k, v in row.items() if k == "Cycle" or k not in main_columns}
                for row in cycle_rows
            ]
        )
    with st.expander("Per-student results", icon=":material/table_rows:"):
        st.caption(
            "One row per drafted plan. Fix-ups are the times the validator sent a draft back to the model; "
            "words changed counts how much the mentor edited before approving (0 means approved as drafted)."
        )
        jobs = {str(job.get("id")): job for job in review.get("jobs") or []}
        names = {
            str(s.get("id")): labels.pretty_name(s.get("display_name") or "Student")
            for s in review.get("students") or []
        }
        dataframe(
            [
                {
                    "Student": names.get(
                        str((jobs.get(str(row.get("jobId"))) or {}).get("student_id")), "Student"
                    ),
                    "Review": cycle_map.get(str(row.get("cycleId")), "Earlier review"),
                    "Drafted by": labels.drafted_by(
                        row.get("mode"), (jobs.get(str(row.get("jobId"))) or {}).get("model_id")
                    ),
                    "Passed every check": "Yes" if row.get("validationPassed") else "No",
                    "Fix-ups": row.get("repairsUsed"),
                    "Handed to the mentor": "Yes" if row.get("escalated") else "No",
                    "Mentor decision": labels.status_label(row.get("decision"))
                    if row.get("decision")
                    else "Not decided yet",
                    "Words changed by the mentor": row.get("mentorEditDistance"),
                }
                for row in per_run
            ]
        )


TREND_SERIES = {
    "reviewed": ("Reviewed", "#0071E3"),
    "flagged": ("Flagged", "#FF9F0A"),
    "blocked": ("Blocked", "#FF3B30"),
    "awaiting_approval": ("Awaiting mentor", "#86868B"),
    "approved": ("Approved", "#34C759"),
    "completed": ("Completed", "#1F8A3B"),
    "withdrawn": ("Withdrawn", "#C7C7CC"),
}
BAND_SERIES = {
    "low": ("Low", "#34C759"),
    "medium": ("Medium", "#FF9F0A"),
    "high": ("High", "#FF3B30"),
}


def cycle_labels(review: dict[str, Any]) -> dict[str, str]:
    """C1, C2 ... over every cycle, oldest first. Charts and tables share these names (#24)."""
    return {
        str(row.get("cycle_id")): f"C{index}"
        for index, row in enumerate(review.get("trends") or [], start=1)
    }


def trend_has_signal(rows: list[dict[str, Any]]) -> bool:
    """A chart is only worth drawing when cycles are big enough and differ from each other."""
    if len(rows) < 3 or max(int(r.get("reviewed") or 0) for r in rows) < 3:
        return False
    return any(len({int(r.get(key) or 0) for r in rows}) > 1 for key in TREND_SERIES)


def render_review_trends(review: dict[str, Any]) -> None:
    ui.section(
        "Support trends by review cycle",
        "Each cycle is one saved review plan. Aggregates only; no student can be identified here.",
        icon=":material/monitoring:",
    )
    rows = review.get("trends") or []
    render_earlier_reviews_note(review)
    if not rows:
        ui.empty_state(
            "No evaluated review cycles yet",
            "Trends appear after mentors run their first review.",
        )
        return
    evaluated = [r for r in rows if int(r.get("reviewed") or 0) > 0]
    if evaluated:
        rows = evaluated
    recent = 8
    if len(rows) > recent and not st.toggle(
        f"Show all {len(rows)} cycles", key="trend_all_cycles"
    ):
        rows = rows[-recent:]
        st.caption(f"Showing the {recent} most recent cycles with evaluated students.")
    cycle_map = cycle_labels(review)
    order = [
        cycle_map.get(str(r.get("cycle_id")), f"C{i}") for i, r in enumerate(rows, 1)
    ]
    if not trend_has_signal(rows):
        biggest = max(int(r.get("reviewed") or 0) for r in rows)
        ui.insight(
            "Too small to chart yet",
            f"The {len(rows)} most recent cycles each evaluated at most {biggest} "
            f"student{'s' if biggest != 1 else ''}, and their counts do not change from one cycle to the next, "
            "so a trend line would show nothing. Charts appear once cycles cover at least three students and differ.",
        )
        dataframe(
            [
                {
                    "Cycle": order[index],
                    "Date": labels.nice_date(r.get("day")),
                    "Reviewed": int(r.get("reviewed") or 0),
                    "Flagged": int(r.get("flagged") or 0),
                    "Awaiting mentor": int(r.get("awaiting_approval") or 0),
                    "Approved": int(r.get("approved") or 0),
                }
                for index, r in enumerate(rows)
            ]
        )
        return
    counts = pd.DataFrame(
        [
            {
                "Cycle": order[index],
                "Review cycle": str(r["day"]),
                "Measure": label,
                "Count": int(r.get(key, 0) or 0),
            }
            for index, r in enumerate(rows)
            for key, (label, _) in TREND_SERIES.items()
        ]
    )
    averages = pd.DataFrame(
        [
            {
                "Cycle": order[index],
                "Review cycle": str(r["day"]),
                "Band": label,
                "Average score": r.get("average_" + key),
            }
            for index, r in enumerate(rows)
            for key, (label, _) in BAND_SERIES.items()
            if r.get("average_" + key) is not None
        ]
    )
    left, right = st.columns([3, 2], gap="medium")
    with left, ui.card("trend_outcomes"):
        st.markdown("##### Outcomes per cycle")
        bars = (
            alt.Chart(counts)
            .mark_bar(cornerRadiusTopLeft=3, cornerRadiusTopRight=3)
            .encode(
                x=alt.X("Cycle:N", title=None, sort=order, axis=alt.Axis(labelAngle=0)),
                xOffset=alt.XOffset(
                    "Measure:N", sort=[v[0] for v in TREND_SERIES.values()]
                ),
                y=alt.Y("Count:Q", title="Students", axis=alt.Axis(tickMinStep=1)),
                color=alt.Color(
                    "Measure:N",
                    sort=[v[0] for v in TREND_SERIES.values()],
                    scale=alt.Scale(
                        domain=[v[0] for v in TREND_SERIES.values()],
                        range=[v[1] for v in TREND_SERIES.values()],
                    ),
                    title=None,
                ),
                tooltip=["Review cycle", "Measure", "Count"],
            )
            .properties(height=260)
        )
        st.altair_chart(ui.style_chart(bars), width="stretch")
    with right, ui.card("trend_bands"):
        st.markdown("##### Average risk score by band")
        if averages.empty:
            averages = pd.DataFrame(
                [
                    {
                        "Cycle": "C1",
                        "Review cycle": "",
                        "Band": "Low",
                        "Average score": None,
                    }
                ]
            )
        lines = (
            alt.Chart(averages)
            .mark_line(point=alt.OverlayMarkDef(size=60, filled=True), strokeWidth=2.5)
            .encode(
                x=alt.X("Cycle:N", title=None, sort=order, axis=alt.Axis(labelAngle=0)),
                y=alt.Y(
                    "Average score:Q",
                    title="Score (0–100)",
                    scale=alt.Scale(domain=[0, 100]),
                ),
                color=alt.Color(
                    "Band:N",
                    scale=alt.Scale(
                        domain=[v[0] for v in BAND_SERIES.values()],
                        range=[v[1] for v in BAND_SERIES.values()],
                    ),
                    title=None,
                ),
                tooltip=[
                    "Review cycle",
                    "Band",
                    alt.Tooltip("Average score:Q", format=".1f"),
                ],
            )
            .properties(height=260)
        )
        st.altair_chart(ui.style_chart(lines), width="stretch")
        st.caption(
            "Gaps mean no evaluated students in that band for the cycle."
            + (
                ""
                if (st.session_state.get("actor") or {}).get("role") == "faculty"
                else " Department views show a band average only when at least three students are in it, so no single student's score is exposed."
            )
        )


def render_agent_graph(review: dict[str, Any]) -> None:
    st.caption(
        "The executor runs this graph for every student. Validation can regenerate at most twice; publication waits for the assigned mentor's approval of the exact draft."
    )
    jobs = [job for job in review.get("jobs", []) if job.get("node_trace")]
    names = {
        str(s.get("id")): labels.pretty_name(s.get("display_name") or "Student")
        for s in review.get("students") or []
    }
    trace = None
    selected_job = None
    if jobs:
        by_id = {str(job["id"]): job for job in jobs}
        job_id = pick(
            "Run",
            list(by_id),
            format_func=lambda jid: (
                f"{names.get(str(by_id[jid].get('student_id')), 'Student')} · "
                f"{labels.run_outcome(by_id[jid].get('status'), by_id[jid].get('error_code'), by_id[jid].get('intervention_status'))} · "
                f"run {labels.short_ref(jid)}"
            ),
            key="graph_job",
        )
        selected_job = by_id.get(str(job_id)) if job_id is not None else None
        trace = selected_job.get("node_trace") if selected_job else None
    ui.pipeline_stepper(
        trace,
        empty_text="" if not jobs else "Not reached",
        judge=(selected_job.get("validation") or {}).get("judge")
        if selected_job and isinstance(selected_job.get("validation"), dict)
        else None,
    )
    if selected_job:
        render_gate_actions(selected_job, st.session_state.get("actor") or {}, review)
        validation = selected_job.get("validation") or {}
        with st.expander(
            "Model calls for this run", icon=":material/smart_toy:", expanded=True
        ):
            dataframe(
                provenance_rows(
                    validation if isinstance(validation, dict) else {},
                    selected_job.get("mode"),
                    selected_job.get("model_id"),
                    role=(st.session_state.get("actor") or {}).get("role"),
                )
            )
            render_tool_calls(
                (validation.get("provenance") or {}).get("agent")
                if isinstance(validation, dict)
                else None
            )
        if isinstance(validation, dict) and (
            validation.get("repairs")
            or validation.get("failures")
            or validation.get("diagnoses")
        ):
            with st.expander(
                "Diagnosis and repairs for this run",
                icon=":material/troubleshoot:",
                expanded=True,
            ):
                render_diagnoses(validation)
    if trace:
        with st.expander("Node timings", icon=":material/timer:"):
            dataframe(
                [
                    {
                        "Node": labels.node_label(node),
                        "Status": labels.NODE_STATES.get(
                            state["status"], (labels.humanize(state["status"]), "")
                        )[0],
                        "Visits": state["visits"],
                        "Milliseconds": round(state["elapsedMs"], 2),
                    }
                    for node, state in trace.items()
                ]
            )
    graph = review.get("graph") or {}
    edges = graph.get("edges") or []
    if edges:
        with st.expander(
            "Full graph with transition conditions", icon=":material/schema:"
        ):

            def node_id(raw: Any) -> str:
                return "".join(ch for ch in str(raw) if ch.isalnum()) or "Node"

            def node_text(raw: Any) -> str:
                return labels.node_label(raw).replace('"', "'")

            nodes = {edge["from"] for edge in edges} | {edge["to"] for edge in edges}
            colours = {
                "coordinator": "#1D1D1F",
                "agent": "#0071E3",
                "gate": "#FF9F0A",
                "publish": "#34C759",
            }
            declarations = " ".join(
                f'{node_id(n)} [label="{node_text(n)}", color="{colours.get(labels.AGENT_NODES.get(str(n), ("", "agent"))[1], "#0071E3")}"];'
                for n in sorted(nodes)
            )
            links = " ".join(
                f'{node_id(edge["from"])} -> {node_id(edge["to"])} [label="{str(edge.get("condition", "")).replace(chr(34), chr(39))}"];'
                for edge in edges
            )
            st.graphviz_chart(
                "digraph AURA { rankdir=LR; bgcolor=transparent; "
                'node [shape=box, style="rounded,filled", fillcolor=white, fontname="Inter, Helvetica", fontsize=11, penwidth=1.5]; '
                'edge [fontname="Helvetica", fontsize=9, color="#C7C7CC", fontcolor="#6E6E73"]; '
                + declarations
                + " "
                + links
                + " }",
                width="stretch",
            )
