from __future__ import annotations

import base64
import json
import subprocess
from datetime import date, datetime, timedelta
from typing import Any

import pandas as pd
import streamlit as st
from bridge import BridgeError, get_client

st.set_page_config(
    page_title="AURA | Student Success",
    page_icon="A",
    layout="wide",
    initial_sidebar_state="expanded",
)

PORTALS = {
    "student": "Student",
    "parent": "Parent",
    "faculty": "Faculty",
    "hod": "Department head",
    "governance": "Governance",
    "lms": "Learning workspace",
}
PORTAL_ROLES = {
    "student": {"student"},
    "parent": {"parent"},
    "faculty": {"faculty"},
    "hod": {"hod"},
    "governance": {"governance", "hod"},
    "lms": {"student", "faculty", "hod"},
}
ATTENDANCE_STATES = ["present", "absent", "late", "excused"]
FOLLOWUP_STATES = ["planned", "in_progress", "completed"]
PLAN_DOMAINS = ["academic", "attendance", "wellbeing-referral"]
ACTION_OWNER_LABELS = {"assigned_faculty": "Assigned faculty", "student": "Student"}


def today_local() -> date:
    return datetime.now().astimezone().date()


def value(row: Any, *names: str, default: Any = None) -> Any:
    if not isinstance(row, dict):
        return default
    for name in names:
        if name in row:
            return row[name]
    return default


def display_name(person: dict[str, Any]) -> str:
    return str(
        value(person, "name", "display_name", "displayName", default="Unnamed record")
    )


def person_id(person: dict[str, Any]) -> str:
    return str(value(person, "id", "student_id", "studentId", default=""))


def date_value(raw: Any) -> date:
    try:
        return date.fromisoformat(str(raw)[:10])
    except (TypeError, ValueError):
        return today_local()


def money(paise: Any) -> str:
    try:
        return f"₹{int(paise) / 100:,.2f}"
    except (TypeError, ValueError):
        return "Not recorded"


def short_time(raw: Any) -> str:
    try:
        return (
            datetime.fromisoformat(str(raw)).astimezone().strftime("%d %b %Y, %I:%M %p")
        )
    except (TypeError, ValueError):
        return str(raw or "Not recorded")


def request(action: str, data: dict[str, Any] | None = None) -> Any:
    token = st.session_state.get("token")
    if not token:
        raise BridgeError("Sign in to continue.", "UNAUTHENTICATED", 401)
    return get_client().request(action, data=data or {}, token=token)


def load(action: str, data: dict[str, Any] | None = None) -> Any:
    try:
        with st.spinner("Loading your workspace…"):
            return request(action, data)
    except BridgeError as error:
        if error.status == 401:
            st.session_state.pop("token", None)
            st.session_state.pop("actor", None)
            st.session_state.pop("success_notice", None)
            st.warning("Your session has ended. Sign in again to continue.")
        else:
            st.error(str(error))
        st.stop()


def save_action(action: str, data: dict[str, Any], success: str) -> Any | None:
    try:
        with st.spinner("Saving your changes…"):
            result = request(action, data)
        if action == "replay":
            st.success(success)
            return result
        if action == "plan_save":
            st.session_state.pop("review_plan", None)
        st.session_state["success_notice"] = success
        st.rerun()
        return result
    except BridgeError as error:
        if error.status == 401:
            st.session_state.pop("token", None)
            st.session_state.pop("actor", None)
            st.session_state.pop("success_notice", None)
            st.warning("Your session has ended. Sign in again to continue.")
        else:
            st.error(str(error))
        return None


def attachment_payload(uploaded: Any) -> tuple[dict[str, str] | None, str | None]:
    if uploaded is None:
        return None, None
    if uploaded.size < 1:
        return None, "Choose a file with at least one byte."
    if uploaded.size > 2 * 1024 * 1024:
        return None, "Files must be 2 MB or smaller."
    if len(uploaded.name) > 100 or not all(
        character.isalnum() or character in " ._()-" for character in uploaded.name
    ):
        return (
            None,
            "Use a file name with letters, numbers, spaces, dots, brackets, underscores, or hyphens.",
        )
    return {
        "name": uploaded.name,
        "data": base64.b64encode(uploaded.getvalue()).decode("ascii"),
    }, None


def login_view() -> None:
    st.title("AURA")
    st.subheader("Sign in to your workspace")
    st.write(
        "Use your college account to open the records and tools available to your role."
    )
    with st.form("sign_in", clear_on_submit=True):
        portal = st.selectbox(
            "Workspace", list(PORTALS), format_func=lambda key: PORTALS[key]
        )
        email = st.text_input("Email", autocomplete="email")
        password = st.text_input(
            "Password", type="password", autocomplete="current-password"
        )
        submitted = st.form_submit_button("Sign in", type="primary")
    if submitted:
        if not email.strip() or not password:
            st.error("Enter your email and password.")
            return
        try:
            with st.spinner("Signing in…"):
                result = get_client().login(email.strip(), password, portal)
        except BridgeError as error:
            st.error(str(error))
            return
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            st.error(
                "The workspace could not start. Check its private runtime configuration and try again."
            )
            return
        actor = result.get("actor") or {}
        role = value(actor, "role")
        if role not in PORTAL_ROLES[portal]:
            try:
                get_client().logout(result["token"])
            except BridgeError:
                st.caption("The temporary session could not be closed automatically.")
            st.error("This account cannot enter the selected workspace.")
            return
        # Keep only the opaque session token and the authenticated actor in session state.
        st.session_state.pop("success_notice", None)
        st.session_state["token"] = result["token"]
        st.session_state["actor"] = {**actor, "portal": portal}
        st.rerun()


def sign_out() -> None:
    token = st.session_state.get("token")
    if token:
        try:
            get_client().logout(token)
        except BridgeError:
            pass
    st.session_state.clear()
    st.rerun()


def select_id(
    label: str, rows: list[dict[str, Any]], id_getter, label_getter, *, key: str
) -> str | None:
    available = [row for row in rows if id_getter(row)]
    if not available:
        return None
    ids = [id_getter(row) for row in available]
    labels = {id_getter(row): label_getter(row) for row in available}
    return st.selectbox(
        label, ids, format_func=lambda item: labels.get(item, item), key=key
    )


def dataframe(
    rows: list[dict[str, Any]],
    *,
    empty: str = "No records to show.",
    key: str | None = None,
) -> None:
    if not rows:
        st.caption(empty)
        return
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch", key=key)


def sign_in_sidebar(actor: dict[str, Any]) -> None:
    st.sidebar.title("AURA")
    st.sidebar.caption(PORTALS.get(actor.get("portal"), "Workspace"))
    st.sidebar.write(display_name(actor))
    st.sidebar.caption(str(actor.get("email", "")))
    if st.sidebar.button("Sign out", use_container_width=True):
        sign_out()


def render_student_home(detail: dict[str, Any], actor: dict[str, Any]) -> None:
    student = detail.get("student") or {}
    st.title(f"Welcome, {display_name(student) if student else display_name(actor)}")
    st.write("Your courses, progress and support records are available here.")
    courses = detail.get("courses") or []
    marks = detail.get("marks") or []
    attendance = detail.get("attendance") or []
    invoices = detail.get("invoices") or []
    outstanding_paise = sum(
        max(
            0,
            int(invoice.get("amount_paise") or 0) - int(invoice.get("paid_paise") or 0),
        )
        for invoice in invoices
    )
    cols = st.columns(4)
    cols[0].metric("Courses", len(courses))
    cols[1].metric("Attendance records", len(attendance))
    cols[2].metric("Marks recorded", len(marks))
    cols[3].metric("Outstanding fees", money(outstanding_paise))
    if courses:
        st.subheader("Current courses")
        dataframe(
            [
                {
                    "Course": f"{row.get('code', '')} · {row.get('title', '')}",
                    "Attendance": f"{row['percentage']}%"
                    if row.get("percentage") is not None
                    else "Not recorded",
                    "Result": f"{row['result_percentage']}%"
                    if row.get("result_published")
                    and row.get("result_percentage") is not None
                    else "Not published",
                }
                for row in courses
            ]
        )
    followups = detail.get("followups") or []
    if followups:
        st.subheader("Mentor updates")
        dataframe(
            [
                {
                    "Due": row.get("due_on"),
                    "Mentor": row.get("mentor_name"),
                    "Update": row.get("note"),
                    "Status": row.get("status"),
                }
                for row in followups
            ]
        )


def render_academic_records(detail: dict[str, Any]) -> None:
    st.title("Academic records")
    st.caption("Records and results currently available to your account.")
    courses = detail.get("courses") or []
    if courses:
        st.subheader("Course progress")
        dataframe(
            [
                {
                    "Course": f"{r.get('code', '')} · {r.get('title', '')}",
                    "Term": r.get("term_name"),
                    "Registered": r.get("registration_status"),
                    "Present": r.get("present"),
                    "Absent": r.get("absent"),
                    "Attendance": f"{r['percentage']}%"
                    if r.get("percentage") is not None
                    else "Not recorded",
                    "Result": f"{r['result_percentage']}%"
                    if r.get("result_published")
                    and r.get("result_percentage") is not None
                    else "Not published",
                }
                for r in courses
            ]
        )
    st.subheader("Attendance")
    dataframe(
        [
            {
                "Date": r.get("session_date"),
                "Course": r.get("code"),
                "Topic": r.get("topic"),
                "Status": r.get("status"),
            }
            for r in detail.get("attendance", [])
        ]
    )
    st.subheader("Marks")
    dataframe(
        [
            {
                "Course": r.get("code"),
                "Assessment": r.get("assessment"),
                "Score": f"{r.get('score')} / {r.get('maximum_score')}",
                "Feedback": r.get("feedback") or "No feedback recorded",
            }
            for r in detail.get("marks", [])
        ]
    )
    support = detail.get("support") or []
    if support:
        st.subheader("Support plans")
        for item in support:
            plan = item.get("plan") or {}
            with st.expander(str(plan.get("summary", "Support plan"))):
                for action in plan.get("actions", []):
                    st.write(
                        f"{action.get('label', 'Next step')} · due in {action.get('dueInDays', 'not recorded')} days"
                    )
                for citation in plan.get("citations", []):
                    st.caption(
                        f"{citation.get('statement', '')} · {citation.get('evidencePath', '')}"
                    )
    followups = detail.get("followups") or []
    if followups:
        st.subheader("Mentor follow-ups")
        dataframe(
            [
                {
                    "Due": r.get("due_on"),
                    "Mentor": r.get("mentor_name"),
                    "Note": r.get("note"),
                    "Status": r.get("status"),
                    "Outcome": r.get("outcome") or "Not recorded",
                }
                for r in followups
            ]
        )


def render_source_records(actor: dict[str, Any]) -> None:
    st.title("Supplied source records")
    st.write(
        "Original field names and values are preserved. The source definitions and reporting periods are unknown."
    )
    sources = load("sources")
    if not isinstance(sources, dict):
        st.info("No source records are available to this account.")
        return
    counts = sources.get("counts") or {}
    if counts:
        cols = st.columns(2)
        cols[0].metric("Students in scope", value(counts, "students", default=0))
        cols[1].metric("Source files in scope", value(counts, "sources", default=0))
    for note in sources.get("unknowns", []):
        st.info(f"Not defined in the supplied records: {note}.")
    source_by_id = {str(item.get("id")): item for item in sources.get("sources", [])}
    students = sources.get("students") or []
    if actor.get("role") == "governance":
        st.caption("This workspace returns aggregate source counts only.")
        return
    if not students:
        st.info("No source rows are available within your current access.")
        return
    for student in students:
        student_label = " · ".join(
            str(part) for part in [student.get("name"), student.get("srn")] if part
        )
        with st.expander(
            student_label or "Student source records", expanded=len(students) == 1
        ):
            for report in student.get("reports", []):
                source = source_by_id.get(str(report.get("sourceId")), {})
                st.markdown(
                    f"**{source.get('filename', 'Supplied source')}** · {source.get('sheet', 'Sheet not recorded')} · {report.get('semester', 'Reporting period unknown')} · {report.get('section', 'Section not recorded')}"
                )
                dataframe(
                    [
                        {
                            "Course": cell.get("course"),
                            "Recorded field": cell.get("field"),
                            "Recorded value": (
                                ""
                                if cell.get("rawValue") is None
                                else str(cell.get("rawValue"))
                            ),
                            "Source cell": cell.get("sourceCell"),
                            "File": source.get("filename"),
                            "Sheet": source.get("sheet"),
                        }
                        for cell in report.get("cells", [])
                    ]
                )


def render_fees(detail: dict[str, Any], actor: dict[str, Any]) -> None:
    st.title("Fees and receipts")
    invoices = detail.get("invoices") or []
    if not invoices:
        st.info("No fee records are available to this account.")
        return
    dataframe(
        [
            {
                "Invoice": row.get("invoice_number"),
                "Description": row.get("description"),
                "Amount": money(row.get("amount_paise")),
                "Paid": money(row.get("paid_paise")),
                "Balance": money(
                    max(
                        0,
                        int(row.get("amount_paise") or 0)
                        - int(row.get("paid_paise") or 0),
                    )
                ),
                "Due": row.get("due_on"),
                "Status": row.get("status"),
            }
            for row in invoices
        ]
    )
    if actor.get("role") == "parent":
        st.info(
            "No money is collected here. This records a payment attempt against the displayed balance."
        )
        payable = [
            row
            for row in invoices
            if row.get("payment_simulation_allowed")
            and int(row.get("amount_paise") or 0) > int(row.get("paid_paise") or 0)
            and row.get("status") not in {"paid", "void"}
        ]
        if payable:
            selected_invoice_id = select_id(
                "Invoice",
                payable,
                lambda row: str(row.get("id", "")),
                lambda row: (
                    f"{row.get('invoice_number')} · balance {money(max(0, int(row.get('amount_paise') or 0) - int(row.get('paid_paise') or 0)))}"
                ),
                key="payment_invoice",
            )
            invoice = next(
                row for row in payable if str(row.get("id")) == selected_invoice_id
            )
            with st.form("record_payment_attempt"):
                scenario = st.selectbox(
                    "Sandbox outcome",
                    ["success", "decline"],
                    format_func=lambda s: (
                        "Successful attempt" if s == "success" else "Declined attempt"
                    ),
                )
                submitted = st.form_submit_button(
                    "Record payment attempt", type="primary"
                )
            if submitted:
                save_action(
                    "payment",
                    {
                        "invoiceId": invoice["id"],
                        "expectedRevision": int(invoice["revision"]),
                        "scenario": scenario,
                    },
                    "Payment attempt recorded.",
                )
        elif any(
            row.get("payment_simulation_allowed")
            and int(row.get("amount_paise") or 0) > int(row.get("paid_paise") or 0)
            for row in invoices
        ):
            st.caption("There is no outstanding balance to record.")
        elif any(
            int(row.get("amount_paise") or 0) > int(row.get("paid_paise") or 0)
            for row in invoices
        ):
            st.caption("Payment attempts are not available for these records.")
    transactions = [
        tx for invoice in invoices for tx in invoice.get("transactions", [])
    ]
    if transactions:
        st.subheader("Payment ledger")
        dataframe(
            [
                {
                    "Invoice": next(
                        (
                            inv.get("invoice_number")
                            for inv in invoices
                            if tx in inv.get("transactions", [])
                        ),
                        "",
                    ),
                    "Date": short_time(tx.get("created_at")),
                    "Amount": money(tx.get("amount_paise")),
                    "Status": tx.get("status"),
                }
                for tx in transactions
            ]
        )
        receipts = [tx for tx in transactions if tx.get("status") == "captured"]
        if receipts and actor.get("role") in {"parent", "student"}:
            receipt_id = select_id(
                "Receipt",
                receipts,
                lambda row: str(row.get("id", "")),
                lambda row: (
                    f"{short_time(row.get('created_at'))} · {money(row.get('amount_paise'))}"
                ),
                key="receipt_transaction",
            )
            if st.button("View receipt", key="view_receipt") and receipt_id:
                receipt = load("receipt", {"transactionId": receipt_id})
                render_receipt(receipt)


def render_receipt(receipt: dict[str, Any]) -> None:
    if not receipt:
        return
    st.subheader("Receipt")
    fields = [
        ("Receipt", receipt.get("receiptId")),
        ("Student", receipt.get("studentName")),
        ("Register number", receipt.get("registerNumber")),
        ("Term", receipt.get("term")),
        ("Invoice", receipt.get("invoiceNumber")),
        ("Description", receipt.get("description")),
        ("Amount recorded", money(receipt.get("amountPaise"))),
        ("Recorded at", short_time(receipt.get("paidAt"))),
        ("Provider reference", receipt.get("providerReference")),
        ("Record type", receipt.get("mode")),
    ]
    for label, content in fields:
        if content is not None:
            st.write(f"**{label}:** {content}")
    content = "AURA payment receipt\n" + "\n".join(
        f"{label}: {item}" for label, item in fields if item is not None
    )
    st.download_button(
        "Download receipt",
        content,
        file_name=f"receipt-{receipt.get('receiptId', 'record')}.txt",
        mime="text/plain",
        on_click="ignore",
    )


def render_parent_records(
    overview: dict[str, Any], actor: dict[str, Any], page: str
) -> None:
    children = overview.get("children") or []
    if not children:
        st.title("Family workspace")
        st.info("No linked student records are available to this account.")
        return
    child_id = select_id(
        "Student", children, person_id, display_name, key="parent_child"
    )
    if not child_id:
        return
    detail = load("student", {"studentId": child_id})
    student = detail.get("student") or {}
    if page == "Overview":
        st.title(f"{display_name(student)}'s progress")
        st.write(
            "Attendance, results, support updates and fee records available to your account."
        )
        cols = st.columns(3)
        cols[0].metric("Courses", len(detail.get("courses") or []))
        cols[1].metric("Attendance records", len(detail.get("attendance") or []))
        cols[2].metric(
            "Open fee balance",
            money(
                sum(
                    max(
                        0,
                        int(i.get("amount_paise") or 0) - int(i.get("paid_paise") or 0),
                    )
                    for i in detail.get("invoices", [])
                )
            ),
        )
        if detail.get("followups"):
            st.subheader("Mentor updates")
            dataframe(
                [
                    {
                        "Due": r.get("due_on"),
                        "Mentor": r.get("mentor_name"),
                        "Update": r.get("note"),
                        "Status": r.get("status"),
                    }
                    for r in detail["followups"]
                ]
            )
    elif page == "Child records":
        render_academic_records(detail)
    elif page == "Fees and receipts":
        render_fees(detail, actor)


def render_followups(overview: dict[str, Any]) -> None:
    st.title("Mentor follow-ups")
    st.write(
        "Schedule or update a check-in with a due date and a reason for the change."
    )
    followups = overview.get("followups") or []
    students = overview.get("students") or []
    dataframe(
        [
            {
                "Student": r.get("student_name"),
                "Due": r.get("due_on"),
                "Note": r.get("note"),
                "Status": r.get("status"),
                "Overdue": "Yes" if r.get("overdue") else "No",
                "Outcome": r.get("outcome") or "Not recorded",
            }
            for r in followups
        ]
    )
    student_by_id = {person_id(row): row for row in students}
    choices: list[dict[str, Any] | None] = [None, *followups]
    selected = st.selectbox(
        "Follow-up to edit",
        choices,
        format_func=lambda row: (
            "Create a follow-up"
            if row is None
            else f"{row.get('student_name', 'Student')} · due {row.get('due_on', 'date not recorded')}"
        ),
        key="followup_choice",
    )
    with st.form("followup_editor"):
        if selected:
            chosen_student = str(selected.get("student_id", ""))
            st.text_input(
                "Student", value=selected.get("student_name", ""), disabled=True
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
        status = st.selectbox(
            "Status",
            FOLLOWUP_STATES,
            index=FOLLOWUP_STATES.index(selected.get("status"))
            if selected and selected.get("status") in FOLLOWUP_STATES
            else 0,
            format_func=lambda item: item.replace("_", " ").title(),
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
    st.title("Classroom")
    st.write("Review the course roster, record attendance and save assessment marks.")
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
        st.info("No courses are available in your current scope.")
        return
    classroom = load("classroom", {"offeringId": offering_id})
    course = classroom.get("course") or {}
    st.subheader(f"{course.get('code', '')} · {course.get('title', '')}")
    roster = classroom.get("roster") or []
    if not roster:
        st.info("The course roster is empty.")
        return
    st.caption(f"{len(roster)} students in this course")

    sessions = classroom.get("sessions") or []
    session_options: list[dict[str, Any] | None] = [None, *sessions]
    selected_session = st.selectbox(
        "Attendance session",
        session_options,
        format_func=lambda row: (
            "New session"
            if row is None
            else f"{row.get('session_date')} · {row.get('topic')}"
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

    assessments = classroom.get("assessments") or []
    assessment_options: list[dict[str, Any] | None] = [None, *assessments]
    selected_assessment = st.selectbox(
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

    results = classroom.get("results") or []
    if results:
        st.subheader("Published results")
        names = {person_id(student): display_name(student) for student in roster}
        dataframe(
            [
                {
                    "Student": names.get(row.get("student_id"), "Student"),
                    "Result": f"{row.get('percentage')}%",
                    "Published": "Yes" if row.get("published") else "No",
                }
                for row in results
            ]
        )


def render_policy_form() -> None:
    st.subheader("Approve a mentor policy")
    st.caption(
        "These thresholds are the criteria reviews will apply. Confirm each value before saving."
    )
    with st.form("approve_policy"):
        version = st.text_input(
            "Policy version", max_chars=80, placeholder="For example, Mentor review 1"
        )
        attendance_min = st.number_input(
            "Attendance threshold (%)",
            min_value=0.0,
            max_value=100.0,
            value=None,
            step=1.0,
        )
        mark_min = st.number_input(
            "Mark threshold (%)", min_value=0.0, max_value=100.0, value=None, step=1.0
        )
        inactivity_max = st.number_input(
            "Learning inactivity threshold (days)",
            min_value=1,
            max_value=90,
            value=None,
            step=1,
        )
        medium = st.number_input(
            "Medium review score", min_value=1.0, max_value=99.0, value=None, step=1.0
        )
        high = st.number_input(
            "High review score", min_value=2.0, max_value=100.0, value=None, step=1.0
        )
        freshness = st.number_input(
            "Evidence freshness window (days)",
            min_value=1,
            max_value=365,
            value=None,
            step=1,
        )
        scoring = {}
        st.markdown("#### Signal weights and count thresholds")
        scoring["attendanceWeight"] = st.number_input(
            "attendanceWeight", min_value=0, max_value=100, value=20, step=1
        )
        scoring["markWeight"] = st.number_input(
            "markWeight", min_value=0, max_value=100, value=20, step=1
        )
        scoring["inactivityWeight"] = st.number_input(
            "inactivityWeight", min_value=0, max_value=100, value=20, step=1
        )
        scoring["overdueWeight"] = st.number_input(
            "overdueWeight", min_value=0, max_value=100, value=10, step=1
        )
        scoring["internshipWeight"] = st.number_input(
            "internshipWeight", min_value=0, max_value=100, value=15, step=1
        )
        scoring["placementWeight"] = st.number_input(
            "placementWeight", min_value=0, max_value=100, value=15, step=1
        )
        scoring["overdueMinimum"] = st.number_input(
            "overdueMinimum", min_value=1, max_value=100, value=1, step=1
        )
        scoring["internshipMinimum"] = st.number_input(
            "internshipMinimum", min_value=1, max_value=100, value=1, step=1
        )
        scoring["placementMinimum"] = st.number_input(
            "placementMinimum", min_value=1, max_value=100, value=1, step=1
        )
        rationale = st.text_area("Reason for approving this policy", max_chars=600)
        submitted = st.form_submit_button("Approve policy", type="primary")
    if submitted:
        values = [attendance_min, mark_min, inactivity_max, medium, high, freshness]
        if (
            len(version.strip()) < 3
            or any(item is None for item in values)
            or len(rationale.strip()) < 12
        ):
            st.error(
                "Complete every threshold and enter a reason of at least twelve characters."
            )
        elif float(high) <= float(medium):
            st.error("The high review score must exceed the medium review score.")
        else:
            policy = {
                "version": version.strip(),
                "attendanceMinimum": float(attendance_min),
                "markMinimum": float(mark_min),
                "inactivityMaximum": int(inactivity_max),
                "mediumScore": float(medium),
                "highScore": float(high),
                "freshnessDays": int(freshness),
                **scoring,
            }
            save_action(
                "policy_approve",
                {"policy": policy, "rationale": rationale.strip()},
                "Mentor policy approved.",
            )


def policy_rows(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for row in raw:
        policy = row.get("policy") or {}
        output.append(
            {
                "id": str(row.get("id", "")),
                "Policy version": policy.get("version", "Not recorded"),
                "Reason": row.get("rationale", ""),
                "Attendance threshold (%)": policy.get("attendanceMinimum"),
                "Mark threshold (%)": policy.get("markMinimum"),
                "Learning inactivity (days)": policy.get("inactivityMaximum"),
                "Medium review score": policy.get("mediumScore"),
                "High review score": policy.get("highScore"),
                "Evidence freshness (days)": policy.get("freshnessDays"),
                "Weights and count thresholds": "; ".join(
                    f"{key}: {policy.get(key, 'Not recorded')}"
                    for key in [
                        "attendanceWeight",
                        "markWeight",
                        "inactivityWeight",
                        "overdueWeight",
                        "internshipWeight",
                        "placementWeight",
                        "overdueMinimum",
                        "internshipMinimum",
                        "placementMinimum",
                    ]
                ),
                "owner": value(row, "faculty_person_id", "facultyPersonId"),
            }
        )
    return output


def render_plan_workbench(review: dict[str, Any], actor: dict[str, Any]) -> None:
    st.subheader("Review plans")
    st.metric(
        "Configured model",
        "Available" if review.get("modelConfigured") else "Not configured",
    )
    raw_policies = review.get("policies") or []
    policies = policy_rows(raw_policies)
    if policies:
        st.caption("Approved mentor policies")
        dataframe(
            [
                {k: v for k, v in row.items() if k not in {"id", "owner"}}
                for row in policies
            ]
        )
    role = actor.get("role")
    if role == "faculty":
        render_policy_form()
    students = review.get("students") or []
    if role in {"faculty", "hod", "governance"}:
        st.markdown("#### Create a review plan")
        policy_by_id = {row["id"]: row for row in policies if row["id"]}
        student_options = [
            str(value(row, "id", "student_id", default=""))
            for row in students
            if value(row, "id", "student_id")
        ]
        student_labels = {
            str(
                value(row, "id", "student_id")
            ): f"{value(row, 'register_number', 'srn', default='Student')} · {value(row, 'display_name', 'name', default='')}"
            for row in students
            if value(row, "id", "student_id")
        }
        with st.form("create_plan"):
            request_text = st.text_area(
                "Review request",
                max_chars=2000,
                placeholder="Describe the review you need.",
            )
            chosen_students = st.multiselect(
                "Students in scope",
                student_options,
                format_func=lambda item: student_labels.get(item, item),
                max_selections=50,
            )
            domain = st.selectbox(
                "Review focus",
                [None, *PLAN_DOMAINS],
                format_func=lambda item: (
                    "Choose a focus" if item is None else item.replace("-", " ").title()
                ),
            )
            policy_id = st.selectbox(
                "Approved mentor policy",
                [None, *policy_by_id.keys()],
                format_func=lambda item: (
                    "Choose an approved policy"
                    if item is None
                    else policy_by_id[item]["Policy version"]
                ),
            )
            modes = ["deterministic"] + (
                ["model"] if review.get("modelConfigured") else []
            )
            mode = st.selectbox(
                "Execution mode",
                modes,
                format_func=lambda item: (
                    "Deterministic review"
                    if item == "deterministic"
                    else "Configured model review"
                ),
            )
            feedback = st.text_area("Planning notes", max_chars=1000)
            submitted = st.form_submit_button("Save review plan", type="primary")
        if submitted:
            payload: dict[str, Any] = {
                "request": request_text.strip(),
                "mode": mode,
                "feedback": feedback.strip(),
            }
            if chosen_students:
                payload["studentIds"] = chosen_students
            if domain:
                payload["domain"] = domain
            if policy_id:
                payload["policyId"] = policy_id
            if len(request_text.strip()) < 3:
                st.error("Describe the review in at least three characters.")
            else:
                save_action("plan_save", payload, "Review plan saved.")

    plans = review.get("plans") or []
    if not plans:
        st.caption("No review plans are available in this workspace yet.")
        return
    plan_options = [row for row in plans if row.get("id")]
    selected_plan = st.selectbox(
        "Plan",
        plan_options,
        format_func=lambda row: (
            f"{row.get('status', 'Not recorded').replace('_', ' ').title()} · {((row.get('body') or {}).get('request') or 'Review plan')[:70]}"
        ),
        key="review_plan",
    )
    body = selected_plan.get("body") or {}
    st.write(
        f"**Status:** {selected_plan.get('status', 'Not recorded')} · **Revision:** {selected_plan.get('revision', 'Not recorded')}"
    )
    st.write(body.get("request", "Review request not recorded"))
    questions = body.get("questions") or []
    if questions:
        st.warning(
            "Complete these details before locking the plan: " + " ".join(questions)
        )
    if selected_plan.get("status") == "locked":
        st.caption("This plan is locked. Its saved scope and policy cannot be edited.")
        if st.button("Run review", type="primary", key=f"run_{selected_plan['id']}"):
            save_action(
                "plan_execute",
                {"planId": selected_plan["id"]},
                "Review run recorded. Saved activity has been refreshed.",
            )
    elif selected_plan.get("status") != "locked" and not questions:
        if st.button(
            "Lock review plan", type="primary", key=f"lock_{selected_plan['id']}"
        ):
            save_action(
                "plan_lock",
                {
                    "planId": selected_plan["id"],
                    "expectedRevision": int(selected_plan.get("revision", 0)),
                },
                "Review plan locked.",
            )
    left, right = st.columns(2)
    with left:
        if st.button("Prepare evidence export", key=f"export_{selected_plan['id']}"):
            exported = load("plan_export", {"planId": selected_plan["id"]})
            st.download_button(
                "Download review evidence",
                json.dumps(exported, ensure_ascii=False, indent=2),
                file_name=f"review-{selected_plan['id']}.json",
                mime="application/json",
                key=f"download_{selected_plan['id']}",
                on_click="ignore",
            )
    with right:
        review_jobs = [
            row
            for row in review.get("jobs", [])
            if str(value(row, "plan_id", "planId", default=""))
            == str(selected_plan.get("id"))
        ]
        if review_jobs:
            st.caption("Recorded review activity")
            dataframe(
                [
                    {
                        "Status": row.get("status"),
                        "Stage": row.get("stage"),
                        "Execution mode": row.get("mode") or "Not recorded",
                        "Run reference": row.get("run_id") or "Not available",
                        "Issue": row.get("error_code") or "None recorded",
                    }
                    for row in review_jobs
                ]
            )

    for job in review_jobs:
        if job.get("status") == "needs_human":
            st.error(
                "Mentor attention required: the repair or execution budget is exhausted."
            )
            st.json(job.get("failure_diagnosis") or {})
            if job.get("offered_template"):
                with st.expander("Rule template offered for human consideration"):
                    st.caption(
                        "This template has not advanced to approval or publication. Review the diagnosis before creating another review."
                    )
                    st.json(job["offered_template"])
    for job in review_jobs:
        if job.get("source_timings"):
            with st.expander("Collector timings · " + str(job["id"])[:8]):
                st.caption(
                    "Independent source readers use one exported database snapshot. Revision: "
                    + str(job.get("evidence_revision"))
                )
                dataframe(
                    [
                        {"Source": name, "Milliseconds": round(elapsed, 2)}
                        for name, elapsed in job["source_timings"].items()
                    ]
                )


def render_composite_risk(review: dict[str, Any], actor: dict[str, Any]) -> None:
    if actor.get("role") != "faculty":
        return
    st.subheader("Composite risk view")
    rows = review.get("riskView") or []
    plan_options = {
        p["id"]: (p.get("body") or {}).get("request", "Review plan")
        for p in review.get("plans", [])
    }
    plan_filter = st.selectbox(
        "Risk cycle",
        [None, *plan_options],
        format_func=lambda item: (
            "All assigned cycles" if item is None else plan_options[item]
        ),
        key="risk_cycle",
    )
    flagged_only = st.checkbox("Flagged students only", key="risk_flagged")
    scoped = [
        row
        for row in rows
        if (not plan_filter or row.get("planId") == plan_filter)
        and (not flagged_only or row.get("flagged"))
    ]
    dataframe(
        [
            {
                "Student": row["studentName"],
                "Register number": row["registerNumber"],
                "Score": row["score"],
                "Band": row["band"],
                "Status": row["status"],
                "Contributing signals": ", ".join(
                    signal["code"] for signal in row["signals"]
                ),
            }
            for row in scoped
        ]
    )
    for row in scoped:
        if row.get("flagged"):
            with st.expander(f"{row['studentName']} · {row['band']} · {row['score']}"):
                st.write(row["reviewPath"])
                dataframe(
                    [
                        {
                            "Signal": signal["code"],
                            "Source": signal["source"],
                            "Value": signal["value"],
                            "Threshold": signal["threshold"],
                            "Points": signal["points"],
                            "Reason": signal["explanation"],
                        }
                        for signal in row["signals"]
                    ]
                )


def render_outcomes(queue: dict[str, Any], actor: dict[str, Any]) -> None:
    plans = queue.get("plans") or []
    if not plans:
        return
    st.subheader("Intervention outcomes")
    log_rows = [
        {
            "Student": row.get("display_name"),
            "Approved actions": "; ".join(
                action.get("label", "")
                for action in (row.get("plan") or {}).get("actions", [])
            ),
            "Status": row.get("status"),
            "Outcome": row.get("outcome"),
            "Visible": "Yes" if row.get("visible_to_student") else "No",
            "Decision": row.get("decision"),
            "Decided by": row.get("decided_by"),
            "Decision time": row.get("decided_at"),
            "Rationale": row.get("rationale"),
        }
        for row in plans
    ]
    log_rows.extend(
        {
            "Student": event.get("student_name"),
            "Approved actions": "",
            "Status": (event.get("payload") or {}).get("status"),
            "Outcome": (event.get("payload") or {}).get("outcome"),
            "Visible": "Recorded event",
            "Decision": event.get("event_type"),
            "Decided by": event.get("actor_name"),
            "Decision time": event.get("occurred_at"),
            "Rationale": "Immutable intervention history",
        }
        for event in queue.get("interventionLog", [])
    )
    st.markdown("#### Intervention log")
    dataframe(log_rows)
    st.download_button(
        "Download intervention log CSV",
        pd.DataFrame(log_rows).to_csv(index=False),
        file_name="intervention-log.csv",
        mime="text/csv",
        on_click="ignore",
    )

    dataframe(
        [
            {
                "Student": row.get("display_name"),
                "Status": row.get("status"),
                "Outcome": row.get("outcome") or "Not recorded",
                "Visible to student": "Yes" if row.get("visible_to_student") else "No",
            }
            for row in plans
        ]
    )
    if actor.get("role") != "faculty":
        return
    selected = st.selectbox(
        "Intervention",
        plans,
        format_func=lambda row: (
            f"{row.get('display_name', 'Student')} · {row.get('status', 'planned').replace('_', ' ')}"
        ),
        key="intervention_plan",
    )
    versions = [
        v for v in queue.get("versions", []) if v["support_plan_id"] == selected["id"]
    ]
    if versions:
        st.markdown("#### Approved publication history")
        dataframe(
            [
                {
                    "Version": v["version"],
                    "Published": short_time(v["created_at"]),
                    "Content hash": v["content_hash"][:12],
                }
                for v in versions
            ]
        )
        for version in versions:
            if st.button(
                f"Restore version {version['version']}",
                key=f"restore_{selected['id']}_{version['version']}",
            ):
                save_action(
                    "version_restore",
                    {
                        "planId": selected["id"],
                        "version": version["version"],
                        "expectedVersion": max(v["version"] for v in versions),
                    },
                    "Earlier approved version restored as a new publication.",
                )
    current = selected.get("status", "planned")
    statuses = ["planned", "in_progress", "completed", "withdrawn"]
    with st.form("record_outcome"):
        status = st.selectbox(
            "Status",
            statuses,
            index=statuses.index(current) if current in statuses else 0,
            format_func=lambda item: (
                "Withdraw plan"
                if item == "withdrawn"
                else item.replace("_", " ").title()
            ),
        )
        outcome = st.text_area(
            "Outcome or reason for withdrawal",
            value=str(selected.get("outcome", "") or ""),
            max_chars=1200,
        )
        submitted = st.form_submit_button("Save outcome", type="primary")
    if submitted:
        if len(outcome.strip()) < 12:
            st.error(
                "Enter an outcome or withdrawal reason of at least twelve characters."
            )
        else:
            save_action(
                "outcome",
                {
                    "planId": selected["id"],
                    "expectedRevision": int(selected.get("revision", 0)),
                    "status": status,
                    "outcome": outcome.strip(),
                },
                "Intervention outcome saved.",
            )


def render_draft_reviews(queue: dict[str, Any], actor: dict[str, Any]) -> None:
    drafts = queue.get("drafts") or []
    st.subheader("Support reviews")
    if not drafts:
        st.caption("No support drafts are waiting for review.")
        return
    selected = st.selectbox(
        "Draft",
        drafts,
        format_func=lambda row: (
            f"{row.get('display_name', 'Student')} · revision {row.get('revision', '?')}"
        ),
        key="support_draft",
    )
    packet = selected.get("recommendation") or {}
    validation = selected.get("validation") or {}
    st.markdown("#### Recorded validation report")
    st.write(
        f"Recorded packet checks: {'passed' if validation.get('valid') else 'not passed'} · Mode: {selected.get('mode', 'not recorded')} · Model: {selected.get('model_id') or 'none'}"
    )
    st.write(
        f"Fallback: {'yes' if validation.get('fallback') else 'no'} · Provider issue: {validation.get('providerError') or 'none'}"
    )
    st.caption(
        "Historical reports describe the checks implemented when the artifact was recorded. They do not certify additional checks introduced later."
    )
    dataframe(
        [
            {
                "Attempt": item.get("attempt"),
                "Failures": json.dumps(item.get("failures", [])),
            }
            for item in validation.get("repairs", [])
        ]
    )
    if validation.get("failures"):
        st.json(validation["failures"])
    if validation.get("checks"):
        dataframe(validation["checks"])

    st.write(
        f"**Current version:** {selected.get('artifact_id')} · **Status:** {selected.get('status')}"
    )
    st.write(packet.get("summary", "No summary recorded."))
    if validation.get("mentorEdited"):
        st.caption("This artifact includes edits by the mentor account.")
    st.caption("Evidence references")
    dataframe(
        [
            {"Statement": row.get("statement"), "Source field": row.get("evidencePath")}
            for row in packet.get("citations", [])
        ]
    )
    actions = packet.get("actions") or []
    if actions:
        st.caption("Proposed actions")
        dataframe(
            [
                {
                    "Action": row.get("label"),
                    "Owner": row.get("owner"),
                    "Due in days": row.get("dueInDays"),
                }
                for row in actions
            ]
        )
    if actor.get("role") != "faculty":
        st.info("This view is read-only for your role.")
        return
    with st.form(f"edit_draft_{selected['id']}_{selected.get('artifact_id')}"):
        summary = st.text_area(
            "Recommendation summary",
            value=str(packet.get("summary", "")),
            max_chars=600,
        )
        action_rows = [
            {
                "Action": row.get("label", ""),
                "Owner": ACTION_OWNER_LABELS.get(row.get("owner"), "Assigned faculty"),
                "Due in days": int(row.get("dueInDays", 7)),
            }
            for row in actions
        ]
        edited_actions = st.data_editor(
            pd.DataFrame(action_rows),
            column_config={
                "Action": st.column_config.TextColumn("Action", max_chars=180),
                "Owner": st.column_config.SelectboxColumn(
                    "Owner", options=list(ACTION_OWNER_LABELS.values()), required=True
                ),
                "Due in days": st.column_config.NumberColumn(
                    "Due in days", min_value=1, max_value=14, step=1
                ),
            },
            hide_index=True,
            num_rows="fixed",
            width="stretch",
            key=f"draft_actions_{selected['id']}_{selected.get('artifact_id')}",
        )
        edit_rationale = st.text_area("Reason for this edit", max_chars=600)
        edit_submitted = st.form_submit_button("Save new draft version")
    if edit_submitted:
        edited = edited_actions.to_dict(orient="records")
        original_codes = [row.get("code") for row in actions]
        for index, row in enumerate(edited):
            row["code"] = original_codes[index]
            row["label"] = str(row.pop("Action", "")).strip()
            row["owner"] = {
                label: code for code, label in ACTION_OWNER_LABELS.items()
            }.get(str(row.get("Owner", "Assigned faculty")), "assigned_faculty")
            row["dueInDays"] = int(row.get("Due in days", 7))
            row.pop("Owner", None)
            row.pop("Due in days", None)
        updated_packet = {
            "summary": summary.strip(),
            "actions": edited,
            "citations": packet.get("citations", []),
            "prohibited": packet.get("prohibited", []),
        }
        if len(edit_rationale.strip()) < 12:
            st.error("Enter an edit reason of at least twelve characters.")
        else:
            save_action(
                "draft_edit",
                {
                    "caseId": selected["id"],
                    "expectedRevision": int(selected["revision"]),
                    "artifactId": selected["artifact_id"],
                    "packet": updated_packet,
                    "rationale": edit_rationale.strip(),
                },
                "A new draft version was saved.",
            )
    with st.form(f"decide_draft_{selected['id']}_{selected.get('artifact_id')}"):
        decision = st.radio(
            "Decision",
            ["approved", "rejected"],
            format_func=lambda item: item.title(),
            horizontal=True,
        )
        rationale = st.text_area("Decision rationale", max_chars=600)
        decided = st.form_submit_button("Save decision", type="primary")
    if decided:
        if len(rationale.strip()) < 8:
            st.error("Enter a decision rationale of at least eight characters.")
        else:
            save_action(
                "case_decide",
                {
                    "caseId": selected["id"],
                    "expectedRevision": int(selected["revision"]),
                    "artifactId": selected["artifact_id"],
                    "contentHash": selected["content_hash"],
                    "decision": decision,
                    "rationale": rationale.strip(),
                },
                "Decision saved against the displayed draft version.",
            )


def render_review_page(actor: dict[str, Any]) -> None:
    st.title("Support reviews")
    st.write("Review saved plans, source references and the current workflow status.")
    review = load("review_overview")
    render_plan_workbench(review, actor)
    render_composite_risk(review, actor)
    role = actor.get("role")
    if role in {"faculty", "hod"}:
        queue = load("review_queue")
        render_draft_reviews(queue, actor)
        render_outcomes(queue, actor)
    else:
        st.subheader("Review operations")
        jobs = review.get("jobs") or []
        dataframe(
            [
                {
                    "Plan": row.get("plan_id"),
                    "Status": row.get("status"),
                    "Stage": row.get("stage"),
                    "Execution mode": row.get("mode") or "Not recorded",
                    "Run reference": row.get("run_id") or "Not available",
                    "Issue": row.get("error_code") or "None recorded",
                }
                for row in jobs
            ]
        )
        replayable = [row for row in jobs if row.get("run_id")]
        if actor.get("role") == "governance" and replayable:
            run_id = select_id(
                "Completed run",
                replayable,
                lambda row: str(row.get("run_id", "")),
                lambda row: (
                    f"{row.get('status', 'Run')} · {short_time(row.get('updated_at'))}"
                ),
                key="replay_run",
            )
            if (
                st.button("Replay saved run", type="primary", key="replay_saved_run")
                and run_id
            ):
                result = save_action("replay", {"runId": run_id}, "Replay completed.")
                if result:
                    replay = result.get("replay") or {}
                    st.write(
                        "Replay matched the saved run."
                        if replay.get("matched")
                        else "Replay did not match the saved run."
                    )
                    st.write(f"Input hash: {replay.get('inputHash', 'Not recorded')}")
                    st.write(f"Output hash: {replay.get('outputHash', 'Not recorded')}")
        elif actor.get("role") == "governance":
            st.caption("No completed run is available for replay.")


def render_lms(actor: dict[str, Any]) -> None:
    st.title("Learning workspace")
    lms = load("lms_overview")
    courses = lms.get("courses") or []
    offering_id = select_id(
        "Course",
        courses,
        lambda row: str(row.get("id", "")),
        lambda row: (
            f"{row.get('code', '')} · {row.get('title', '')} · {row.get('section', '')}"
        ),
        key="lms_course",
    )
    if not offering_id:
        st.info("No courses are available in your current learning workspace.")
        return
    detail = load("lms_course", {"courseId": offering_id})
    course = detail.get("course") or {}
    st.subheader(f"{course.get('code', '')} · {course.get('title', '')}")
    is_student = actor.get("role") == "student"
    lessons = detail.get("lessons") or []
    assignments = detail.get("assignments") or []
    submissions = detail.get("submissions") or []
    st.markdown("#### Lessons")
    if not lessons:
        st.caption("No lessons are available for this course yet.")
    for lesson in lessons:
        with st.expander(str(lesson.get("title", "Lesson"))):
            if lesson.get("body"):
                st.write(lesson["body"])
            if lesson.get("material_url"):
                st.link_button("Open course material", lesson["material_url"])
            if lesson.get("attachment_name"):
                st.caption(f"Attachment: {lesson['attachment_name']}")
            if is_student and st.button(
                "Mark lesson as opened", key=f"open_lesson_{lesson['id']}"
            ):
                save_action(
                    "lms_command",
                    {"action": "open-lesson", "lessonId": lesson["id"]},
                    "Lesson activity recorded.",
                )

    if not is_student:
        st.markdown("#### Add or update a lesson")
        lesson_choices: list[dict[str, Any] | None] = [None, *lessons]
        selected_lesson = st.selectbox(
            "Lesson to edit",
            lesson_choices,
            format_func=lambda row: (
                "New lesson" if row is None else str(row.get("title", "Lesson"))
            ),
            key=f"lesson_edit_{offering_id}",
        )
        with st.form(
            f"lesson_form_{offering_id}_{(selected_lesson or {}).get('id', 'new')}"
        ):
            title = st.text_input(
                "Lesson title",
                value=str(selected_lesson.get("title", "") if selected_lesson else ""),
                max_chars=160,
            )
            body = st.text_area(
                "Lesson content",
                value=str(selected_lesson.get("body", "") if selected_lesson else ""),
                max_chars=40000,
                height=180,
            )
            material_url = st.text_input(
                "Material link",
                value=str(
                    selected_lesson.get("material_url", "") if selected_lesson else ""
                ),
                max_chars=2000,
            )
            position = st.number_input(
                "Order",
                min_value=1,
                max_value=1000,
                value=int(
                    selected_lesson.get("position", len(lessons) + 1)
                    if selected_lesson
                    else len(lessons) + 1
                ),
                step=1,
            )
            published = st.checkbox(
                "Make lesson available to students",
                value=bool(
                    selected_lesson.get("published", False)
                    if selected_lesson
                    else False
                ),
            )
            lesson_file = st.file_uploader(
                "Add a lesson file (optional, up to 2 MB)",
                key=f"lesson_file_{offering_id}_{(selected_lesson or {}).get('id', 'new')}",
                max_upload_size=2,
                help="A new file replaces the current attachment. Leave this empty to keep it.",
            )
            submitted = st.form_submit_button("Save lesson", type="primary")
        if submitted:
            if len(title.strip()) < 3:
                st.error("Enter a lesson title with at least three characters.")
            else:
                attachment, attachment_error = attachment_payload(lesson_file)
                if attachment_error:
                    st.error(attachment_error)
                else:
                    payload = {
                        "action": "save-lesson",
                        "offeringId": offering_id,
                        "title": title.strip(),
                        "body": body,
                        "materialUrl": material_url.strip(),
                        "published": published,
                        "position": int(position),
                    }
                    if attachment:
                        payload["attachment"] = attachment
                    if selected_lesson:
                        payload.update(
                            {
                                "id": selected_lesson["id"],
                                "expectedRevision": int(selected_lesson["revision"]),
                            }
                        )
                    save_action("lms_command", payload, "Lesson saved.")

    st.markdown("#### Assignments")
    if not assignments:
        st.caption("No assignments are available for this course yet.")
    for assignment in assignments:
        with st.expander(
            f"{assignment.get('title', 'Assignment')} · due {short_time(assignment.get('due_at'))}"
        ):
            st.write(assignment.get("instructions", ""))
            st.write(
                f"Maximum score: {assignment.get('maximum_score', 'Not recorded')}"
            )
            if assignment.get("deadline_passed"):
                st.caption("The recorded deadline has passed.")
            if assignment.get("attachment_name"):
                st.caption(f"Attachment: {assignment['attachment_name']}")
    if not is_student:
        st.markdown("#### Add or update an assignment")
        assignment_choices: list[dict[str, Any] | None] = [None, *assignments]
        selected_assignment = st.selectbox(
            "Assignment to edit",
            assignment_choices,
            format_func=lambda row: (
                "New assignment" if row is None else str(row.get("title", "Assignment"))
            ),
            key=f"assignment_edit_{offering_id}",
        )
        try:
            initial_due = (
                datetime.fromisoformat(
                    str(selected_assignment.get("due_at"))
                ).astimezone()
                if selected_assignment
                else datetime.now().astimezone() + timedelta(days=7)
            )
        except ValueError:
            initial_due = datetime.now().astimezone() + timedelta(days=7)
        with st.form(
            f"assignment_form_{offering_id}_{(selected_assignment or {}).get('id', 'new')}"
        ):
            title = st.text_input(
                "Assignment title",
                value=str(
                    selected_assignment.get("title", "") if selected_assignment else ""
                ),
                max_chars=160,
            )
            instructions = st.text_area(
                "Instructions",
                value=str(
                    selected_assignment.get("instructions", "")
                    if selected_assignment
                    else ""
                ),
                max_chars=40000,
                height=150,
            )
            due_date = st.date_input("Due date", value=initial_due.date())
            due_time = st.time_input(
                "Due time", value=initial_due.time().replace(second=0, microsecond=0)
            )
            maximum = st.number_input(
                "Maximum score",
                min_value=0.01,
                max_value=1000.0,
                value=float(
                    selected_assignment.get("maximum_score", 100)
                    if selected_assignment
                    else 100
                ),
                step=1.0,
            )
            published = st.checkbox(
                "Make assignment available to students",
                value=bool(
                    selected_assignment.get("published", False)
                    if selected_assignment
                    else False
                ),
            )
            allow_late = st.checkbox(
                "Accept late submissions",
                value=bool(
                    selected_assignment.get("allow_late", True)
                    if selected_assignment
                    else True
                ),
            )
            assignment_file = st.file_uploader(
                "Add an assignment file (optional, up to 2 MB)",
                key=f"assignment_file_{offering_id}_{(selected_assignment or {}).get('id', 'new')}",
                max_upload_size=2,
                help="A new file replaces the current attachment. Leave this empty to keep it.",
            )
            submitted = st.form_submit_button("Save assignment", type="primary")
        if submitted:
            if len(title.strip()) < 3 or len(instructions.strip()) < 5:
                st.error("Enter an assignment title and instructions.")
            else:
                attachment, attachment_error = attachment_payload(assignment_file)
                if attachment_error:
                    st.error(attachment_error)
                else:
                    local_zone = datetime.now().astimezone().tzinfo
                    due_at = datetime.combine(
                        due_date, due_time, tzinfo=local_zone
                    ).isoformat(timespec="seconds")
                    payload = {
                        "action": "save-assignment",
                        "offeringId": offering_id,
                        "title": title.strip(),
                        "instructions": instructions.strip(),
                        "dueAt": due_at,
                        "maximumScore": float(maximum),
                        "published": published,
                        "allowLate": allow_late,
                    }
                    if attachment:
                        payload["attachment"] = attachment
                    if selected_assignment:
                        payload.update(
                            {
                                "id": selected_assignment["id"],
                                "expectedRevision": int(
                                    selected_assignment["revision"]
                                ),
                            }
                        )
                    save_action("lms_command", payload, "Assignment saved.")

    if is_student and assignments:
        st.markdown("#### Submit assignment")
        submissions_by_assignment = {
            row.get("assignment_id"): row for row in submissions
        }
        assignment_id = select_id(
            "Assignment",
            assignments,
            lambda row: str(row.get("id", "")),
            lambda row: str(row.get("title", "Assignment")),
            key=f"submit_assignment_{offering_id}",
        )
        assignment = next(
            row for row in assignments if str(row.get("id")) == assignment_id
        )
        current_submission = submissions_by_assignment.get(assignment_id)
        if current_submission:
            st.caption(
                f"Last submitted {short_time(current_submission.get('submitted_at'))}. Revision {current_submission.get('revision')}."
            )
            if current_submission.get("feedback"):
                st.write(f"**Feedback:** {current_submission['feedback']}")
        with st.form(f"student_submission_{assignment_id}"):
            answer = st.text_area(
                "Your response",
                value=str(
                    current_submission.get("answer", "") if current_submission else ""
                ),
                max_chars=40000,
                height=180,
            )
            submission_file = st.file_uploader(
                "Attach your work (optional, up to 2 MB)",
                key=f"submission_file_{assignment_id}",
                max_upload_size=2,
                help="If you already attached a file, it will be kept when you submit without a replacement.",
            )
            submitted = st.form_submit_button("Submit assignment", type="primary")
        if submitted:
            attachment, attachment_error = attachment_payload(submission_file)
            if attachment_error:
                st.error(attachment_error)
            else:
                if (
                    attachment is None
                    and current_submission
                    and current_submission.get("attachment_name")
                ):
                    try:
                        attachment = request(
                            "lms_attachment",
                            {"kind": "submissions", "id": current_submission["id"]},
                        )
                    except BridgeError as error:
                        st.error(str(error))
                        attachment = None
                if attachment is not None or not (
                    current_submission and current_submission.get("attachment_name")
                ):
                    payload = {
                        "action": "submit-assignment",
                        "assignmentId": assignment_id,
                        "expectedRevision": int(current_submission.get("revision", -1))
                        if current_submission
                        else -1,
                        "answer": answer.strip(),
                    }
                    if attachment:
                        payload["attachment"] = attachment
                    save_action("lms_command", payload, "Assignment submitted.")

    if not is_student and submissions:
        st.markdown("#### Review submissions")
        assignment_by_id = {row.get("id"): row for row in assignments}
        submission = st.selectbox(
            "Submission",
            submissions,
            format_func=lambda row: (
                f"{row.get('student_name', 'Student')} · {assignment_by_id.get(row.get('assignment_id'), {}).get('title', 'Assignment')}"
            ),
            key=f"feedback_submission_{offering_id}",
        )
        current_assignment = assignment_by_id.get(submission.get("assignment_id"), {})
        with st.form(f"feedback_{submission.get('id')}_{submission.get('revision')}"):
            score = st.number_input(
                "Score",
                min_value=0.0,
                max_value=float(current_assignment.get("maximum_score", 100) or 100),
                value=float(submission.get("score") or 0),
                step=0.5,
            )
            feedback = st.text_area(
                "Feedback",
                value=str(submission.get("feedback", "") or ""),
                max_chars=12000,
            )
            submitted = st.form_submit_button("Publish feedback", type="primary")
        if submitted:
            if len(feedback.strip()) < 3:
                st.error("Enter feedback with at least three characters.")
            else:
                save_action(
                    "lms_command",
                    {
                        "action": "publish-feedback",
                        "submissionId": submission["id"],
                        "expectedRevision": int(submission["revision"]),
                        "score": float(score),
                        "feedback": feedback.strip(),
                    },
                    "Feedback published.",
                )

    course_files: list[dict[str, str]] = []
    for kind, rows, label in (
        ("lessons", lessons, "Lesson"),
        ("assignments", assignments, "Assignment"),
        ("submissions", submissions, "Submission"),
    ):
        for row in rows:
            if row.get("attachment_name"):
                course_files.append(
                    {
                        "id": str(row.get("id", "")),
                        "kind": kind,
                        "name": str(row["attachment_name"]),
                        "label": f"{label} · {row.get('title') or row.get('student_name') or 'Course file'}",
                    }
                )
    if course_files:
        st.markdown("#### Course files")
        file_id = select_id(
            "File",
            course_files,
            lambda row: row["id"],
            lambda row: f"{row['label']} · {row['name']}",
            key=f"lms_file_{offering_id}",
        )
        selected_file = next(
            (row for row in course_files if row["id"] == file_id), None
        )
        if selected_file:
            try:
                file_result = request(
                    "lms_attachment",
                    {"kind": selected_file["kind"], "id": selected_file["id"]},
                )
                file_data = base64.b64decode(file_result["data"], validate=True)
                st.download_button(
                    f"Download {file_result['name']}",
                    data=file_data,
                    file_name=file_result["name"],
                    mime="application/octet-stream",
                    key=f"download_lms_file_{selected_file['id']}",
                    on_click="ignore",
                )
            except BridgeError as error:
                if error.status == 401:
                    st.session_state.pop("token", None)
                    st.session_state.pop("actor", None)
                    st.warning("Your session has ended. Sign in again to continue.")
                else:
                    st.error(str(error))
            except (KeyError, TypeError, ValueError):
                st.error("The selected file could not be prepared for download.")


def render_evaluation_metrics(review: dict[str, Any]) -> None:
    st.subheader("Evaluation by review cycle")
    metrics = review.get("metrics") or {}
    cycles = metrics.get("cycles") or []
    st.caption(
        "Calculated from recorded checkpoints, immutable artifacts and decisions. Pending cases are excluded from decision metrics; blank values mean no decision yet."
    )
    dataframe([{**row, "cycleId": str(row["cycleId"])[:8]} for row in cycles])
    if metrics.get("perRun"):
        with st.expander("Per-run metrics"):
            dataframe(metrics["perRun"])


def render_review_trends(review: dict[str, Any]) -> None:
    st.subheader("Support trends by review cycle")
    st.caption(
        "Each cycle is a saved plan. Reviewed means risk evaluated; approvals and outcomes are recorded decisions. Counts may overlap. This panel contains aggregates only."
    )
    rows = review.get("trends") or []
    if not rows:
        st.info("No evaluated review cycles yet.")
        return
    counts = pd.DataFrame(
        [
            {
                "Cycle": r["day"],
                **{
                    k.replace("_", " ").title(): r.get(k, 0)
                    for k in (
                        "reviewed",
                        "flagged",
                        "blocked",
                        "awaiting_approval",
                        "approved",
                        "completed",
                        "withdrawn",
                    )
                },
            }
            for r in rows
        ]
    ).set_index("Cycle")
    st.bar_chart(counts, stack=False)
    averages = pd.DataFrame(
        [
            {
                "Cycle": r["day"],
                **{
                    band.title(): r.get("average_" + band)
                    for band in ("low", "medium", "high")
                },
            }
            for r in rows
        ]
    ).set_index("Cycle")
    st.line_chart(averages)
    st.caption(
        "Average composite risk by band. Gaps mean no evaluated cases in that band."
    )
    st.dataframe(counts, width="stretch")


def render_department_home(overview: dict[str, Any]) -> None:
    st.title("Department overview")
    review = load("review_overview")
    render_review_trends(review)
    render_evaluation_metrics(review)
    counts = overview.get("counts") or {}
    cols = st.columns(4)
    cols[0].metric(
        "Students in scope",
        value(counts, "students", default=len(overview.get("students", []))),
    )
    cols[1].metric(
        "Courses", value(counts, "courses", default=len(overview.get("courses", [])))
    )
    cols[2].metric("Follow-ups overdue", value(counts, "overdue_followups", default=0))
    cols[3].metric("Reviews awaiting work", value(counts, "pending_reviews", default=0))
    st.subheader("Courses")
    dataframe(
        [
            {
                "Course": f"{r.get('code', '')} · {r.get('title', '')}",
                "Section": r.get("section"),
                "Faculty": r.get("faculty_name"),
                "Enrolled": r.get("enrolled"),
                "Status": r.get("status"),
            }
            for r in overview.get("courses", [])
        ]
    )
    st.subheader("Students in department scope")
    dataframe(
        [
            {
                "Student": display_name(r),
                "Register number": r.get("register_number"),
                "Semester": r.get("semester"),
                "Mentor": r.get("mentor_name"),
                "Courses": r.get("course_count"),
            }
            for r in overview.get("students", [])
        ]
    )


def render_governance(actor: dict[str, Any]) -> None:
    st.title("Review operations")
    review = load("review_overview")
    st.write(
        "Check saved plan activity, replay completed runs and export review evidence."
    )
    render_plan_workbench(review, actor)
    render_evaluation_metrics(review)
    jobs = review.get("jobs") or []
    dataframe(
        [
            {
                "Plan status": row.get("status"),
                "Stage": row.get("stage"),
                "Execution mode": row.get("mode") or "Not recorded",
                "Run reference": "Available" if row.get("run_id") else "Not available",
                "Issue": str(row.get("error_code") or "None recorded")
                .replace("_", " ")
                .title(),
            }
            for row in jobs
        ]
    )
    replayable = [row for row in jobs if row.get("run_id")]
    if actor.get("role") == "governance" and replayable:
        run_id = select_id(
            "Completed run",
            replayable,
            lambda row: str(row.get("run_id", "")),
            lambda row: (
                f"{row.get('status', 'Run')} · {short_time(row.get('updated_at'))}"
            ),
            key="governance_replay_run",
        )
        if (
            st.button("Replay saved run", type="primary", key="governance_replay")
            and run_id
        ):
            result = save_action("replay", {"runId": run_id}, "Replay completed.")
            if result:
                replay = result.get("replay") or {}
                st.write(
                    "Replay matched the saved run."
                    if replay.get("matched")
                    else "Replay did not match the saved run."
                )
                st.write(f"Input hash: {replay.get('inputHash', 'Not recorded')}")
                st.write(f"Output hash: {replay.get('outputHash', 'Not recorded')}")
    elif actor.get("role") != "governance":
        st.info("This governance workspace is read-only for your account.")


def portal_pages(portal: str) -> list[str]:
    return {
        "student": [
            "Overview",
            "Learning",
            "Academic records",
            "Fees and receipts",
            "Source records",
        ],
        "parent": ["Overview", "Child records", "Fees and receipts", "Source records"],
        "faculty": [
            "Overview",
            "Classroom",
            "Mentor follow-ups",
            "Support reviews",
            "Source records",
        ],
        "hod": [
            "Department overview",
            "Classroom",
            "Mentor follow-ups",
            "Support reviews",
            "Source records",
        ],
        "governance": ["Operations", "Source records"],
        "lms": ["Learning"],
    }.get(portal, ["Overview"])


def main() -> None:
    actor = st.session_state.get("actor")
    if not actor or not st.session_state.get("token"):
        login_view()
        return
    portal = actor.get("portal", "student")
    role = actor.get("role")
    if role not in PORTAL_ROLES.get(portal, set()):
        st.session_state.pop("actor", None)
        st.session_state.pop("token", None)
        st.session_state.pop("success_notice", None)
        st.error("Your session no longer matches this workspace. Sign in again.")
        st.stop()
    sign_in_sidebar(actor)
    success_notice = st.session_state.pop("success_notice", None)
    if success_notice:
        st.success(success_notice)
    pages = portal_pages(portal)
    page = (
        st.sidebar.radio("Workspace", pages, label_visibility="collapsed")
        if len(pages) > 1
        else pages[0]
    )

    if portal == "lms" or page == "Learning":
        render_lms(actor)
        return
    if portal == "governance" and page == "Operations":
        render_governance(actor)
        return
    overview = load("overview")
    if portal == "student":
        student_id = value(actor, "studentId", "student_id")
        if not student_id:
            st.error("A student record is not linked to this account.")
            return
        detail = load("student", {"studentId": student_id})
        if page == "Overview":
            render_student_home(detail, actor)
        elif page == "Academic records":
            render_academic_records(detail)
        elif page == "Fees and receipts":
            render_fees(detail, actor)
        elif page == "Source records":
            render_source_records(actor)
    elif portal == "parent":
        if page == "Source records":
            render_source_records(actor)
        else:
            render_parent_records(overview, actor, page)
    elif portal == "faculty":
        if page == "Overview":
            st.title(f"Welcome, {display_name(actor)}")
            st.write("Your assigned courses, mentees and upcoming follow-ups.")
            counts = overview.get("counts") or {}
            cols = st.columns(4)
            cols[0].metric("Assigned students", len(overview.get("students") or []))
            cols[1].metric(
                "Courses",
                value(counts, "courses", default=len(overview.get("courses", []))),
            )
            cols[2].metric(
                "Pending reviews", value(counts, "pending_reviews", default=0)
            )
            cols[3].metric(
                "Overdue follow-ups", value(counts, "overdue_followups", default=0)
            )
            dataframe(
                [
                    {
                        "Student": r.get("student_name"),
                        "Due": r.get("due_on"),
                        "Note": r.get("note"),
                        "Status": r.get("status"),
                    }
                    for r in overview.get("followups", [])
                ]
            )
        elif page == "Classroom":
            render_classroom(overview)
        elif page == "Mentor follow-ups":
            render_followups(overview)
        elif page == "Support reviews":
            render_review_page(actor)
        elif page == "Source records":
            render_source_records(actor)
    elif portal == "hod":
        if page == "Department overview":
            render_department_home(overview)
        elif page == "Classroom":
            render_classroom(overview)
        elif page == "Mentor follow-ups":
            render_followups(overview)
        elif page == "Support reviews":
            render_review_page(actor)
        elif page == "Source records":
            render_source_records(actor)


main()
