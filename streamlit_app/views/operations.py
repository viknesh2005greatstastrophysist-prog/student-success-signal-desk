"""AI activity pages: runs, agent graph, evaluation, audit and replay.

This workspace observes the agents; it never decides. Individual source rows and
risk scores are not shown here. Mentors run the reviews and decide for their mentees;
the department head can see everything in the department and decide drafts too.
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


def latest_per_student(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per student: their most recent review. A student reviewed again (for
    example after new figures) is not counted twice."""
    latest: dict[str, dict[str, Any]] = {}
    for job in jobs:
        key = str(job.get("student_id") or job.get("id"))
        stamp = str(job.get("created_at") or "")
        if key not in latest or stamp > str(latest[key].get("created_at") or ""):
            latest[key] = job
    return sorted(latest.values(), key=lambda j: str(j.get("updated_at") or j.get("created_at") or ""), reverse=True)


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
                "label": "Students checked",
                "value": len(latest_per_student(jobs)),
                "icon": ":material/smart_toy:",
                "help": f"Students the agents have checked in a review. {len(waiting)} more are planned and waiting to start; they are listed separately.",
            },
            {
                "label": "Plans drafted",
                "value": sum(1 for job in latest_per_student(jobs) if job.get("run_id")),
                "icon": ":material/edit_document:",
                "help": "Students the risk check flagged, for whom an AI model drafted a plan. The rest needed no plan.",
            },
            {
                "label": "All drafts that passed every check",
                "value": f"{totals.get('validationPassed', 0)} of {totals.get('evaluated', 0)}",
                "icon": ":material/verified:",
                "help": "Drafts that passed the privacy, citation and policy checks before reaching the mentor.",
            },
            {
                "label": "Handed to a mentor",
                "value": sum(1 for job in latest_per_student(jobs) if job.get("status") == "needs_human"),
                "icon": ":material/front_hand:",
                "help": "Students whose latest review the agents could not finish, so their mentor decides without a draft.",
            },
            {
                "label": "Waiting for AI",
                "value": sum(
                    1 for job in latest_per_student(jobs) if job.get("status") == "ai_unavailable"
                ),
                "icon": ":material/cloud_off:",
                "help": "Students whose latest review got no answer from an AI model. They wait for the mentor to retry; nothing is drafted by rules.",
            },
        ]
    )
    runs_body(actor)


@st.fragment
def runs_body(actor: dict[str, Any]) -> None:
    review = load("review_overview")
    jobs, waiting = split_jobs(review)
    # A planned review is moot once the student has a newer review that ran.
    newest = {str(j.get("student_id")): str(j.get("created_at") or "") for j in latest_per_student(jobs)}
    replaced = [w for w in waiting if newest.get(str(w.get("student_id")), "") > str(w.get("created_at") or "")]
    waiting = [w for w in waiting if w not in replaced]
    section = sections(["Recorded runs", "Plans and traces"], key="runs_section")
    if section == "Plans and traces":
        render_plan_workbench(review, actor)
        return
    if replaced:
        st.caption(
            f":material/update: {len(replaced)} planned reviews were replaced by a newer review of the same students and are kept on record."
        )
    if waiting:
        paused = sum(1 for job in waiting if job.get("plan_paused"))
        with st.expander(
            f"Waiting to start ({len(waiting)})", icon=":material/hourglass_empty:"
        ):
            st.caption(
                "These reviews were planned and locked but have not been run, so they are not recorded runs. "
                f"{paused} sit in a paused plan. Nothing is lost; they start when the mentor runs the plan."
            )
            people = {str(s.get("id")): s for s in review.get("students") or []}
            dataframe(
                [
                    {
                        "Student": labels.pretty_name(
                            people.get(str(row.get("student_id")), {}).get("display_name")
                            or "Student"
                        ),
                        "Mentor": labels.pretty_name(
                            people.get(str(row.get("student_id")), {}).get("mentor_name")
                            or "Not assigned"
                        ),
                        "Why it has not run": "The mentor paused the plan"
                        if row.get("plan_paused")
                        else "Planned, waiting for the mentor to run it",
                        "Planned on": labels.nice_time(row.get("created_at")),
                    }
                    for row in waiting
                ]
            )
    can_replay = actor.get("role") == "governance"
    every_run = jobs
    jobs = latest_per_student(jobs)
    drafted = [row for row in jobs if row.get("run_id")]
    view = pick(
        "Show",
        ["Plans drafted", "No plan needed", "All runs"],
        key="runs_view",
        label_visibility="collapsed",
    )
    shown = (
        drafted
        if view == "Plans drafted"
        else [row for row in jobs if row.get("status") == "not_flagged"]
        if view == "No plan needed"
        else jobs
    )
    st.caption(
        f"Each row is one student's latest review ({len(every_run) - len(jobs)} earlier reviews of the same students are kept on record). "
        "Students who needed support got a "
        "plan drafted by an AI model; the rest were checked and left alone."
        + (" Click **Open replay** to verify a drafted plan." if can_replay and drafted else "")
    )
    with st.expander("How each student is assessed", icon=":material/help:"):
        st.markdown(
            "1. A mentor starts a review for their students; the planner agent sets it up.\n"
            "2. Collector agents gather the student's attendance (college records), marks, LMS activity, "
            "internship and placement records, and an evidence check confirms they are complete and current.\n"
            "3. The risk agent scores the student against the department's support policy.\n"
            "4. **Not flagged:** the run ends as *Checked, no support needed*. Nothing is drafted, so there is "
            "no model and no replay.\n"
            "5. **Flagged:** specialist agents and an investigator build the case, an AI model drafts a plan, "
            "a validator and a separate judge model check it, and it waits for the mentor.\n"
            "6. The mentor or the department head approves, edits or declines. Students and parents see a plan "
            "only after approval.\n\n"
            "**Replay** re-checks a saved run from its recorded inputs and compares fingerprints; it does not "
            "call the model again. Each agent's step for a run is under *Plans and traces*. A student's score "
            "and reasons are shown only to their mentor and the department head."
        )
    people = {str(s.get("id")): s for s in review.get("students") or []}
    clicked = dataframe(
        [
            {
                "Student": " · ".join(
                    part
                    for part in (
                        labels.pretty_name(
                            people.get(str(row.get("student_id")), {}).get("display_name")
                            or "Student"
                        ),
                        people.get(str(row.get("student_id")), {}).get("register_number"),
                    )
                    if part
                ),
                "Mentor": labels.pretty_name(
                    people.get(str(row.get("student_id")), {}).get("mentor_name") or "Not assigned"
                ),
                "When": labels.nice_time(row.get("updated_at") or row.get("created_at")),
                "What happened": labels.run_outcome(row.get("status"), row.get("error_code"), row.get("intervention_status")),
                "Drafted by": labels.drafted_by(
                    row.get("mode"), row.get("model_id"), row.get("status")
                ),
                "Replay": ("Open replay ›" if can_replay else "Available")
                if row.get("run_id")
                else "Not needed"
                if row.get("status") == "not_flagged"
                else "Not available",
            }
            for row in shown
        ],
        empty="No runs of this kind have been recorded yet.",
        key="runs_table",
        select_cell=can_replay,
    )
    if clicked and clicked[1] == "Replay" and 0 <= clicked[0] < len(shown):
        run_id = shown[clicked[0]].get("run_id")
        if run_id:
            open_replay(str(run_id))


def open_replay(run_id: str) -> None:
    """Go to Audit and replay with this run chosen; the replay runs on arrival."""
    from views.pages import pages_for

    st.session_state["replay_open"] = run_id
    target = next((p for p in pages_for("governance") if p.url_path == "audit"), None)
    if target is not None:
        st.switch_page(target)


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
    names = {
        str(s.get("id")): labels.pretty_name(s.get("display_name") or "Student")
        for s in review.get("students") or []
    }
    opened = st.session_state.pop("replay_open", None)
    replay_ids = [str(row.get("run_id", "")) for row in replayable]
    if opened in replay_ids:
        # Arriving from "Open replay": choose that run even if another was chosen before.
        st.session_state.pop("governance_replay_run", None)
        st.session_state.pop("governance_replay_run__search", None)
    if actor.get("role") == "governance" and replayable:
        with ui.card("replay"):
            st.markdown("##### Verify a recorded run")
            st.caption(
                "Recomputes policy and validation checks from the recorded inputs and compares hashes. It does not re-run model inference."
            )
            run_id = pick(
                "Completed run",
                replay_ids,
                index=replay_ids.index(opened) if opened in replay_ids else 0,
                format_func=lambda rid: next(
                    (
                        f"{names.get(str(row.get('student_id')), 'Student')} · "
                        f"{labels.run_outcome(row.get('status'), row.get('error_code'), row.get('intervention_status'))} · "
                        f"{labels.nice_time(row.get('updated_at'))} · run {labels.short_ref(rid)}"
                        for row in replayable
                        if str(row.get("run_id", "")) == rid
                    ),
                    rid,
                ),
                key="governance_replay_run",
            )
            pressed = st.button(
                "Replay saved run",
                type="primary",
                key="governance_replay",
                icon=":material/replay:",
            )
            if (pressed or (opened and opened == run_id)) and run_id:
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
        ":material/shield: AI activity receives each student's review record: what happened, which model drafted, "
        "and how the checks and the judge scored it. It never receives risk scores, evidence values, draft text "
        "or the judge's written reasons."
    )
