"""Department head pages: department trends, any student read-only, mentors, policies."""

from __future__ import annotations

import statistics
from datetime import datetime, timezone
from typing import Any

import streamlit as st

import labels
import ui
from common import dataframe, load, load_many, paged, value
from views.metrics import render_review_trends
from views.profile import pick_student, render_profile
from views.reviews import render_policies


def mentor_workload(
    overview: dict[str, Any], queue: dict[str, Any]
) -> list[dict[str, Any]]:
    """One row per mentor: mentees, drafts still waiting, how long, decisions made."""
    mentor_of = {
        str(s.get("id")): labels.pretty_name(s.get("mentor_name") or "Unassigned")
        for s in overview.get("students") or []
    }
    names = sorted(
        {
            labels.pretty_name(f.get("name") or "")
            for f in overview.get("faculty") or []
            if f.get("name")
        }
        | set(mentor_of.values())
    )
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
        decided = [
            p
            for p in queue.get("plans") or []
            if labels.pretty_name(p.get("decided_by") or "") == name
        ]
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
                "Decisions made": len(decided),
                "Last decision": labels.nice_time(
                    max((str(p.get("decided_at") or "") for p in decided), default="")
                )
                if decided
                else "None yet",
            }
        )
    return rows


FLAG_OUTCOMES = {"awaiting_faculty", "awaiting_review", "human_review", "approved", "published",
                 "rejected", "declined", "needs_human", "ai_unavailable", "failed", "blocked"}
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
    """Every student whose latest review flagged them, a page at a time. No score,
    band or draft content: those stay with the student's own mentor."""
    from views.operations import latest_per_student

    jobs = [j for j in review.get("jobs") or [] if j.get("status") != "queued"]
    flagged = [
        j
        for j in latest_per_student(jobs)
        if j.get("run_id") or str(j.get("status") or "") in FLAG_OUTCOMES - {"not_flagged"}
    ]
    people = {str(s.get("id")): s for s in review.get("students") or []}
    order = {"needs_human": 0, "ai_unavailable": 0, "failed": 0, "awaiting_faculty": 1}
    flagged.sort(
        key=lambda j: (
            order.get(str(j.get("status")), 2),
            labels.pretty_name(people.get(str(j.get("student_id")), {}).get("display_name") or ""),
        )
    )
    ui.section(
        f"Flagged students ({len(flagged)})",
        "Every student the agents flagged in their latest review, and where their plan stands. "
        "Scores, reasons and draft content are visible only to the student's mentor.",
    )
    listed = {str(j.get("student_id")) for j in flagged if str(j.get("status")) in AWAITING_OUTCOMES}
    note = waiting_gap_note(listed, queue or {})
    if note:
        st.caption(note)
    if not flagged:
        ui.empty_state("No flagged students", "The latest reviews flagged nobody.")
        return
    page = paged(flagged, "hod_flagged_page", noun="flagged students")
    dataframe(
        [
            {
                "Student": labels.pretty_name(
                    people.get(str(j.get("student_id")), {}).get("display_name") or "Student"
                ),
                "Register number": people.get(str(j.get("student_id")), {}).get("register_number")
                or "Not listed",
                "Mentor": labels.pretty_name(
                    people.get(str(j.get("student_id")), {}).get("mentor_name") or "Not assigned"
                ),
                "Where it stands": labels.run_outcome(j.get("status"), j.get("error_code")),
                "Drafted by": labels.drafted_by(j.get("mode"), j.get("model_id"), j.get("status")),
                "Reviewed": labels.nice_time(j.get("updated_at") or j.get("created_at")),
            }
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


def students_page() -> None:
    ui.page_header(
        "Students",
        "Search the department's students and open a read-only profile.",
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
        "Each mentor's workload and how quickly their decisions are made.",
    )
    dataframe(
        mentor_workload(overview, queue),
        empty="No mentors are assigned yet.",
    )
    st.caption(
        "Wait is measured from when an AI draft reached the mentor's gate until now. "
        "Mentors alone decide; the department head observes."
    )


def policies_page() -> None:
    actor = st.session_state.get("actor") or {}
    ui.page_header(
        "Policies",
        "The thresholds and rules the review agents apply. Mentors approve them; you can read them.",
    )
    render_policies(load("review_overview"), actor)
