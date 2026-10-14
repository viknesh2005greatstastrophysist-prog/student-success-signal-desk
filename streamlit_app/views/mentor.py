from __future__ import annotations

from typing import Any

import pandas as pd
import streamlit as st

import labels
import ui
from common import (
    ATTENDANCE_STATES,
    FOLLOWUP_STATES,
    PERCENT_COLUMN,
    dataframe,
    date_value,
    display_name,
    load,
    load_many,
    percent,
    person_id,
    pick,
    save_action,
    sections,
    select_id,
    today_local,
)
from views.profile import pick_student, render_profile
from views.reviews import (
    render_composite_risk,
    render_draft_reviews,
    render_legacy_drafts,
    render_outcomes,
    render_plan_workbench,
    render_policies,
)


def render_followups(overview: dict[str, Any], *, heading: bool = True) -> None:
    if heading:
        ui.page_header(
            "Mentor follow-ups",
            "Schedule or update a check-in. Every change records a reason.",
            eyebrow="Mentoring",
        )
    followups = overview.get("followups") or []
    students = overview.get("students") or []
    ui.kpi_row(
        [
            {
                "label": "Open check-ins",
                "value": sum(1 for r in followups if r.get("status") != "completed"),
                "icon": ":material/event_note:",
            },
            {
                "label": "Overdue",
                "value": sum(1 for r in followups if r.get("overdue")),
                "icon": ":material/alarm:",
            },
            {
                "label": "Completed",
                "value": sum(1 for r in followups if r.get("status") == "completed"),
                "icon": ":material/task_alt:",
            },
        ]
    )
    ui.section("All follow-ups", icon=":material/list_alt:")
    dataframe(
        [
            {
                "Student": labels.pretty_name(r.get("student_name")),
                "Due": labels.nice_date(r.get("due_on")),
                "When": "Overdue"
                if r.get("overdue")
                else labels.due_phrase(r.get("due_on")),
                "Note": r.get("note"),
                "Status": labels.status_label(r.get("status")),
                "Outcome": r.get("outcome") or "Not recorded",
            }
            for r in followups
        ],
        empty="No follow-ups yet. Create the first one below.",
    )
    ui.section("Create or update a check-in", icon=":material/edit_calendar:")
    student_by_id = {person_id(row): row for row in students}
    choices: list[dict[str, Any] | None] = [None, *followups]
    selected = pick(
        "Follow-up to edit",
        choices,
        format_func=lambda row: (
            "Create a follow-up"
            if row is None
            else f"{labels.pretty_name(row.get('student_name', 'Student'))} · due {labels.nice_date(row.get('due_on'))}"
        ),
        key="followup_choice",
    )
    with st.form("followup_editor"):
        if selected:
            chosen_student = str(selected.get("student_id", ""))
            st.text_input(
                "Student",
                value=labels.pretty_name(selected.get("student_name", "")),
                disabled=True,
            )
        else:
            chosen_student = (
                select_id(
                    "Student", students, person_id, display_name, key="followup_student"
                )
                or ""
            )
        due_on = st.date_input(
            "Due date",
            value=date_value(selected.get("due_on") if selected else today_local()),
        )
        note = st.text_area(
            "Follow-up note",
            value=str(selected.get("note", "") if selected else ""),
            max_chars=3000,
        )
        shared = st.checkbox(
            "Share this update with the student and parent",
            value=bool(selected.get("shared", False) if selected else False),
        )
        status = pick(
            "Status",
            FOLLOWUP_STATES,
            index=FOLLOWUP_STATES.index(selected.get("status"))
            if selected and selected.get("status") in FOLLOWUP_STATES
            else 0,
            format_func=labels.status_label,
        )
        outcome = st.text_area(
            "Outcome",
            value=str(selected.get("outcome", "") if selected else ""),
            max_chars=3000,
            help="Required before marking a follow-up complete.",
        )
        reason = st.text_input("Reason for this change", max_chars=1000)
        submitted = st.form_submit_button("Save follow-up", type="primary")
    if submitted:
        if not chosen_student or chosen_student not in student_by_id:
            st.error("Choose a student in your current scope.")
        elif len(note.strip()) < 5 or len(reason.strip()) < 5:
            st.error(
                "Enter a follow-up note and a reason with at least five characters."
            )
        elif status == "completed" and len(outcome.strip()) < 5:
            st.error("Record the outcome before completing this follow-up.")
        else:
            payload: dict[str, Any] = {
                "studentId": chosen_student,
                "dueOn": due_on.isoformat(),
                "note": note.strip(),
                "shared": shared,
                "status": status,
                "outcome": outcome.strip(),
                "reason": reason.strip(),
            }
            if selected:
                payload.update(
                    {
                        "id": selected["id"],
                        "expectedRevision": int(selected["revision"]),
                    }
                )
            save_action(
                "experience_command",
                {"action": "save-followup", **payload},
                "Follow-up saved.",
            )


def render_classroom(overview: dict[str, Any]) -> None:
    ui.page_header(
        "Classroom",
        "Take attendance, record assessment marks and check published results.",
        eyebrow="Teaching",
    )
    classroom_body(overview)


@st.fragment
def classroom_body(overview: dict[str, Any]) -> None:
    """The course picker and its sections: a click reruns only this block."""
    courses = overview.get("courses") or []
    offering_id = select_id(
        "Course",
        courses,
        lambda row: str(row.get("id", "")),
        lambda row: (
            f"{row.get('code', '')} · {row.get('title', '')} · {row.get('section', '')}"
        ),
        key="classroom_course",
    )
    if not offering_id:
        ui.empty_state(
            "No courses in your scope",
            "Assigned courses will appear here.",
        )
        return
    classroom = load("classroom", {"offeringId": offering_id})
    course = classroom.get("course") or {}
    roster = classroom.get("roster") or []
    sessions = classroom.get("sessions") or []
    assessments = classroom.get("assessments") or []
    is_mentor = (overview.get("actor") or {}).get("role") == "faculty"
    mentees = {str(r.get("id")) for r in overview.get("students") or []}
    ui.kpi_row(
        [
            {
                "label": "Course roster",
                "value": len(roster),
                "icon": ":material/groups:",
                "help": "Everyone registered in this course, because attendance and marks are recorded per course.",
            },
            *(
                [
                    {
                        "label": "Your mentees in it",
                        "value": sum(1 for r in roster if str(r.get("id")) in mentees),
                        "icon": ":material/school:",
                    }
                ]
                if is_mentor
                else []
            ),
            {
                "label": "Sessions recorded",
                "value": len(sessions),
                "icon": ":material/event_available:",
            },
            {
                "label": "Assessments",
                "value": len(assessments),
                "icon": ":material/grading:",
            },
        ]
    )
    st.subheader(f"{course.get('code', '')} · {course.get('title', '')}", anchor=False)
    if not roster:
        ui.empty_state(
            "The roster is empty",
            "Registered students will appear here.",
        )
        return
    section = sections(
        ["Attendance", "Marks", "Results"], key=f"classroom_section_{offering_id}"
    )
    if section == "Attendance":
        render_attendance_editor(offering_id, roster, sessions)
    elif section == "Marks":
        render_marks_editor(offering_id, roster, assessments)
    else:
        results = classroom.get("results") or []
        names = {person_id(student): display_name(student) for student in roster}
        dataframe(
            [
                {
                    "Student": names.get(row.get("student_id"), "Student"),
                    "Result": percent(row.get("percentage")),
                    "Published": "Yes" if row.get("published") else "No",
                }
                for row in results
            ],
            empty="No results have been calculated for this course yet.",
            column_config={
                "Result": st.column_config.ProgressColumn("Result", **PERCENT_COLUMN)
            },
        )


def render_attendance_editor(
    offering_id: str, roster: list[dict[str, Any]], sessions: list[dict[str, Any]]
) -> None:
    session_options: list[dict[str, Any] | None] = [None, *sessions]
    selected_session = pick(
        "Attendance session",
        session_options,
        format_func=lambda row: (
            "New session"
            if row is None
            else f"{labels.nice_date(row.get('session_date'))} · {row.get('topic')}"
        ),
        key=f"session_{offering_id}",
    )
    prior_records = {
        r.get("student_id"): r.get("status", "present")
        for r in (selected_session or {}).get("records", [])
    }
    attendance_rows = [
        {
            "Student": display_name(student),
            "Status": prior_records.get(person_id(student), "present"),
        }
        for student in roster
    ]
    with st.form(
        f"attendance_{offering_id}_{(selected_session or {}).get('id', 'new')}"
    ):
        session_date = st.date_input(
            "Session date",
            value=date_value(
                selected_session.get("session_date")
                if selected_session
                else today_local()
            ),
        )
        topic = st.text_input(
            "Session topic",
            value=str(selected_session.get("topic", "") if selected_session else ""),
            max_chars=160,
        )
        edited_attendance = st.data_editor(
            pd.DataFrame(attendance_rows),
            column_config={
                "Student": st.column_config.TextColumn("Student", disabled=True),
                "Status": st.column_config.SelectboxColumn(
                    "Status", options=ATTENDANCE_STATES, required=True
                ),
            },
            disabled=["Student"],
            hide_index=True,
            num_rows="fixed",
            width="stretch",
            key=f"attendance_table_{offering_id}_{(selected_session or {}).get('id', 'new')}_{(selected_session or {}).get('revision', 0)}",
        )
        reason = st.text_input("Reason for recording attendance", max_chars=1000)
        submitted = st.form_submit_button("Save attendance", type="primary")
    if submitted:
        if len(topic.strip()) < 3 or len(reason.strip()) < 5:
            st.error("Enter a session topic and a reason of at least five characters.")
        else:
            records = [
                {"studentId": person_id(roster[int(index)]), "status": row["Status"]}
                for index, row in edited_attendance.iterrows()
            ]
            payload: dict[str, Any] = {
                "action": "save-attendance",
                "offeringId": offering_id,
                "sessionDate": session_date.isoformat(),
                "topic": topic.strip(),
                "records": records,
                "reason": reason.strip(),
            }
            if selected_session:
                payload.update(
                    {
                        "id": selected_session["id"],
                        "expectedRevision": int(selected_session["revision"]),
                    }
                )
            save_action("experience_command", payload, "Attendance saved.")


def render_marks_editor(
    offering_id: str, roster: list[dict[str, Any]], assessments: list[dict[str, Any]]
) -> None:
    assessment_options: list[dict[str, Any] | None] = [None, *assessments]
    selected_assessment = pick(
        "Assessment",
        assessment_options,
        format_func=lambda row: (
            "New assessment" if row is None else str(row.get("title", "Assessment"))
        ),
        key=f"assessment_{offering_id}",
    )
    prior_marks = {
        m.get("student_id"): m for m in (selected_assessment or {}).get("marks", [])
    }
    marks_rows = [
        {
            "Student": display_name(student),
            "Score": float(
                prior_marks.get(person_id(student), {}).get("score", 0) or 0
            ),
            "Feedback": str(
                prior_marks.get(person_id(student), {}).get("feedback", "") or ""
            ),
        }
        for student in roster
    ]
    with st.form(f"marks_{offering_id}_{(selected_assessment or {}).get('id', 'new')}"):
        title = st.text_input(
            "Assessment title",
            value=str(
                selected_assessment.get("title", "") if selected_assessment else ""
            ),
            max_chars=160,
        )
        maximum_score = st.number_input(
            "Maximum score",
            min_value=0.01,
            max_value=1000.0,
            value=float(
                selected_assessment.get("maximum_score", 100)
                if selected_assessment
                else 100
            ),
            step=1.0,
        )
        weight_percent = st.number_input(
            "Weight in course (%)",
            min_value=0.0,
            max_value=100.0,
            value=float(
                selected_assessment.get("weight_percent", 0)
                if selected_assessment
                else 0
            ),
            step=1.0,
        )
        edited_marks = st.data_editor(
            pd.DataFrame(marks_rows),
            column_config={
                "Student": st.column_config.TextColumn("Student", disabled=True),
                "Score": st.column_config.NumberColumn(
                    "Score", min_value=0.0, max_value=float(maximum_score), step=0.5
                ),
                "Feedback": st.column_config.TextColumn("Feedback", max_chars=500),
            },
            disabled=["Student"],
            hide_index=True,
            num_rows="fixed",
            width="stretch",
            key=f"marks_table_{offering_id}_{(selected_assessment or {}).get('id', 'new')}_{(selected_assessment or {}).get('revision', 0)}",
        )
        reason = st.text_input("Reason for recording marks", max_chars=1000)
        submitted = st.form_submit_button("Save marks", type="primary")
    if submitted:
        if len(title.strip()) < 3 or len(reason.strip()) < 5:
            st.error(
                "Enter an assessment title and a reason of at least five characters."
            )
        else:
            marks = [
                {
                    "studentId": person_id(roster[int(index)]),
                    "score": float(row["Score"]),
                    "feedback": str(row["Feedback"] or "")[:500],
                }
                for index, row in edited_marks.iterrows()
            ]
            payload = {
                "action": "save-marks",
                "offeringId": offering_id,
                "title": title.strip(),
                "maximumScore": float(maximum_score),
                "weightPercent": float(weight_percent),
                "marks": marks,
                "reason": reason.strip(),
            }
            if selected_assessment:
                payload.update(
                    {
                        "id": selected_assessment["id"],
                        "expectedRevision": int(selected_assessment["revision"]),
                    }
                )
            save_action("experience_command", payload, "Marks saved.")


def _waiting_rows(
    queue: dict[str, Any], review: dict[str, Any]
) -> list[dict[str, Any]]:
    """Drafts at the gate, highest risk first, then the longest waiting."""
    risk = {
        str(r.get("studentId")): r
        for r in review.get("riskView") or []
        if r.get("latest", True)
    }
    drafts = queue.get("drafts") or []
    return sorted(
        drafts,
        key=lambda d: (
            -(risk.get(str(d.get("student_id")), {}).get("score") or 0),
            str(d.get("drafted_at") or ""),
        ),
    ), risk


def today_page() -> None:
    """What needs the mentor today: decisions at the gate, then check-ins."""
    actor = st.session_state.get("actor") or {}
    overview, queue, review = load_many(
        [("overview", None), ("review_queue", None), ("review_overview", None)]
    )
    ui.page_header(
        f"Today, {display_name(actor).split()[0] if display_name(actor) else 'mentor'}",
        "Decisions waiting for you, then your check-ins and overdue follow-ups.",
        eyebrow="Mentor workspace",
    )
    followups = overview.get("followups") or []
    awaiting = int(queue.get("awaitingCount", len(queue.get("drafts") or [])))
    ui.kpi_row(
        [
            {
                "label": "Decisions waiting",
                "value": awaiting,
                "icon": ":material/front_hand:",
                "signal": True,
            },
            {
                "label": "Assigned students",
                "value": len(overview.get("students") or []),
                "icon": ":material/groups:",
            },
            {
                "label": "Check-ins ahead",
                "value": sum(
                    1
                    for r in followups
                    if r.get("status") != "completed" and not r.get("overdue")
                ),
                "icon": ":material/event_note:",
            },
            {
                "label": "Overdue follow-ups",
                "value": sum(1 for r in followups if r.get("overdue")),
                "icon": ":material/alarm:",
            },
        ]
    )
    waiting, risk = _waiting_rows(queue, review)
    if awaiting:
        ui.gate_banner(
            f"{awaiting} support draft{'s are' if awaiting != 1 else ' is'} waiting at the mentor gate. "
            "Open Reviews to approve, edit or decline them.",
            title="Needs you today",
        )
        ui.section("Decisions waiting", "Highest risk first, then the longest waiting.")
        dataframe(
            [
                {
                    "Student": labels.pretty_name(d.get("display_name")),
                    "Register number": d.get("register_number"),
                    "Risk": (
                        f"{labels.risk_label(risk[str(d.get('student_id'))].get('band'))} · "
                        f"{risk[str(d.get('student_id'))].get('score')}"
                        if str(d.get("student_id")) in risk
                        else "Not scored"
                    ),
                    "Drafted": labels.nice_time(d.get("drafted_at")),
                }
                for d in waiting[:8]
            ]
        )
        if len(waiting) > 8:
            st.caption(
                f"Showing the first 8 of {len(waiting)}. The rest are in Reviews."
            )
    else:
        ui.empty_state(
            "Nothing waiting", "No support drafts need your decision right now."
        )
    today_followups(overview)


@st.fragment
def today_followups(overview: dict[str, Any]) -> None:
    section = sections(
        ["Upcoming check-ins", "Overdue", "Schedule or update"], key="today_section"
    )
    followups = overview.get("followups") or []
    if section == "Schedule or update":
        render_followups(overview, heading=False)
        return
    overdue_only = section == "Overdue"
    dataframe(
        [
            {
                "Student": labels.pretty_name(r.get("student_name")),
                "Due": labels.nice_date(r.get("due_on")),
                "When": "Overdue"
                if r.get("overdue")
                else labels.due_phrase(r.get("due_on")),
                "Note": r.get("note"),
                "Status": labels.status_label(r.get("status")),
            }
            for r in followups
            if bool(r.get("overdue")) == overdue_only and r.get("status") != "completed"
        ],
        empty="No overdue follow-ups." if overdue_only else "No check-ins scheduled.",
    )


def mentees_page() -> None:
    """Every mentee, with a profile for the one chosen, plus the cohort Risk view and Outcomes."""
    ui.page_header(
        "Mentees",
        "Open a student for attendance, marks, signals, plans and the source records behind them.",
        eyebrow="Mentor workspace",
    )
    mentees_body()


@st.fragment
def mentees_body() -> None:
    overview, queue, review = load_many(
        [("overview", None), ("review_queue", None), ("review_overview", None)]
    )
    actor = st.session_state.get("actor") or {}
    view = sections(["Mentees", "Risk view", "Outcomes"], key="mentees_view")
    if view == "Risk view":
        render_composite_risk(review, actor)
        return
    if view == "Outcomes":
        render_outcomes(queue, actor)
        return
    students = overview.get("students") or []
    if not students:
        ui.empty_state("No mentees yet", "Assigned students will appear here.")
        return
    student_id = pick_student(students, label="Mentee", key="mentee_pick")
    if student_id:
        render_profile(student_id, "faculty")


def reviews_page() -> None:
    """Drafts at the gate, a way to start a review, and the policies behind them."""
    actor = st.session_state.get("actor") or {}
    ui.page_header(
        "Reviews",
        "AI agents gather evidence, score risk and draft support. You decide what reaches a student.",
        eyebrow="Mentor workspace",
    )
    queue, review = load_many([("review_queue", None), ("review_overview", None)])
    risk_rows = review.get("riskView") or []
    drafts = queue.get("drafts") or []
    awaiting = int(queue.get("awaitingCount", len(drafts)))
    ui.kpi_row(
        [
            {
                "label": "Awaiting your decision",
                "value": awaiting,
                "icon": ":material/front_hand:",
                "signal": True,
            },
            {
                "label": "Flagged students",
                "value": sum(
                    1 for r in risk_rows if r.get("flagged") and r.get("latest", True)
                ),
                "icon": ":material/flag:",
            },
            {
                "label": "Approved plans",
                "value": len(queue.get("plans") or []),
                "icon": ":material/verified:",
            },
            {
                "label": "AI model",
                "value": "Connected"
                if review.get("modelConfigured")
                else "Not connected",
                "icon": ":material/smart_toy:",
            },
        ]
    )
    reviews_body(actor)


@st.fragment
def reviews_body(actor: dict[str, Any]) -> None:
    queue, review = load_many([("review_queue", None), ("review_overview", None)])
    risk_by_student = {str(r.get("studentId")): r for r in review.get("riskView") or []}
    awaiting = int(queue.get("awaitingCount", len(queue.get("drafts") or [])))
    section = sections(
        [f"Drafts at the gate ({awaiting})", "Start a review", "Policies"],
        key="reviews_section",
    )
    if section.startswith("Drafts"):
        render_draft_reviews(queue, actor, risk_by_student)
        render_legacy_drafts(queue, actor)
    elif section == "Start a review":
        render_plan_workbench(review, actor)
    else:
        render_policies(review, actor)


def classroom_page() -> None:
    render_classroom(load("overview"))
