"""Meeting records after a support plan (owner request, 17 Oct): proof that the mentor
spoke to the student, not a recheck of the figures.

Every approved plan gets one check-in (the Core creates it with the approval). The
mentor's Today lists each approved current plan still waiting for its meeting record,
with a form for the day they met, the reasons the student gave (a fixed list), a note
and what was agreed. Once a meeting is seven days overdue the card says the department
head can now see it; the department head's Overview lists every pending meeting,
overdue first. Students and parents only ever see the day they met, never the reasons.
"""

from __future__ import annotations

from typing import Any

import streamlit as st

import labels
import ui
from common import dataframe, paged, save_action


def pending(overview: dict[str, Any]) -> list[dict[str, Any]]:
    """Approved current plans without a meeting record, most overdue first (the Core's order)."""
    return [row for row in overview.get("meetings") or [] if not row.get("meeting")]


def card_text(row: dict[str, Any]) -> str:
    student = labels.pretty_name(row.get("student_name") or "the student")
    text = (
        f"Check-in with {student} {labels.meeting_due_text(row.get('due_on'), row.get('days_overdue'))}. "
        "Record when you met and the reasons the student gave."
    )
    if row.get("head_notice"):
        text += " Now visible to the department head."
    return text


def meeting_payload(
    row: dict[str, Any], met_on: Any, reasons: list[str], note: str, agreed: str
) -> tuple[dict[str, Any] | None, str | None]:
    """The record-meeting command for this plan, or the plain reason it cannot be sent."""
    if met_on is None:
        return None, "Enter the date you met the student."
    if met_on > labels.college_today():
        return None, "The meeting date cannot be in the future."
    if not reasons:
        return None, "Choose at least one reason the student gave."
    if "Other" in reasons and len(note.strip()) < 3:
        return None, "Add a note saying what the other reason was."
    payload: dict[str, Any] = {
        "action": "record-meeting",
        "studentId": str(row.get("student_id")),
        "supportPlanId": str(row.get("plan_id")),
        "metOn": met_on.isoformat(),
        "reasons": [r for r in labels.MEETING_REASONS if r in reasons],
        "note": note.strip(),
        "agreedNextStep": agreed.strip(),
    }
    checkin = row.get("checkin") or {}
    if checkin.get("id") and checkin.get("status") != "completed":
        payload["followupId"] = str(checkin["id"])
    return payload, None


def render_meeting_form(row: dict[str, Any]) -> None:
    """Date met, reasons, note and what was agreed; saving records the meeting and
    completes the check-in."""
    plan_id = str(row.get("plan_id"))
    student = labels.pretty_name(row.get("student_name") or "the student")
    today = labels.college_today()
    with st.form(f"meeting_form_{plan_id}"):
        st.markdown(f"**Meeting with {ui._md_safe(student)}**")
        met_on = st.date_input("Date you met", value=today, max_value=today, key=f"meeting_date_{plan_id}")
        reasons = st.multiselect(
            "Reasons the student gave",
            labels.MEETING_REASONS,
            key=f"meeting_reasons_{plan_id}",
            filter_mode=None,
            help="Choose every reason the student gave. Other needs a note.",
        )
        note = st.text_area("Note", max_chars=3000, key=f"meeting_note_{plan_id}")
        agreed = st.text_area("What was agreed", max_chars=1000, key=f"meeting_agreed_{plan_id}")
        st.caption(
            "Staff see the reasons. The student and parent see only the day you met."
        )
        submitted = st.form_submit_button("Save the meeting record", type="primary")
    if submitted:
        payload, problem = meeting_payload(row, met_on, reasons, note, agreed)
        if problem:
            st.error(problem)
        else:
            st.session_state.pop("meeting_form_open", None)
            save_action("experience_command", payload, f"Meeting with {student} recorded.")


def _review_again(student_id: str, role: str) -> None:
    from views.pages import pages_for

    st.session_state["rereview_student"] = student_id
    target = next((p for p in pages_for(role) if p.url_path == "reviews"), None)
    if target is not None:
        st.switch_page(target)


def render_meetings_to_record(overview: dict[str, Any], role: str = "faculty") -> None:
    """Today: one card per approved current plan without a meeting record."""
    rows = pending(overview)
    ui.section(
        f"Meetings to record ({len(rows)})" if rows else "Meetings to record",
        "After each approved plan, meet the student and record it here.",
    )
    if not rows:
        ui.empty_state(
            "No meetings to record",
            "When a support plan is approved, its check-in appears here until you record the meeting.",
        )
        return
    shown = paged(rows, "today_meetings_page", noun="meetings to record")
    open_plan = st.session_state.get("meeting_form_open")
    for row in shown:
        plan_id = str(row.get("plan_id"))
        student = labels.pretty_name(row.get("student_name") or "Student")
        with ui.card(f"meeting_{plan_id}"):
            title, status = st.columns([4, 1.4], vertical_alignment="center")
            with title:
                st.markdown(f"**{ui._md_safe(student)}** · {ui._md_safe(str(row.get('register_number') or ''))}")
            with status:
                if (row.get("days_overdue") or 0) > 0:
                    st.markdown(ui.badge_md("Overdue", "red", ":material/schedule:"))
            ui.plain_text(card_text(row))
            record, again = st.columns(2)
            with record:
                if st.button(
                    "Record the meeting",
                    key=f"record_meeting_{plan_id}",
                    type="primary",
                    icon=":material/edit_note:",
                    width="stretch",
                ):
                    st.session_state["meeting_form_open"] = plan_id
                    open_plan = plan_id
            with again:
                if st.button(
                    "Review again with the latest figures",
                    key=f"meeting_rereview_{plan_id}",
                    icon=":material/refresh:",
                    width="stretch",
                ):
                    _review_again(str(row.get("student_id")), role)
            if open_plan == plan_id:
                render_meeting_form(row)


def render_meetings_pending_head(overview: dict[str, Any]) -> None:
    """The department head's Overview: every approved current plan still waiting for its
    meeting record, overdue first."""
    rows = pending(overview)
    week = sum(1 for row in rows if row.get("head_notice"))
    ui.section(
        f"Meetings pending ({len(rows)})" if rows else "Meetings pending",
        "Approved plans whose meeting with the student is not recorded yet, most overdue first. "
        + (
            f"{week} {'is' if week == 1 else 'are'} overdue by more than a week."
            if week
            else "None is overdue by more than a week."
        ),
    )
    if not rows:
        ui.empty_state("No meetings pending", "Every approved plan has its meeting recorded.")
        return
    page = paged(rows, "head_meetings_page", noun="meetings pending")
    dataframe(
        [
            {
                "Student": labels.pretty_name(row.get("student_name") or "Student"),
                "Register number": row.get("register_number") or "Not listed",
                "Mentor": labels.pretty_name(row.get("mentor_name") or "Not assigned"),
                "Due": labels.nice_date(row.get("due_on")),
                "Where it stands": labels.meeting_standing(row.get("days_overdue")),
            }
            for row in page
        ]
    )
