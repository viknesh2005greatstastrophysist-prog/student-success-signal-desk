"""Department head pages: department trends, any student's profile, reviews, mentors and
policies. Mentors decide for their mentees; the department head can see and act on
everything in the department (owner decision, 17 Oct)."""

from __future__ import annotations

import statistics
from datetime import datetime, timezone
from typing import Any

import streamlit as st

import labels
import ui
from common import dataframe, load, load_many, paged, sections, value
from views.metrics import render_review_trends
from views.profile import pick_student, render_profile
from views.reviews import (
    SHARED_AUTHORITY,
    render_draft_reviews,
    render_legacy_drafts,
    render_outcomes,
    render_plan_workbench,
    render_policies,
    risk_cell,
)


def mentor_workload(
    overview: dict[str, Any], queue: dict[str, Any]
) -> list[dict[str, Any]]:
    """One row per mentor: mentees, drafts still waiting, how long, decisions made.
    Decisions are approvals and declines alike (the Core counts them per mentor).
    Students without a mentor are not a mentor row (review R-16); see
    `students_without_mentor`."""
    mentor_of = {
        str(s.get("id")): labels.pretty_name(s.get("mentor_name"))
        for s in overview.get("students") or []
        if s.get("mentor_name")
    }
    names = sorted(
        {
            labels.pretty_name(f.get("name") or "")
            for f in overview.get("faculty") or []
            if f.get("name")
        }
        | set(mentor_of.values())
    )
    decisions = {
        labels.pretty_name(d.get("mentor_name") or ""): d
        for d in queue.get("mentorDecisions") or []
    }
    now = datetime.now(timezone.utc)
    rows = []
    for name in names:
        mentees = [sid for sid, mentor in mentor_of.items() if mentor == name]
        waits = []
        for draft in queue.get("drafts") or []:
            if mentor_of.get(str(draft.get("student_id"))) != name:
                continue
            try:
                drafted = datetime.fromisoformat(str(draft.get("drafted_at")))
                waits.append((now - drafted).total_seconds() / 3600)
            except (TypeError, ValueError):
                continue
        decided = decisions.get(name) or {}
        rows.append(
            {
                "Mentor": name,
                "Mentees": len(mentees),
                "Drafts waiting": len(waits),
                "Median wait for open drafts": (
                    labels.hours_phrase(statistics.median(waits))
                    if waits
                    else "Nothing waiting"
                ),
                "Decisions made": int(decided.get("decisions") or 0),
                "Last decision": labels.nice_time(decided.get("last_decided_at"))
                if decided.get("last_decided_at")
                else "None yet",
            }
        )
    return rows


def students_without_mentor(overview: dict[str, Any]) -> int:
    return sum(1 for s in overview.get("students") or [] if not s.get("mentor_name"))


def render_unassigned_line(overview: dict[str, Any]) -> None:
    """One separate line under the mentor table, only when some student has no mentor."""
    unassigned = students_without_mentor(overview)
    if unassigned:
        st.caption(f":material/person_off: Students without a mentor: {unassigned}")


# A review that ended in one of these without a risk analysis flagged nobody (review R-09).
STOPPED_OUTCOMES = {"failed", "blocked", "needs_human", "ai_unavailable"}
AWAITING_OUTCOMES = ("awaiting_faculty", "awaiting_review", "human_review")


def _drafts(n: int) -> str:
    return f"{n} draft{'s' if n != 1 else ''}"


def waiting_gap_note(listed: set[str], queue: dict[str, Any]) -> str | None:
    """Why the Drafts waiting card and the flagged list disagree, in plain words.

    The card counts each student's latest open AI draft (one rule in the Core, the
    same one behind the mentor's gate): an older draft drops out once the student
    has a newer review. The list shows each student's latest review. They differ
    only for a draft on earlier figures (kept on record unchanged), a draft whose
    student has a newer review still running, or a listed student whose draft
    comes from the retired rule-based path."""
    drafts = queue.get("drafts") or []
    counted = {str(d.get("student_id")) for d in drafts}
    outside = [d for d in drafts if str(d.get("student_id")) not in listed]
    earlier = sum(1 for d in outside if d.get("evidence_current") is False)
    running = len(outside) - earlier
    legacy = {str(d.get("student_id")) for d in queue.get("legacyDrafts") or []}
    retired = len({sid for sid in listed - counted if sid in legacy})
    parts = []
    if earlier:
        parts.append(f"{_drafts(earlier)} from a review on earlier figures, kept on record unchanged")
    if running:
        parts.append(f"{_drafts(running)} for students whose newer review is still running")
    notes = []
    if parts:
        notes.append("The Drafts waiting card also counts " + " and ".join(parts) + ".")
    if retired:
        notes.append(
            f"{retired} student{'s' if retired != 1 else ''} in the list "
            f"{'wait' if retired != 1 else 'waits'} on a draft from the retired rule-based path, "
            "which the card does not count."
        )
    return " ".join(notes) or None


def render_flagged_students(review: dict[str, Any], queue: dict[str, Any] | None = None) -> None:
    """Every student whose latest review flagged them, a page at a time, with the risk
    band and score, then the reviews that stopped before the risk check."""
    from views.operations import latest_per_student

    jobs = [j for j in review.get("jobs") or [] if j.get("status") != "queued"]
    latest = latest_per_student(jobs)
    # Flagged is the risk check's own verdict (the Core sends `flagged`, never the score).
    flagged = [j for j in latest if j.get("flagged") is True]
    stopped = [
        j for j in latest
        if j.get("flagged") is not True and str(j.get("status") or "") in STOPPED_OUTCOMES
    ]
    people = {str(s.get("id")): s for s in review.get("students") or []}

    def student(j: dict[str, Any]) -> dict[str, Any]:
        person = people.get(str(j.get("student_id")), {})
        return {
            "Student": labels.pretty_name(person.get("display_name") or "Student"),
            "Register number": person.get("register_number") or "Not listed",
            "Mentor": labels.pretty_name(person.get("mentor_name") or "Not assigned"),
            "Where it stands": labels.run_outcome(j.get("status"), j.get("error_code"), j.get("intervention_status")),
        }

    order = {"needs_human": 0, "ai_unavailable": 0, "failed": 0, "awaiting_faculty": 1}
    flagged.sort(
        key=lambda j: (
            order.get(str(j.get("status")), 2),
            labels.pretty_name(people.get(str(j.get("student_id")), {}).get("display_name") or ""),
        )
    )
    ui.section(
        f"Flagged students ({len(flagged)})",
        "Every student the agents flagged in their latest review, their risk, and where their plan stands. "
        "Open a student under Students, or a draft under Reviews, for the reasons and the draft.",
    )
    listed = {str(j.get("student_id")) for j in flagged if str(j.get("status")) in AWAITING_OUTCOMES}
    note = waiting_gap_note(listed, queue or {})
    if note:
        st.caption(note)
    if flagged:
        page = paged(flagged, "hod_flagged_page", noun="flagged students")
        dataframe(
            [
                {
                    **student(j),
                    "Risk": risk_cell(j.get("risk") if isinstance(j.get("risk"), dict) else None),
                    "Drafted by": labels.drafted_by(j.get("mode"), j.get("model_id"), j.get("status")),
                    "Reviewed": labels.nice_time(j.get("updated_at") or j.get("created_at")),
                }
                for j in page
            ]
        )
    else:
        ui.empty_state("No flagged students", "The latest reviews flagged nobody.")
    if stopped:
        ui.section(
            f"Reviews that stopped early ({len(stopped)})",
            "These reviews stopped before the risk check finished, so they are not counted as flagged. "
            "Each row says why.",
        )
        page = paged(stopped, "hod_stopped_page", noun="reviews")
        dataframe(
            [
                {**student(j), "Reviewed": labels.nice_time(j.get("updated_at") or j.get("created_at"))}
                for j in page
            ]
        )


def overview_page() -> None:
    overview, review, queue = load_many(
        [("overview", None), ("review_overview", None), ("review_queue", None)]
    )
    ui.page_header(
        "Department overview",
        "How the department's students and support reviews are doing, in aggregate.",
    )
    counts = overview.get("counts") or {}
    overdue = value(counts, "overdue_followups", default=0)
    ui.kpi_row(
        [
            {
                "label": "Students in scope",
                "value": value(
                    counts, "students", default=len(overview.get("students", []))
                ),
                "icon": ":material/groups:",
            },
            *(
                [{"label": "Follow-ups overdue", "value": overdue}]
                if overdue
                else []
            ),
            {
                # The review queue's own count: the same rule as the mentor's gate.
                "label": "Drafts waiting for a mentor",
                "value": value(queue, "awaitingCount", default=value(counts, "pending_reviews", default=0)),
                "icon": ":material/front_hand:",
            },
        ]
    )
    render_flagged_students(review, queue)
    render_review_trends(review)
    ui.section("Mentor workload", "Mentees per mentor. Details are under Mentors.")
    dataframe(
        [
            {"Mentor": r["Mentor"], "Mentees": r["Mentees"]}
            for r in mentor_workload(overview, {})
        ],
        empty="No mentors are assigned yet.",
    )
    render_unassigned_line(overview)


def students_page() -> None:
    ui.page_header(
        "Students",
        "Search the department's students and open a profile: signals, support plans and drafts, "
        "with the same decisions a mentor has.",
    )
    students_body()


@st.fragment
def students_body() -> None:
    students = load("overview").get("students") or []
    if not students:
        ui.empty_state("No students in scope", "Students will appear here.")
        return
    student_id = pick_student(students, label="Student", key="hod_student_pick")
    if student_id:
        render_profile(student_id, "hod")


def mentors_page() -> None:
    overview, queue = load_many([("overview", None), ("review_queue", None)])
    ui.page_header(
        "Mentors",
        "Each mentor's mentees, the drafts waiting for them and for how long, and the drafts they have approved or declined.",
    )
    dataframe(
        mentor_workload(overview, queue),
        empty="No mentors are assigned yet.",
    )
    render_unassigned_line(overview)
    st.caption(
        "Wait is measured from when an AI draft reached the gate until now. "
        f"Decisions made counts approvals and declines. {SHARED_AUTHORITY}"
    )


def policies_page() -> None:
    actor = st.session_state.get("actor") or {}
    ui.page_header(
        "Policies",
        "The thresholds and rules the review agents apply. You can approve one for any mentor in the department.",
    )
    render_policies(load("review_overview"), actor)


def reviews_page() -> None:
    """Drafts across the department, starting a review for a mentor's students,
    outcomes and policies: the mentor's Reviews, department-wide."""
    actor = st.session_state.get("actor") or {}
    ui.page_header(
        "Reviews",
        f"AI agents gather evidence, score risk and draft support. {SHARED_AUTHORITY}",
    )
    review = load("review_overview")
    if not review.get("modelConfigured"):
        ui.insight(
            "The AI model is not connected",
            "Drafts cannot be produced until it is. Existing drafts and decisions are not affected.",
        )
    reviews_body(actor)


@st.fragment
def reviews_body(actor: dict[str, Any]) -> None:
    queue, review = load_many([("review_queue", None), ("review_overview", None)])
    risk_by_student = {
        str(r.get("studentId")): r
        for r in review.get("riskView") or []
        if r.get("latest", True)
    }
    people = {str(s.get("id")): s for s in review.get("students") or []}
    mentor_by_student = {
        sid: labels.pretty_name(s.get("mentor_name") or "Not assigned") for sid, s in people.items()
    }
    awaiting = int(queue.get("awaitingCount", len(queue.get("drafts") or [])))
    drafts_label = f"Drafts at the gate ({awaiting})"
    # A click on "Mentor gate" in an agent trace opens that student's draft at the gate.
    gate_case = st.session_state.pop("open_gate_case", None)
    if gate_case:
        st.session_state["head_reviews_section"] = drafts_label
        st.session_state["head_draft_mentor"] = "All mentors"
        match = next(
            (d for d in queue.get("drafts") or [] if str(d.get("id")) == str(gate_case)),
            None,
        )
        if match:
            st.session_state["support_draft"] = match
    # "Review again with the latest figures" lands on Start a review with the
    # student's mentor and the student chosen.
    again = st.session_state.pop("rereview_student", None)
    if again:
        st.session_state["head_reviews_section"] = "Start a review"
        mentor_id = (people.get(str(again)) or {}).get("mentor_id")
        if mentor_id:
            st.session_state["plan_mentor"] = str(mentor_id)
        st.session_state["plan_students"] = [str(again)]
    section = sections(
        [drafts_label, "Start a review", "Outcomes", "Policies"],
        key="head_reviews_section",
    )
    if section.startswith("Drafts"):
        render_draft_reviews(queue, actor, risk_by_student, mentor_by_student)
        render_legacy_drafts(queue, actor)
    elif section == "Start a review":
        render_plan_workbench(review, actor)
    elif section == "Outcomes":
        render_outcomes(queue, actor)
    else:
        render_policies(review, actor)
