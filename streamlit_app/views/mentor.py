from __future__ import annotations

from typing import Any

import pandas as pd
import streamlit as st

import labels
import ui
from common import (
    centred,
    ATTENDANCE_STATES,
    FOLLOWUP_STATES,
    PERCENT_COLUMN,
    dataframe,
    date_value,
    display_name,
    load,
    load_many,
    paged,
    percent,
    person_id,
    pick,
    save_action,
    sections,
    select_id,
    today_local,
)
from views.metrics import render_review_trends
from views.operations import latest_per_student
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
        )
    followups = overview.get("followups") or []
    students = overview.get("students") or []
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
            column_config=centred({
                "Student": st.column_config.TextColumn("Student", disabled=True),
                "Status": st.column_config.SelectboxColumn(
                    "Status", options=ATTENDANCE_STATES, required=True
                ),
            }),
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
            column_config=centred({
                "Student": st.column_config.TextColumn("Student", disabled=True),
                "Score": st.column_config.NumberColumn(
                    "Score", min_value=0.0, max_value=float(maximum_score), step=0.5
                ),
                "Feedback": st.column_config.TextColumn("Feedback", max_chars=500),
            }),
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


def _open_review(draft: dict[str, Any]) -> None:
    """Go to Reviews with this draft already chosen."""
    from views.pages import pages_for

    st.session_state["support_draft"] = draft
    target = next((p for p in pages_for("faculty") if p.url_path == "reviews"), None)
    if target is not None:
        st.switch_page(target)


def _open_plan(plan_id: Any) -> None:
    """Go to Reviews > Start a review with this plan already chosen."""
    from views.pages import pages_for

    st.session_state["open_review_plan"] = str(plan_id)
    target = next((p for p in pages_for("faculty") if p.url_path == "reviews"), None)
    if target is not None:
        st.switch_page(target)


def _needs_decision(review: dict[str, Any]) -> list[dict[str, Any]]:
    """This mentor's reviews that stopped before a draft and wait on the mentor: handed
    over when the checks or the attempts ran out, or no AI model answered. Each
    student's latest review only, so a newer review replaces an older stop."""
    return [
        job
        for job in latest_per_student(review.get("jobs") or [])
        if job.get("status") in ("needs_human", "ai_unavailable")
    ]


def _stop_reason(job: dict[str, Any]) -> str:
    """What stopped a review, in plain words."""
    if job.get("status") == "ai_unavailable":
        return "No AI model answered. Retry the review when one is available."
    code = str(job.get("error_code") or "")
    if code == "REPAIR_BUDGET_EXHAUSTED":
        return "The draft still failed its checks after every repair, so nothing was sent on."
    if code == "LEASE_EXPIRED":
        return "The review stopped part-way three times."
    if code:
        return f"The review stopped after three tries ({labels.issue_label(code).lower()})."
    return "The review stopped after three tries."


def render_needs_decision(review: dict[str, Any]) -> None:
    """Stopped reviews, each opening its plan under Reviews > Start a review."""
    stopped = _needs_decision(review)
    ui.section(
        f"Needs your decision ({len(stopped)})" if stopped else "Needs your decision",
        "Reviews that stopped before a draft. Open one to see why and retry or revise it.",
    )
    if not stopped:
        ui.empty_state(
            "Nothing needs a decision",
            "A review that stops before a draft, for example when no AI model answers, appears here.",
        )
        return
    names = {
        str(s.get("id")): labels.pretty_name(s.get("display_name") or "Student")
        for s in review.get("students") or []
    }
    rows = [
        {
            "title": names.get(str(job.get("student_id")), "Student"),
            "sub": _stop_reason(job),
            "end": labels.nice_time(job.get("updated_at") or job.get("created_at")),
            "action": f"Open the review for {names.get(str(job.get('student_id')), 'this student')}",
        }
        for job in stopped
    ]
    tapped = ui.row_list("needs_decision", rows)
    if tapped is not None:
        _open_plan(stopped[tapped].get("plan_id"))


def _draft_reason(draft: dict[str, Any], risk: dict[str, Any]) -> str:
    """What this draft is about, in plain words: the signals that flagged the student,
    else the plan summary."""
    names = [
        labels.signal_label(sig.get("code")).lower().replace("lms", "LMS")
        for sig in (risk.get("signals") or [])[:3]
        if isinstance(sig, dict)
    ]
    if names:
        return "Flagged for " + ", ".join(names) + "."
    return " ".join(str((draft.get("recommendation") or {}).get("summary") or "").split())


def _risk_status(risk: dict[str, Any] | None) -> tuple[str, str] | None:
    band = (risk or {}).get("band")
    if not band:
        return None
    label, tone, _ = labels.RISK_BANDS.get(str(band), (labels.humanize(band), "gray", ""))
    return label, tone


def today_page() -> None:
    """What needs the mentor today: the next decision, the rest, then check-ins."""
    actor = st.session_state.get("actor") or {}
    overview, queue, review = load_many(
        [("overview", None), ("review_queue", None), ("review_overview", None)]
    )
    ui.page_header(
        "Today",
        f"{ui.greeting()}, {ui.first_name(display_name(actor), 'mentor')}. "
        f"{today_local().strftime('%A %-d %B')}.",
    )
    waiting, risk = _waiting_rows(queue, review)
    if waiting:
        first = waiting[0]
        first_risk = risk.get(str(first.get("student_id")), {})
        if ui.feature_card(
            "next",
            kicker="Next decision",
            title=labels.pretty_name(first.get("display_name")),
            text=_draft_reason(first, first_risk),
            status=_risk_status(first_risk),
            meta=[f"Drafted {labels.nice_time(first.get('drafted_at'))}"],
            action="Review",
        ):
            _open_review(first)
        rest_all = waiting[1:]
        if rest_all:
            ui.section(
                f"Also waiting ({len(rest_all)})",
                f"{len(waiting)} drafts are waiting for you in all, highest risk first.",
            )
            rest = paged(rest_all, "today_waiting_page", noun="more drafts waiting")
            rows = [
                {
                    "title": labels.pretty_name(d.get("display_name")),
                    "sub": _draft_reason(d, risk.get(str(d.get("student_id")), {})),
                    "status": _risk_status(risk.get(str(d.get("student_id")))),
                    "action": f"Review {labels.pretty_name(d.get('display_name'))}",
                }
                for d in rest
            ]
            tapped = ui.row_list("waiting", rows)
            if tapped is not None:
                _open_review(rest[tapped])
    else:
        ui.empty_state(
            "Nothing waiting", "No support drafts need your decision right now."
        )
    render_needs_decision(review)
    today_followups(overview)


@st.fragment
def today_followups(overview: dict[str, Any]) -> None:
    ui.section("Check-ins")
    section = sections(
        ["Upcoming", "Overdue", "Schedule or update"], key="today_section"
    )
    followups = overview.get("followups") or []
    if section == "Schedule or update":
        render_followups(overview, heading=False)
        return
    overdue_only = section == "Overdue"
    shown = [
        r
        for r in followups
        if bool(r.get("overdue")) == overdue_only and r.get("status") != "completed"
    ]
    if not shown:
        ui.empty_state(
            "No overdue follow-ups" if overdue_only else "No check-ins scheduled",
            "" if overdue_only else "Choose Schedule or update to add one.",
        )
        return
    ui.inset_list(
        [
            {
                "title": labels.pretty_name(r.get("student_name")),
                "sub": r.get("note"),
                "status": ("Overdue", "red") if r.get("overdue") else None,
                "end": None
                if r.get("overdue")
                else labels.due_phrase(r.get("due_on")),
            }
            for r in shown
        ]
    )


def mentees_page() -> None:
    """Every mentee, with a profile for the one chosen, plus the cohort Risk view and Outcomes."""
    ui.page_header(
        "Mentees",
        "Open a student for attendance, marks, signals, plans and the source records behind them.",
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
        # The Core scopes the trends to this mentor's students.
        render_review_trends(review)
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
    )
    queue, review = load_many([("review_queue", None), ("review_overview", None)])
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
    awaiting = int(queue.get("awaitingCount", len(queue.get("drafts") or [])))
    # A click on "Mentor gate" in an agent trace opens that student's draft at the gate.
    gate_case = st.session_state.pop("open_gate_case", None)
    if gate_case:
        st.session_state["reviews_section"] = f"Drafts at the gate ({awaiting})"
        match = next(
            (d for d in queue.get("drafts") or [] if str(d.get("id")) == str(gate_case)),
            None,
        )
        if match:
            st.session_state["support_draft"] = match
    # "Needs your decision" on Today lands on Start a review with that plan chosen.
    open_plan = st.session_state.pop("open_review_plan", None)
    if open_plan:
        st.session_state["reviews_section"] = "Start a review"
        st.session_state["review_selected_id"] = open_plan
        st.session_state["review_plan_selector_revision"] = (
            st.session_state.get("review_plan_selector_revision", 0) + 1
        )
    # "Review again with the latest figures" lands on Start a review with the student chosen.
    again = st.session_state.pop("rereview_student", None)
    if again:
        st.session_state["reviews_section"] = "Start a review"
        st.session_state["plan_students"] = [str(again)]
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
