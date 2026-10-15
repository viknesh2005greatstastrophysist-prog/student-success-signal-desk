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
    """Courses as one inset list: title, code and result, attendance on the right."""
    rows = []
    for row in courses:
        attendance = percent(row.get("percentage"))
        published = (
            row.get("result_published") and row.get("result_percentage") is not None
        )
        rows.append(
            {
                "title": row.get("title") or row.get("code") or "Course",
                "sub": f"{row.get('code', '')} · "
                + (
                    f"Result {percent_text(row['result_percentage'])}"
                    if published
                    else "Result not published yet"
                ),
                "bar": attendance,
                "end": "Attendance not recorded" if attendance is None else f"{attendance:g}%",
            }
        )
    ui.inset_list(rows)


def render_mentor_updates(followups: list[dict[str, Any]]) -> None:
    shared = [row for row in followups if row]
    if not shared:
        return
    ui.section("Updates from your mentor", "Check-ins your mentor has shared with you.")
    for index, row in enumerate(shared):
        with ui.card(f"update_{row.get('id', index)}"):
            ui.html_block(
                '<div class="aura-item" style="padding:0">'
                f'<div class="aura-item-main"><div class="aura-item-title">{ui.esc(row.get("mentor_name") or "Your mentor")}</div>'
                f'<div class="aura-item-sub">{ui.esc(labels.nice_date(row.get("due_on")))} · {ui.esc(labels.due_phrase(row.get("due_on")))}</div></div>'
                f'<div class="aura-item-end">{ui.status_html(labels.status_label(row.get("status")), labels.status_tone(row.get("status")))}</div></div>'
            )
            ui.plain_text(row.get("note"))


def render_plan_notice(detail: dict[str, Any]) -> bool:
    """The calm line shown instead of a plan whose evidence predates the current figures
    (the Core only returns plans on the current data generation to students and parents)."""
    notice = detail.get("support_notice")
    if notice:
        ui.insight("Your support plan", str(notice))
    return bool(notice)


def support_status(detail: dict[str, Any]) -> str:
    """The value of the 'Support plan' figure on the overview pages."""
    if detail.get("support"):
        return "Agreed"
    return "Being reviewed" if detail.get("support_notice") else "None yet"


def render_support_cards(support: list[dict[str, Any]], *, audience: str) -> None:
    """The approved support plan as plain, readable text."""
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
            ui.sheet_paragraph(labels.family_summary(plan.get("summary", "Support plan")))
            actions = [a for a in plan.get("actions", []) if isinstance(a, dict)]
            if actions:
                ui.sheet_heading("What happens next")
                ui.inset_list(
                    [
                        {
                            "title": action.get("label", "Next step"),
                            "sub": f"Within {action.get('dueInDays')} days"
                            if action.get("dueInDays") is not None
                            else "",
                        }
                        for action in actions
                    ],
                    flat=True,
                )
            ui.provenance_caption(model_id=item.get("model_id"))
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
    """A greeting, a few figures, the courses, then the support plan."""
    context = _student_context()
    if not context:
        return
    actor, detail = context
    student = detail.get("student") or {}
    name = display_name(student) if student else display_name(actor)
    ui.page_header(
        f"{ui.greeting()}, {ui.first_name(name)}",
        "Here is where your term stands.",
    )
    courses = detail.get("courses") or []
    support = detail.get("support") or []
    attendance_avg = average([percent(row.get("percentage")) for row in courses])
    published = [row for row in courses if row.get("result_published")]
    if courses:
        ui.kpi_row(
            [
                {
                    "label": "Attendance this term",
                    "value": "—" if attendance_avg is None else f"{attendance_avg:g}%",
                },
                {
                    "label": "Results published",
                    "value": f"{len(published)} of {len(courses)}",
                },
                {
                    "label": "Support plan",
                    "value": support_status(detail),
                },
            ]
        )
        ui.section("Your courses")
        render_course_cards(courses)
        st.caption(labels.ATTENDANCE_BASIS_NOTE)
    else:
        ui.empty_state(
            "No courses yet",
            "Your registered courses will appear here once the term begins.",
        )
    if support:
        render_support_cards(support[:1], audience="student")
    else:
        render_plan_notice(detail)


def courses_page() -> None:
    """Attendance and marks, one course at a time."""
    context = _student_context()
    if not context:
        return
    _, detail = context
    ui.page_header(
        "Courses",
        "Attendance and marks for each course this term.",
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
    )
    support = detail.get("support") or []
    followups = detail.get("followups") or []
    if not support and not followups:
        if not render_plan_notice(detail):
            ui.empty_state(
                "Nothing here yet",
                "When your mentor approves support for you, it will appear here.",
            )
        return
    if not support:
        render_plan_notice(detail)
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
    )
    ui.detail_list(
        [
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
        ]
    )
    st.caption(
        "Only you, your parent or guardian and your mentor can see this record."
    )
