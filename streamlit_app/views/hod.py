"""Department head pages: department trends, any student read-only, mentors, policies."""

from __future__ import annotations

import statistics
from datetime import datetime, timezone
from typing import Any

import streamlit as st

import labels
import ui
from common import dataframe, load, load_many, value
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
                    else "None waiting"
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


def overview_page() -> None:
    overview, review = load_many([("overview", None), ("review_overview", None)])
    ui.page_header(
        "Department overview",
        "How the department's students and support reviews are doing, in aggregate.",
        eyebrow="Department head",
    )
    counts = overview.get("counts") or {}
    ui.kpi_row(
        [
            {
                "label": "Students in scope",
                "value": value(
                    counts, "students", default=len(overview.get("students", []))
                ),
                "icon": ":material/groups:",
            },
            {
                "label": "Courses",
                "value": value(
                    counts, "courses", default=len(overview.get("courses", []))
                ),
                "icon": ":material/menu_book:",
            },
            {
                "label": "Follow-ups overdue",
                "value": value(counts, "overdue_followups", default=0),
                "icon": ":material/alarm:",
            },
            {
                "label": "Reviews awaiting work",
                "value": value(counts, "pending_reviews", default=0),
                "icon": ":material/front_hand:",
            },
        ]
    )
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
        eyebrow="Department head",
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
        eyebrow="Department head",
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
        eyebrow="Department head",
    )
    render_policies(load("review_overview"), actor)
