"""One student's profile for staff: a mentor (own mentees) or the department head (any
student in the department). Mentors decide for their mentees; the department head can
see everything in the department and decide drafts too."""

from __future__ import annotations

from typing import Any

import streamlit as st

import labels
import ui
from common import (
    average,
    dataframe,
    display_name,
    load,
    percent,
    person_id,
    pick,
    sections,
)
from views.freshness import figures_label, render_rereview
from views.sources import (
    render_context_fields,
    render_informational_records,
    render_source_evidence,
)
from views.student import render_course_cards

MENTOR_SECTIONS = [
    "Overview",
    "Attendance",
    "Marks",
    "Signals",
    "Plans and outcomes",
    "Source records",
]
HOD_SECTIONS = ["Overview", "Attendance", "Marks", "Signals", "Support plans", "Source records"]


def student_options(students: list[dict[str, Any]]) -> tuple[list[str], dict[str, str]]:
    """Ids sorted by name, and the label shown for each."""
    ordered = sorted(
        (s for s in students if person_id(s)),
        key=lambda s: labels.pretty_name(display_name(s)).lower(),
    )
    ids = [person_id(s) for s in ordered]
    names = {
        person_id(s): " · ".join(
            str(part)
            for part in [labels.pretty_name(display_name(s)), s.get("register_number")]
            if part
        )
        for s in ordered
    }
    return ids, names


def pick_student(students: list[dict[str, Any]], *, label: str, key: str) -> str | None:
    """A non-typeable picker with its own search box for long lists."""
    ids, names = student_options(students)
    if not ids:
        return None
    return pick(label, ids, format_func=lambda i: names.get(i, i), key=key)


def latest_risk(rows: list[dict[str, Any]], student_id: str) -> dict[str, Any] | None:
    mine = [r for r in rows if str(r.get("studentId")) == str(student_id)]
    return next((r for r in mine if r.get("latest", True)), mine[0] if mine else None)


def render_signals(row: dict[str, Any] | None) -> None:
    if not row:
        ui.empty_state(
            "Not evaluated yet",
            "Signals appear here after a review cycle has scored this student.",
        )
        return
    st.markdown(ui.risk_md(row.get("band"), row.get("score")))
    ui.html_block(ui.signal_chips(row.get("signals") or []))
    if row.get("reviewPath"):
        ui.plain_text(row["reviewPath"], muted=True)
    dataframe(
        [
            {
                "Signal": labels.signal_label(signal["code"]),
                "Source": labels.source_label(signal["source"]),
                "Value": signal["value"],
                "Threshold": signal["threshold"],
                "Points": signal["points"],
                "Reason": labels.readable_claim(signal["explanation"]),
            }
            for signal in row.get("signals") or []
        ]
    )


def current_plan(support: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The student's approved current plan: the newest one shown to the family and on
    the current figures (the one the student and parent see)."""
    return next(
        (
            row
            for row in support
            if row.get("visible") and row.get("evidence_current", True) is not False
        ),
        None,
    )


def plan_rows(plans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "Approved actions": "; ".join(
                a.get("label", "") for a in (p.get("plan") or {}).get("actions", [])
            ),
            "Status": labels.status_label(p.get("status")),
            "Outcome": p.get("outcome") or "Not recorded",
            "Meeting": labels.meeting_cell(p)
            if p.get("visible_to_student")
            else "Not needed, plan withdrawn",
            "Figures": figures_label(p),
            "Decided by": p.get("decided_by"),
            "Decision time": labels.nice_time(p.get("decided_at")),
        }
        for p in plans
    ]


@st.fragment
def render_profile(student_id: str, role: str) -> None:
    """A student's profile. Choosing a section reruns only this block, and a
    section's data is fetched when it is opened."""
    detail = load("student", {"studentId": student_id})
    student = detail.get("student") or {}
    mentor = detail.get("mentor") or {}
    courses = detail.get("courses") or []
    followups = detail.get("followups") or []
    is_mentor = role == "faculty"
    st.subheader(labels.pretty_name(display_name(student)), anchor=False)
    st.caption(
        " · ".join(
            str(part)
            for part in [
                student.get("register_number"),
                f"Semester {student['semester']}" if student.get("semester") else None,
                f"Mentor {mentor['name']}" if mentor.get("name") else None,
            ]
            if part
        )
    )
    # The meeting after the approved current plan: held (with the reasons the student
    # gave) or not recorded yet, with its due date.
    plan = current_plan(detail.get("support") or [])
    if plan:
        overdue = (plan.get("checkin_days_overdue") or 0) > 0 and not plan.get("meeting")
        st.caption(
            (":material/event_busy: " if overdue else ":material/handshake: ")
            + labels.meeting_line(plan)
            + (f" ({labels.days_word(int(plan['checkin_days_overdue']))} overdue)" if overdue else "")
        )
    section = sections(
        MENTOR_SECTIONS if is_mentor else HOD_SECTIONS, key=f"profile_section_{role}"
    )
    if section == "Overview":
        if courses:
            render_course_cards(courses)
        if followups:
            ui.section("Mentor follow-ups")
            dataframe(
                [
                    {
                        "Due": labels.nice_date(r.get("due_on")),
                        "Mentor": r.get("mentor_name"),
                        "Note": r.get("note"),
                        "Status": labels.status_label(r.get("status")),
                        "Outcome": r.get("outcome") or "Not recorded",
                    }
                    for r in followups
                ]
            )
    elif section == "Attendance":
        st.caption(":material/fact_check: " + labels.ATTENDANCE_BASIS_NOTE)
        dataframe(
            [
                {
                    "Course": f"{r.get('code', '')} · {r.get('title', '')}",
                    "Present": r.get("present"),
                    "Absent": r.get("absent"),
                    "Late": r.get("late"),
                    "Attendance": percent(r.get("percentage")),
                }
                for r in courses
            ],
            empty="No courses are registered yet.",
        )
        ui.section("Every recorded session")
        dataframe(
            [
                {
                    "Date": labels.nice_date(r.get("session_date")),
                    "Course": r.get("code"),
                    "Topic": r.get("topic"),
                    "Status": labels.status_label(r.get("status")),
                }
                for r in detail.get("attendance", [])
            ],
            empty="No attendance has been recorded yet.",
        )
    elif section == "Marks":
        dataframe(
            [
                {
                    "Course": r.get("code"),
                    "Assessment": r.get("assessment"),
                    "Score": f"{r.get('score')} / {r.get('maximum_score')}",
                    "Feedback": r.get("feedback") or "No feedback recorded",
                }
                for r in detail.get("marks", [])
            ],
            empty="No marks have been recorded yet.",
        )
    elif section == "Signals":
        review = load("review_overview")
        render_signals(latest_risk(review.get("riskView") or [], student_id))
        render_context_fields(detail)
    elif section in ("Plans and outcomes", "Support plans"):
        queue = load("review_queue")
        mine = [
            p
            for p in queue.get("plans") or []
            if str(p.get("student_id")) == student_id
        ]
        waiting = [
            d
            for d in queue.get("drafts") or []
            if str(d.get("student_id")) == student_id
        ]
        if is_mentor and waiting:
            ui.gate_banner(
                f"{len(waiting)} draft{'s are' if len(waiting) != 1 else ' is'} waiting for your decision. "
                "Open Reviews to approve, edit or decline.",
                title="Needs you",
            )
        if role == "hod" and waiting:
            # The department head reads the draft and decides with the mentor's form
            # (owner decision, 17 Oct).
            from views.reviews import render_draft_reviews

            review = load("review_overview")
            risk_by_student = {
                str(r.get("studentId")): r
                for r in review.get("riskView") or []
                if r.get("latest", True)
            }
            render_draft_reviews(
                {"drafts": waiting},
                st.session_state.get("actor") or {"role": role},
                risk_by_student,
                {student_id: labels.pretty_name(mentor.get("name") or "Not assigned")},
                show_list=False,
            )
        render_rereview(mine, role=role, key="profile_rereview")
        dataframe(
            plan_rows(mine),
            empty="No approved plans yet."
            + (" A drafted plan is waiting for the mentor (above)." if waiting else ""),
        )
    else:
        render_informational_records(detail)
        ui.section("College records")
        render_source_evidence(student.get("register_number"), student.get("name"))
