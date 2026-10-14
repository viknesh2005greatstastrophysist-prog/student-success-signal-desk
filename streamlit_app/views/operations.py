"""AI activity pages: runs, agent graph, evaluation, audit and replay.

This workspace observes the agents; it never decides. Individual source rows and
risk scores are not shown here.
"""

from __future__ import annotations

from typing import Any

import streamlit as st

import labels
import ui
from common import dataframe, load, pick, save_action, sections
from views.metrics import render_agent_graph, render_evaluation_metrics
from views.reviews import render_plan_workbench, render_policies


def _header(title: str, caption: str) -> None:
    ui.page_header(title, caption, eyebrow="Governance & audit")


def split_jobs(
    review: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Jobs that have not started are waiting, not recorded runs (E2E log #11)."""
    all_jobs = review.get("jobs") or []
    return (
        [job for job in all_jobs if job.get("status") != "queued"],
        [job for job in all_jobs if job.get("status") == "queued"],
    )


def runs_page() -> None:
    actor = st.session_state.get("actor") or {}
    review = load("review_overview")
    jobs, waiting = split_jobs(review)
    totals = (review.get("metrics") or {}).get("totals") or {}
    _header(
        "Runs",
        "Watch the agents work. Open a plan to see each agent's trace. This workspace can observe but never decide.",
    )
    ui.kpi_row(
        [
            {
                "label": "Recorded runs",
                "value": len(jobs),
                "icon": ":material/smart_toy:",
                "help": f"Reviews that have started. {len(waiting)} more are waiting to start and are listed separately.",
            },
            {
                "label": "Passed validation",
                "value": labels.percent_text(
                    totals.get("validationPassed", 0), totals.get("evaluated", 0)
                ),
                "icon": ":material/verified:",
                "help": f"{totals.get('validationPassed', 0)} of {totals.get('evaluated', 0)} drafts that reached validation.",
            },
            {
                "label": "Escalations",
                "value": totals.get("escalated", 0),
                "icon": ":material/front_hand:",
                "help": "Reviews handed to a mentor because the agents could not finish them.",
            },
            {
                "label": "Waiting for AI",
                "value": sum(
                    1 for job in jobs if job.get("status") == "ai_unavailable"
                ),
                "icon": ":material/cloud_off:",
                "help": "Reviews where no AI model answered. They wait for the mentor to retry; nothing is drafted by rules.",
            },
        ]
    )
    runs_body(actor)


@st.fragment
def runs_body(actor: dict[str, Any]) -> None:
    review = load("review_overview")
    jobs, waiting = split_jobs(review)
    section = sections(["Recorded runs", "Plans and traces"], key="runs_section")
    if section == "Plans and traces":
        render_plan_workbench(review, actor)
        return
    if waiting:
        paused = sum(1 for job in waiting if job.get("plan_paused"))
        with st.expander(
            f"Waiting to start ({len(waiting)})", icon=":material/hourglass_empty:"
        ):
            st.caption(
                "These reviews were planned and locked but have not been run, so they are not recorded runs. "
                f"{paused} sit in a paused plan. Nothing is lost; they start when the mentor runs the plan."
            )
            dataframe(
                [
                    {
                        "Review": labels.short_ref(row.get("id")),
                        "Plan": labels.short_ref(row.get("plan_id")),
                        "Plan state": "Paused"
                        if row.get("plan_paused")
                        else "Locked, not run",
                        "Created": labels.nice_time(row.get("created_at")),
                    }
                    for row in waiting
                ]
            )
    dataframe(
        [
            {
                "Run": labels.short_ref(row.get("id")),
                "Status": labels.status_label(row.get("status")),
                "Stage": labels.status_label(row.get("stage")),
                "Drafted by": labels.mode_label(row.get("mode"))
                if row.get("mode")
                else "—",
                "Replay record": "Available" if row.get("run_id") else "Not available",
                "Issue": labels.issue_label(row.get("error_code")),
            }
            for row in jobs
        ],
        empty="No runs have been recorded yet.",
    )


def graph_page() -> None:
    _header(
        "Agent graph",
        "How the agents hand work to each other, and what each one did in a run.",
    )
    render_agent_graph(load("review_overview"))


def evaluation_page() -> None:
    _header(
        "Evaluation",
        "Draft quality and failure metrics across every recorded review.",
    )
    render_evaluation_metrics(load("review_overview"))


def audit_page() -> None:
    actor = st.session_state.get("actor") or {}
    review = load("review_overview")
    jobs, _ = split_jobs(review)
    _header(
        "Audit and replay",
        "Verify a recorded run and read the policies the agents applied.",
    )
    replayable = [row for row in jobs if row.get("run_id")]
    if actor.get("role") == "governance" and replayable:
        with ui.card("replay"):
            st.markdown("##### Verify a recorded run")
            st.caption(
                "Recomputes policy and validation checks from the recorded inputs and compares hashes. It does not re-run model inference."
            )
            run_id = pick(
                "Completed run",
                [str(row.get("run_id", "")) for row in replayable],
                format_func=lambda rid: next(
                    (
                        f"{labels.status_label(row.get('status', 'Run'))} · {labels.nice_time(row.get('updated_at'))} · run {labels.short_ref(rid)}"
                        for row in replayable
                        if str(row.get("run_id", "")) == rid
                    ),
                    rid,
                ),
                key="governance_replay_run",
            )
            if (
                st.button(
                    "Replay saved run",
                    type="primary",
                    key="governance_replay",
                    icon=":material/replay:",
                )
                and run_id
            ):
                result = save_action("replay", {"runId": run_id}, "Replay completed.")
                if result:
                    replay = result.get("replay") or {}
                    if replay.get("matched"):
                        st.success(
                            "Replay matched the saved run.", icon=":material/verified:"
                        )
                    else:
                        st.warning(
                            "Replay did not match the saved run.",
                            icon=":material/report:",
                        )
                    ui.tech_details(
                        [
                            ("Input hash", replay.get("inputHash", "Not recorded")),
                            ("Output hash", replay.get("outputHash", "Not recorded")),
                        ],
                        label="Replay hashes",
                    )
    elif actor.get("role") != "governance":
        st.info(
            "This governance workspace is read-only for your account.",
            icon=":material/visibility:",
        )
    else:
        ui.empty_state(
            "No recorded runs to verify", "Runs appear here once reviews have started."
        )
    ui.section("Policies in force", icon=":material/policy:")
    render_policies(review, actor)
    st.caption(
        ":material/shield: AI activity receives aggregate counts only, never individual source rows or risk scores."
    )
