from __future__ import annotations

from typing import Any

import streamlit as st

import labels
import ui
from common import (
    PERCENT_COLUMN,
    average,
    dataframe,
    display_name,
    load,
    percent,
    percent_text,
    pick,
    sections,
    value,
)


def render_course_cards(courses: list[dict[str, Any]]) -> None:
    per_row = 3
    for start in range(0, len(courses), per_row):
        cols = st.columns(per_row)
        for col, row in zip(cols, courses[start : start + per_row]):
            with col, ui.card(f"course_{row.get('id', start)}_{row.get('code', '')}"):
                st.markdown(f"**{ui._md_safe(row.get('code', ''))}**")
                st.caption(str(row.get("title", "")))
                attendance = percent(row.get("percentage"))
                if attendance is None:
                    st.caption(":material/event_busy: Attendance not recorded yet")
                else:
                    st.progress(
                        min(max(attendance / 100, 0.0), 1.0),
                        text=f"Attendance · {attendance:g}%",
                    )
                if (
                    row.get("result_published")
                    and row.get("result_percentage") is not None
                ):
                    st.markdown(
                        ui.badge_md(
                            f"Result {percent_text(row['result_percentage'])}",
                            "green",
                            ":material/grading:",
                        )
                    )
                else:
                    st.markdown(
                        ui.badge_md(
                            "Result not published", "gray", ":material/hourglass_empty:"
                        )
                    )


def render_mentor_updates(followups: list[dict[str, Any]]) -> None:
    shared = [row for row in followups if row]
    if not shared:
        return
    ui.section("Updates from your mentor", "Check-ins your mentor has shared with you.")
    for index, row in enumerate(shared):
        with ui.card(f"update_{row.get('id', index)}"):
            top, badge = st.columns([4, 1.4], vertical_alignment="center")
            with top:
                st.markdown(
                    f"**{ui._md_safe(row.get('mentor_name') or 'Your mentor')}**"
                )
                st.caption(
                    f"{labels.nice_date(row.get('due_on'))} · {labels.due_phrase(row.get('due_on'))}"
                )
            with badge:
                st.markdown(ui.status_md(row.get("status")))
            ui.plain_text(row.get("note"))


def render_support_cards(support: list[dict[str, Any]], *, audience: str) -> None:
    if not support:
        return
    heading = "Your support plan" if audience == "student" else "Approved support plan"
    ui.section(
        heading,
        "Agreed by the assigned mentor. These are the next steps, not a judgement.",
    )
    for index, item in enumerate(support):
        plan = item.get("plan") or {}
        with ui.card(f"support_{index}"):
            ui.agent_chip_block(
                item.get("model_id"),
                note="Drafted by an AI agent. Approved by your mentor.",
            )
            st.caption(
                f":material/description: {ui._md_safe(labels.family_summary(plan.get('summary', 'Support plan')))}"
            )
            for action in plan.get("actions", []):
                due = action.get("dueInDays")
                st.markdown(
                    f":material/check_circle: **{ui._md_safe(action.get('label', 'Next step'))}**"
                    + (f" · within {due} days" if due is not None else "")
                )
            if plan.get("citations"):
                with st.expander("Why this plan was suggested", icon=":material/info:"):
                    ui.citation_chips(plan.get("citations", []))


def _student_context() -> tuple[dict[str, Any], dict[str, Any]] | None:
    """The signed-in student's own record, or a clear message when none is linked."""
    actor = st.session_state.get("actor") or {}
    student_id = value(actor, "studentId", "student_id")
    if not student_id:
        st.error("A student record is not linked to this account.")
        return None
    return actor, load("student", {"studentId": student_id})


def overview_page() -> None:
    """This term at a glance: the numbers, then the courses."""
    context = _student_context()
    if not context:
        return
    actor, detail = context
    student = detail.get("student") or {}
    name = display_name(student) if student else display_name(actor)
    ui.page_header(
        f"Welcome, {name.split()[0].title() if name else 'there'}",
        "Your term at a glance: courses, attendance and results.",
        eyebrow="Student workspace",
    )
    courses = detail.get("courses") or []
    followups = detail.get("followups") or []
    attendance_avg = average([percent(row.get("percentage")) for row in courses])
    published = [row for row in courses if row.get("result_published")]
    ui.kpi_row(
        [
            {
                "label": "Courses this term",
                "value": len(courses),
                "icon": ":material/menu_book:",
            },
            {
                "label": "Average attendance",
                "value": "—" if attendance_avg is None else f"{attendance_avg:g}%",
                "icon": ":material/event_available:",
            },
            {
                "label": "Results published",
                "value": f"{len(published)} of {len(courses)}" if courses else "0",
                "icon": ":material/grading:",
            },
            {
                "label": "Mentor check-ins ahead",
                "value": sum(1 for r in followups if r.get("status") != "completed"),
                "icon": ":material/event_note:",
            },
        ]
    )
    if courses:
        ui.section("Your courses", "Attendance and results recorded so far this term.")
        render_course_cards(courses)
        st.caption(":material/fact_check: " + labels.ATTENDANCE_BASIS_NOTE)
    else:
        ui.empty_state(
            "No courses yet",
            "Your registered courses will appear here once the term begins.",
        )
    if detail.get("support"):
        st.caption(
            ":material/handshake: Your mentor has confirmed support for you. "
            "Open **My support plan** to read it."
        )


def courses_page() -> None:
    """Attendance and marks, one course at a time."""
    context = _student_context()
    if not context:
        return
    _, detail = context
    ui.page_header(
        "Courses",
        "Attendance and marks for each course this term.",
        eyebrow="Student workspace",
    )
    courses = detail.get("courses") or []
    if not courses:
        ui.empty_state(
            "No courses yet",
            "Your registered courses will appear here once the term begins.",
        )
        return
    dataframe(
        [
            {
                "Course": f"{r.get('code', '')} · {r.get('title', '')}",
                "Present": r.get("present"),
                "Absent": r.get("absent"),
                "Attendance": percent(r.get("percentage")),
                "Result": percent_text(r.get("result_percentage"))
                if r.get("result_published") and r.get("result_percentage") is not None
                else "Not published",
            }
            for r in courses
        ],
        column_config={
            "Attendance": st.column_config.ProgressColumn(
                "Attendance", **PERCENT_COLUMN
            )
        },
    )
    course_detail(detail)


@st.fragment
def course_detail(detail: dict[str, Any]) -> None:
    """One course's sessions and marks. Picking a course or a section reruns only this."""
    courses = detail.get("courses") or []
    by_code = {str(r.get("code")): r for r in courses}
    code = pick(
        "Course",
        list(by_code),
        format_func=lambda c: f"{c} · {by_code[c].get('title', '')}",
        key="student_course",
    )
    section = sections(["Attendance", "Marks"], key="student_course_section")
    if section == "Attendance":
        st.caption(":material/fact_check: " + labels.ATTENDANCE_BASIS_NOTE)
        dataframe(
            [
                {
                    "Date": labels.nice_date(r.get("session_date")),
                    "Topic": r.get("topic"),
                    "Status": labels.status_label(r.get("status")),
                }
                for r in detail.get("attendance", [])
                if str(r.get("code")) == code
            ],
            empty="No attendance has been recorded for this course yet.",
        )
    else:
        dataframe(
            [
                {
                    "Assessment": r.get("assessment"),
                    "Score": f"{r.get('score')} / {r.get('maximum_score')}",
                    "Feedback": r.get("feedback") or "No feedback recorded",
                }
                for r in detail.get("marks", [])
                if str(r.get("code")) == code
            ],
            empty="No marks have been recorded for this course yet.",
        )


def support_page() -> None:
    """Only what the mentor approved, in plain words."""
    context = _student_context()
    if not context:
        return
    _, detail = context
    ui.page_header(
        "My support plan",
        "What your mentor has agreed to help with. These are next steps, not a judgement.",
        eyebrow="Student workspace",
    )
    support = detail.get("support") or []
    followups = detail.get("followups") or []
    if not support and not followups:
        ui.empty_state(
            "Nothing here yet",
            "When your mentor approves support for you, it will appear here.",
        )
        return
    render_support_cards(support, audience="student")
    render_mentor_updates(followups)


def profile_page() -> None:
    context = _student_context()
    if not context:
        return
    actor, detail = context
    student = detail.get("student") or {}
    mentor = detail.get("mentor") or {}
    gpa = detail.get("gpa") or {}
    ui.page_header(
        display_name(student).title() if student else "Profile",
        "Your details as the college has them.",
        eyebrow="Student workspace",
    )
    with ui.card("student_profile"):
        for label, shown in [
            ("Register number", student.get("register_number")),
            ("Semester", student.get("semester")),
            ("Email", student.get("email") or actor.get("email")),
            ("Mentor", mentor.get("name")),
            ("Mentor email", mentor.get("email")),
            (
                "Current CGPA",
                f"{gpa.get('cgpa'):g} on a 10-point scale"
                if gpa.get("cgpa") is not None
                else None,
            ),
        ]:
            if shown not in (None, ""):
                st.markdown(f"**{label}**  \n{ui._md_safe(str(shown))}")
    st.caption(
        ":material/lock: Only you, your parent or guardian and your mentor can see this record."
    )
