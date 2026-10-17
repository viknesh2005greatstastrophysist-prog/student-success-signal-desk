"""The conversation with the student about the AI report (owner decisions, 17 Oct): proof
that the mentor actually talked to the student, not a recheck of the figures.

The clock starts when the AI writes the student's report (the draft reaches the mentor
gate; the Core creates the check-in then). The mentor meets the student within 7 days and
submits the conversation within 14. The mentor's Today lists "Students to meet (N)": one
card per current report without a submitted conversation, saying when to meet and when to
submit; before day 7 it reads "Due in n days", on days 7 to 14 "Meet by now" with the days
overdue, after day 14 "Past the deadline; the department head can see this." Nothing is
sent automatically. "Record the meeting" opens a form (date met, reasons from the fixed
list, note) that sends record-meeting; "Open the draft" opens the report. Students and
parents only ever see the day they met, never the reasons.

The department head's Overview lists "Conversations not submitted (N)", grouped by
mentor, past-deadline students first, with the last reminder sent. For a past-deadline
row "Message the mentor" opens a short form with the standard reminder and an optional
note; sending stores it (send-message). The mentor's Today shows "Messages from the
department head (N)" at the top, each with the student, a "Record the meeting" shortcut
and "Mark as read"; the department head's row then shows "Read <date>".
"""

from __future__ import annotations

from datetime import date
from typing import Any

import streamlit as st

import labels
import ui
from common import dataframe, paged, save_action

STAGE_BADGES = {
    "due": ("blue", ":material/event:"),
    "meet_now": ("orange", ":material/schedule:"),
    "past_deadline": ("red", ":material/event_busy:"),
}


def pending(overview: dict[str, Any]) -> list[dict[str, Any]]:
    """Current AI reports without a submitted conversation, most urgent first (the Core's order)."""
    return [row for row in overview.get("meetings") or [] if not row.get("meeting")]


def card_text(row: dict[str, Any]) -> str:
    """"Asha Rao: AI report on 10 Oct 2026. Meet the student by 17 Oct 2026 and submit the
    conversation by 24 Oct 2026." """
    student = labels.pretty_name(row.get("student_name") or "the student")
    return f"{student}: {labels.meeting_schedule_text(row)}"


def stage_badge(row: dict[str, Any]) -> str:
    """The card's status: "Due in 3 days", "Meet by now (2 days overdue)" or "Past the deadline"."""
    tone, icon = STAGE_BADGES.get(str(row.get("stage")), ("gray", ""))
    return ui.badge_md(labels.meeting_stage_text(row, for_mentor=False), tone, icon)


def _day(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def meeting_payload(
    row: dict[str, Any], met_on: Any, reasons: list[str], note: str
) -> tuple[dict[str, Any] | None, str | None]:
    """The record-meeting command for this AI report, or the plain reason it cannot be sent."""
    if met_on is None:
        return None, "Enter the date you met the student."
    if met_on > labels.college_today():
        return None, "The meeting date cannot be in the future."
    report = _day(row.get("report_on"))
    if report and met_on < report:
        return None, f"The meeting date is before the AI report of {labels.nice_date(row.get('report_on'))}."
    if not reasons:
        return None, "Choose at least one reason the student gave."
    if "Other" in reasons and len(note.strip()) < 3:
        return None, "Add a note saying what the other reason was."
    payload: dict[str, Any] = {
        "action": "record-meeting",
        "studentId": str(row.get("student_id")),
        "supportCaseId": str(row.get("case_id")),
        "metOn": met_on.isoformat(),
        "reasons": [r for r in labels.MEETING_REASONS if r in reasons],
        "note": note.strip(),
    }
    checkin = row.get("checkin") or {}
    if checkin.get("id") and checkin.get("status") != "completed":
        payload["followupId"] = str(checkin["id"])
    return payload, None


def render_meeting_form(row: dict[str, Any], prefix: str = "") -> None:
    """Date met, reasons and a note; saving submits the conversation and completes the
    check-in. `prefix` keeps the widget keys apart when the same report's form is opened
    from a message as well."""
    case_id = f"{prefix}{row.get('case_id')}"
    student = labels.pretty_name(row.get("student_name") or "the student")
    today = labels.college_today()
    report = _day(row.get("report_on"))
    with st.form(f"meeting_form_{case_id}"):
        st.markdown(f"**Meeting with {ui._md_safe(student)}**")
        met_on = st.date_input(
            "Date you met",
            value=today,
            min_value=report if report and report <= today else None,
            max_value=today,
            key=f"meeting_date_{case_id}",
        )
        reasons = st.multiselect(
            "Reasons the student gave",
            labels.MEETING_REASONS,
            key=f"meeting_reasons_{case_id}",
            filter_mode=None,
            help="Choose every reason the student gave. Other needs a note.",
        )
        note = st.text_area("Note", max_chars=3000, key=f"meeting_note_{case_id}")
        st.caption("Staff see the reasons. The student and parent see only the day you met.")
        submitted = st.form_submit_button("Save the meeting record", type="primary")
    if submitted:
        payload, problem = meeting_payload(row, met_on, reasons, note)
        if problem:
            st.error(problem)
        else:
            st.session_state.pop("meeting_form_open", None)
            st.session_state.pop("message_meeting_open", None)
            save_action("experience_command", payload, f"Meeting with {student} recorded.")


def open_report(row: dict[str, Any], role: str = "faculty") -> None:
    """The draft at the gate (Reviews), or for an approved report the student's plans
    (Mentees > the student's profile > Plans and outcomes)."""
    from views.pages import pages_for

    if row.get("case_status") == "awaiting_faculty":
        st.session_state["open_gate_case"] = str(row.get("case_id"))
        target = next((p for p in pages_for(role) if p.url_path == "reviews"), None)
    else:
        st.session_state["mentees_view"] = "Mentees"
        st.session_state["mentee_pick"] = str(row.get("student_id"))
        st.session_state.pop("mentee_pick__search", None)
        st.session_state["profile_section_faculty"] = "Plans and outcomes"
        target = next((p for p in pages_for(role) if p.url_path == "mentees"), None)
    if target is not None:
        st.switch_page(target)


def open_label(row: dict[str, Any]) -> str:
    return "Open the draft" if row.get("case_status") == "awaiting_faculty" else "Open the plan"


def record_shortcut(row: dict[str, Any]) -> None:
    """Opens the meeting form for this report (used by the department head's messages too)."""
    st.session_state["meeting_form_open"] = str(row.get("case_id"))


def render_students_to_meet(overview: dict[str, Any], role: str = "faculty") -> None:
    """Today: one card per current AI report without a submitted conversation."""
    rows = pending(overview)
    ui.section(
        f"Students to meet ({len(rows)})" if rows else "Students to meet",
        "Meet each student within 7 days of their AI report and submit the conversation within 14 days.",
    )
    if not rows:
        ui.empty_state(
            "No students to meet",
            "When the AI writes a report for one of your students, they appear here until you submit the conversation.",
        )
        return
    shown = paged(rows, "today_meetings_page", noun="students to meet")
    open_case = st.session_state.get("meeting_form_open")
    for row in shown:
        case_id = str(row.get("case_id"))
        student = labels.pretty_name(row.get("student_name") or "Student")
        with ui.card(f"meeting_{case_id}"):
            title, status = st.columns([4, 1.6], vertical_alignment="center")
            with title:
                st.markdown(f"**{ui._md_safe(student)}** · {ui._md_safe(str(row.get('register_number') or ''))}")
            with status:
                st.markdown(stage_badge(row))
            ui.plain_text(card_text(row))
            ui.plain_text(labels.meeting_stage_text(row), muted=True)
            record, report = st.columns(2)
            with record:
                if st.button(
                    "Record the meeting",
                    key=f"record_meeting_{case_id}",
                    type="primary",
                    icon=":material/edit_note:",
                    width="stretch",
                ):
                    record_shortcut(row)
                    open_case = case_id
            with report:
                if st.button(
                    open_label(row),
                    key=f"meeting_open_{case_id}",
                    icon=":material/description:",
                    width="stretch",
                ):
                    open_report(row, role)
            if open_case == case_id:
                render_meeting_form(row)


def render_messages_from_head(overview: dict[str, Any]) -> None:
    """Today, at the top: the unread messages from the department head, each with the
    student, a "Record the meeting" shortcut and "Mark as read". Nothing when there are none."""
    unread = [m for m in overview.get("messages") or [] if not m.get("read_at")]
    if not unread:
        return
    ui.section(
        f"Messages from the department head ({len(unread)})",
        "Meet the student and record the conversation, then mark the message as read.",
    )
    waiting = {str(row.get("case_id")): row for row in pending(overview)}
    for message in unread:
        message_id = str(message.get("id"))
        student = labels.pretty_name(message.get("student_name") or "the student")
        with ui.card(f"message_{message_id}"):
            st.markdown(
                f"**{ui._md_safe(labels.pretty_name(message.get('from_name') or 'Department head'))}** · "
                f"{ui._md_safe(labels.college_day(message.get('sent_at')))}"
            )
            ui.plain_text(message.get("body") or "")
            st.caption(f"About {student}")
            row = waiting.get(str(message.get("support_case_id")))
            record, read = st.columns(2)
            with record:
                if row is None:
                    st.caption("The conversation with this student is already submitted.")
                elif st.button(
                    "Record the meeting",
                    key=f"message_record_{message_id}",
                    type="primary",
                    icon=":material/edit_note:",
                    width="stretch",
                ):
                    st.session_state["message_meeting_open"] = message_id
            with read:
                if st.button(
                    "Mark as read",
                    key=f"message_read_{message_id}",
                    icon=":material/done:",
                    width="stretch",
                ):
                    save_action(
                        "experience_command",
                        {"action": "mark-message-read", "messageId": message_id},
                        "Message marked as read.",
                    )
            if row is not None and st.session_state.get("message_meeting_open") == message_id:
                render_meeting_form(row, prefix=f"msg_{message_id}_")


def head_rows(overview: dict[str, Any]) -> list[dict[str, Any]]:
    """Conversations not submitted, grouped by mentor: mentors with the most past-deadline
    students first, and in each group past-deadline students first, then the longest wait."""
    rows = pending(overview)
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(labels.pretty_name(row.get("mentor_name") or "Not assigned"), []).append(row)
    for members in groups.values():
        members.sort(
            key=lambda r: (
                r.get("stage") != "past_deadline",
                -int(r.get("days_since") or 0),
                labels.pretty_name(r.get("student_name") or ""),
            )
        )
    order = sorted(
        groups,
        key=lambda name: (
            -sum(1 for r in groups[name] if r.get("stage") == "past_deadline"),
            -max(int(r.get("days_since") or 0) for r in groups[name]),
            name,
        ),
    )
    return [row for name in order for row in groups[name]]


def render_message_form(row: dict[str, Any]) -> None:
    """The standard reminder and an optional note; sending stores the message (send-message)."""
    case_id = str(row.get("case_id"))
    mentor = labels.pretty_name(row.get("mentor_name") or "the mentor")
    with st.form(f"message_form_{case_id}"):
        st.markdown(f"**Message to {ui._md_safe(mentor)}**")
        ui.plain_text(labels.reminder_text(row))
        note = st.text_area("Add a note (optional)", max_chars=1000, key=f"message_note_{case_id}")
        st.caption("The mentor sees this at the top of their Today page. Nothing is sent automatically.")
        send = st.form_submit_button("Send the message", type="primary", icon=":material/send:")
    if send:
        st.session_state.pop("message_case_open", None)
        save_action(
            "experience_command",
            {"action": "send-message", "supportCaseId": case_id, "note": note.strip()},
            f"Message sent to {mentor}.",
        )


def render_conversations_not_submitted(overview: dict[str, Any]) -> None:
    """The department head's Overview: every current AI report whose conversation is not
    submitted, grouped by mentor, past-deadline students first. A past-deadline row can
    be followed by a message to the mentor; nothing is sent automatically."""
    rows = head_rows(overview)
    late = sum(1 for row in rows if row.get("stage") == "past_deadline")
    ui.section(
        f"Conversations not submitted ({len(rows)})" if rows else "Conversations not submitted",
        "Mentors meet each student within 7 days of the AI report and submit the conversation within 14. "
        + (
            f"{late} {'is' if late == 1 else 'are'} past the deadline; you can message the mentor."
            if late
            else "None is past the deadline."
        ),
    )
    if not rows:
        ui.empty_state("Every conversation is submitted", "Mentors have met every student with a current AI report.")
        return
    page = paged(rows, "head_meetings_page", noun="conversations not submitted")
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in page:
        groups.setdefault(labels.pretty_name(row.get("mentor_name") or "Not assigned"), []).append(row)
    open_case = st.session_state.get("message_case_open")
    for mentor, members in groups.items():
        overdue = sum(1 for r in members if r.get("stage") == "past_deadline")
        st.markdown(
            f"**{ui._md_safe(mentor)}** · {len(members)} not submitted"
            + (f", {overdue} past the deadline" if overdue else "")
        )
        dataframe(
            [
                {
                    "Student": labels.pretty_name(row.get("student_name") or "Student"),
                    "Mentor": mentor,
                    "AI report": labels.nice_date(row.get("report_on")),
                    "Days since": int(row.get("days_since") or 0),
                    "Status": labels.meeting_stage_text(row, for_mentor=False),
                    "Last reminder": labels.reminder_cell(row),
                }
                for row in members
            ]
        )
        for row in members:
            if row.get("stage") != "past_deadline" or not row.get("mentor_id"):
                continue
            case_id = str(row.get("case_id"))
            who, action = st.columns([3, 1.4], vertical_alignment="center")
            with who:
                sent = labels.reminder_cell(row)
                st.caption(
                    f"{labels.pretty_name(row.get('student_name') or 'Student')}: past the deadline, "
                    f"AI report of {labels.nice_date(row.get('report_on'))}. "
                    + ("No reminder sent yet." if sent == "None sent" else f"{sent}.")
                )
            with action:
                if st.button(
                    "Message the mentor",
                    key=f"message_mentor_{case_id}",
                    icon=":material/mail:",
                    width="stretch",
                ):
                    st.session_state["message_case_open"] = case_id
                    open_case = case_id
            if open_case == case_id:
                render_message_form(row)
