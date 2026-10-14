from __future__ import annotations

import base64
import json
import subprocess
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import altair as alt
import labels
import pandas as pd
import streamlit as st
import ui
from bridge import BridgeError, get_client

st.set_page_config(
    page_title="AURA | Student Success",
    page_icon=str(Path(__file__).resolve().parent / "assets" / "aura-mark.svg"),
    layout="wide",
    initial_sidebar_state="expanded",
)

PORTALS = {
    "student": "Student",
    "parent": "Parent",
    "faculty": "Mentor",
    "hod": "Department head",
    "governance": "AI activity",
    "lms": "Learning (LMS)",
}
PORTAL_ICONS = {
    "student": ":material/school:",
    "parent": ":material/family_restroom:",
    "faculty": ":material/supervisor_account:",
    "hod": ":material/account_balance:",
    "governance": ":material/hub:",
    "lms": ":material/auto_stories:",
}
PAGE_ICONS = {
    "Overview": ":material/space_dashboard:",
    "Learning": ":material/auto_stories:",
    "Academic records": ":material/menu_book:",
    "Fees and receipts": ":material/receipt_long:",
    "Source records": ":material/dataset:",
    "Child records": ":material/menu_book:",
    "Classroom": ":material/co_present:",
    "Mentor follow-ups": ":material/event_note:",
    "Support reviews": ":material/fact_check:",
    "Department overview": ":material/monitoring:",
    "AI activity": ":material/hub:",
}
CHECK_LABELS = {
    "alerts_cite_triggers": "Each alert cites its triggering signals",
    "thresholds_faculty_set": "Thresholds are faculty-set",
    "advisor_review_required": "No student labelled without mentor review",
    "privacy_scope_enforced": "Privacy scope enforced",
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


READ_CACHE_KEY = "worker_read_cache"
READ_CACHE_SECONDS = 30
# Read-only worker actions that load() may serve from the per-session cache.
# Anything that changes data goes through save_action(), which clears the cache.
CACHEABLE_READS = frozenset(
    {
        "overview",
        "student",
        "classroom",
        "sources",
        "receipt",
        "lms_overview",
        "lms_course",
        "review_overview",
        "review_queue",
        "plan_export",
    }
)


def clear_read_cache() -> None:
    st.session_state.pop(READ_CACHE_KEY, None)


def cached_read(action: str, data: dict[str, Any] | None = None) -> Any:
    """Serve a worker read from a short per-session cache.

    The cache lives in st.session_state, not st.cache_data: a process-wide cache
    would keep the signed-in user's data (and token-scoped results) in server
    memory shared by every session. Entries are JSON text, so each hit returns a
    fresh copy that callers can mutate freely.
    """
    if action not in CACHEABLE_READS:
        return request(action, data)
    key = (action, json.dumps(data or {}, sort_keys=True, default=str))
    now = time.monotonic()
    entry = st.session_state.get(READ_CACHE_KEY, {}).get(key)
    if entry and now - entry[0] < READ_CACHE_SECONDS:
        return json.loads(entry[1])
    result = request(action, data)
    live = {
        k: v
        for k, v in st.session_state.get(READ_CACHE_KEY, {}).items()
        if now - v[0] < READ_CACHE_SECONDS
    }
    live[key] = (now, json.dumps(result))
    st.session_state[READ_CACHE_KEY] = live
    return result


def load(action: str, data: dict[str, Any] | None = None) -> Any:
    try:
        with st.spinner("Loading your workspace…"):
            return cached_read(action, data)
    except BridgeError as error:
        if error.status == 401:
            clear_read_cache()
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
            try:
                result = request(action, data)
            finally:
                # Never show pre-write data, even if the write failed part-way.
                clear_read_cache()
        if action == "replay":
            st.success(success)
            return result
        if action in {"plan_save", "plan_revise", "plan_pause", "plan_lock"}:
            st.session_state["review_plan_selector_revision"] = (
                st.session_state.get("review_plan_selector_revision", 0) + 1
            )
            st.session_state["review_selected_id"] = result.get(
                "id", data.get("planId")
            )
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
    ui.hide_sidebar()
    brand_col, form_col = st.columns(
        [1.15, 1], gap="large", vertical_alignment="center"
    )
    with brand_col:
        ui.brand_panel()
    with form_col:
        with ui.card("login"):
            st.html('<p class="aura-eyebrow">Welcome back</p>')
            st.header("Sign in to your workspace", anchor=False)
            st.caption(
                "Use your college account. You'll only see the records and tools your role allows."
            )
            portal = st.segmented_control(
                "Workspace",
                list(PORTALS),
                default="student",
                required=True,
                format_func=lambda key: f"{PORTAL_ICONS[key]} {PORTALS[key]}",
                key="login_workspace",
            )
            with st.form("sign_in", clear_on_submit=True, border=False):
                email = st.text_input(
                    "Email", autocomplete="email", placeholder="name@college.edu"
                )
                password = st.text_input(
                    "Password", type="password", autocomplete="current-password"
                )
                submitted = st.form_submit_button(
                    "Sign in", type="primary", width="stretch"
                )
            st.caption(
                ":material/lock: Sessions are private to your account and end when you sign out."
            )
        if submitted:
            complete_sign_in(portal, email, password)


def complete_sign_in(portal: str | None, email: str, password: str) -> None:
    if not portal:
        st.error("Choose the workspace you want to open.")
        return
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
    clear_read_cache()
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
    clear_read_cache()
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
    column_config: dict[str, Any] | None = None,
) -> None:
    if not rows:
        st.caption(f":material/inbox: {empty}")
        return
    st.dataframe(
        pd.DataFrame(rows),
        hide_index=True,
        width="stretch",
        key=key,
        column_config=column_config,
    )


def percent(raw: Any) -> float | None:
    try:
        return None if raw is None else float(raw)
    except (TypeError, ValueError):
        return None


def average(values: list[float | None]) -> float | None:
    known = [v for v in values if v is not None]
    return round(sum(known) / len(known), 1) if known else None


def percent_text(raw: Any) -> str:
    number = percent(raw)
    return "—" if number is None else f"{number:g}%"


PERCENT_COLUMN = {
    "format": "%.0f%%",
    "min_value": 0,
    "max_value": 100,
}


def sign_in_sidebar(actor: dict[str, Any]) -> None:
    ui.brand()
    portal = actor.get("portal")
    ui.identity_card(
        labels.pretty_name(display_name(actor)),
        PORTALS.get(portal, "Workspace"),
        actor.get("email", ""),
    )


def sidebar_footer() -> None:
    st.sidebar.divider()
    if st.sidebar.button("Sign out", width="stretch", icon=":material/logout:"):
        sign_out()
    st.sidebar.caption(
        "AURA · Student Success & Early Warning. Agents draft and flag; mentors decide."
    )


def render_student_home(detail: dict[str, Any], actor: dict[str, Any]) -> None:
    student = detail.get("student") or {}
    name = display_name(student) if student else display_name(actor)
    ui.page_header(
        f"Welcome, {name.split()[0].title() if name else 'there'}",
        "Your courses, progress and the support your mentor has confirmed for you.",
        eyebrow="Student workspace",
    )
    courses = detail.get("courses") or []
    marks = detail.get("marks") or []
    invoices = detail.get("invoices") or []
    outstanding_paise = sum(
        max(
            0,
            int(invoice.get("amount_paise") or 0) - int(invoice.get("paid_paise") or 0),
        )
        for invoice in invoices
    )
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
                "label": "Fees outstanding",
                "value": money(outstanding_paise),
                "icon": ":material/account_balance_wallet:",
            },
        ]
    )
    render_support_cards(detail.get("support") or [], audience="student")
    if courses:
        ui.section("Your courses", "Attendance and results recorded so far this term.")
        render_course_cards(courses)
    elif not marks:
        ui.empty_state(
            "No courses yet",
            "Your registered courses will appear here once the term begins.",
            "📚",
        )
    render_mentor_updates(detail.get("followups") or [])


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
            st.caption(
                f":material/description: {ui._md_safe(plan.get('summary', 'Support plan'))}"
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


def render_academic_records(detail: dict[str, Any], *, heading: bool = True) -> None:
    if heading:
        ui.page_header(
            "Academic records",
            "Attendance, marks and results currently available to your account.",
            eyebrow="Records",
        )
    courses = detail.get("courses") or []
    tab_courses, tab_attendance, tab_marks, tab_support = st.tabs(
        [
            ":material/menu_book: Courses",
            ":material/event_available: Attendance",
            ":material/grading: Marks",
            ":material/handshake: Support",
        ]
    )
    with tab_courses:
        dataframe(
            [
                {
                    "Course": f"{r.get('code', '')} · {r.get('title', '')}",
                    "Term": r.get("term_name"),
                    "Registration": labels.status_label(r.get("registration_status")),
                    "Present": r.get("present"),
                    "Absent": r.get("absent"),
                    "Attendance": percent(r.get("percentage")),
                    "Result": percent_text(r.get("result_percentage"))
                    if r.get("result_published")
                    and r.get("result_percentage") is not None
                    else "Not published",
                }
                for r in courses
            ],
            empty="No courses are registered yet.",
            column_config={
                "Attendance": st.column_config.ProgressColumn(
                    "Attendance", **PERCENT_COLUMN
                )
            },
        )
    with tab_attendance:
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
    with tab_marks:
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
    with tab_support:
        support = detail.get("support") or []
        if support:
            render_support_cards(support, audience="family")
        followups = detail.get("followups") or []
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
        if not support and not followups:
            ui.empty_state(
                "Nothing here yet",
                "Approved support and mentor follow-ups will appear here.",
                "🤝",
            )


def render_source_records(actor: dict[str, Any]) -> None:
    ui.page_header(
        "Source records",
        "The college's original records, exactly as supplied. Nothing here has been reinterpreted.",
        eyebrow="Evidence",
    )
    sources = load("sources")
    if not isinstance(sources, dict):
        ui.empty_state("No source records", "None are available to this account.", "🗂️")
        return
    counts = sources.get("counts") or {}
    if counts:
        ui.kpi_row(
            [
                {
                    "label": "Students in scope",
                    "value": value(counts, "students", default=0),
                    "icon": ":material/groups:",
                },
                {
                    "label": "Source files in scope",
                    "value": value(counts, "sources", default=0),
                    "icon": ":material/description:",
                },
            ]
        )
    unknowns = [str(note) for note in sources.get("unknowns", []) if note]
    if unknowns:
        with st.expander("About these records", icon=":material/info:"):
            st.write(
                "Original field names and values are preserved byte for byte. "
                "The college has not yet defined the following, so AURA does not interpret them:"
            )
            for note in unknowns:
                st.markdown(f"- {ui._md_safe(note).capitalize()}")
            st.caption(
                "Values such as NA, TNS, 0 and blank are shown exactly as recorded. "
                "Support risk uses separate operational records."
            )
    source_by_id = {str(item.get("id")): item for item in sources.get("sources", [])}
    students = sources.get("students") or []
    if actor.get("role") == "governance":
        st.caption(
            ":material/shield: AI activity receives aggregate counts only, never individual source rows."
        )
        return
    if not students:
        ui.empty_state(
            "No source rows in your scope",
            "Rows appear here for the students you are permitted to see.",
            "🔒",
        )
        return
    for student in students:
        student_label = " · ".join(
            str(part) for part in [student.get("name"), student.get("srn")] if part
        )
        with st.expander(
            student_label or "Student source records",
            expanded=len(students) == 1,
            icon=":material/person:",
        ):
            for report in student.get("reports", []):
                source = source_by_id.get(str(report.get("sourceId")), {})
                st.markdown(
                    f"**{ui._md_safe(labels.friendly_source_name(source.get('filename')))}** "
                    f"· {ui._md_safe(source.get('sheet', 'Sheet not recorded'))} "
                    f"· {ui._md_safe(report.get('semester', 'Reporting period unknown'))} "
                    f"· {ui._md_safe(report.get('section', 'Section not recorded'))}"
                )
                st.caption(
                    f"Original file: {ui.code_span(source.get('filename') or 'not recorded')}"
                )
                dataframe(
                    [
                        {
                            "Course": cell.get("course"),
                            "Recorded field": cell.get("field"),
                            "Recorded value": (
                                "(blank)"
                                if cell.get("rawValue") in (None, "")
                                else str(cell.get("rawValue"))
                            ),
                            "Source cell": cell.get("sourceCell"),
                        }
                        for cell in report.get("cells", [])
                    ]
                )


def render_fees(detail: dict[str, Any], actor: dict[str, Any]) -> None:
    ui.page_header(
        "Fees and receipts",
        "Invoices, payments and receipts for this term.",
        eyebrow="Fees",
    )
    invoices = detail.get("invoices") or []
    if not invoices:
        ui.empty_state("No fee records", "Invoices will appear here once issued.", "🧾")
        return
    billed = sum(int(row.get("amount_paise") or 0) for row in invoices)
    paid = sum(int(row.get("paid_paise") or 0) for row in invoices)
    ui.kpi_row(
        [
            {
                "label": "Billed",
                "value": money(billed),
                "icon": ":material/receipt_long:",
            },
            {"label": "Paid", "value": money(paid), "icon": ":material/paid:"},
            {
                "label": "Balance",
                "value": money(max(0, billed - paid)),
                "icon": ":material/account_balance_wallet:",
            },
        ]
    )
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
                "Due": labels.nice_date(row.get("due_on")),
                "Status": labels.status_label(row.get("status")),
            }
            for row in invoices
        ]
    )
    if actor.get("role") == "parent":
        ui.section("Record a payment", icon=":material/credit_card:")
        st.info(
            "No money is collected here. This records a payment attempt against the displayed balance.",
            icon=":material/info:",
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
        ui.section("Payment ledger", icon=":material/history:")
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
                    "Date": labels.nice_time(tx.get("created_at")),
                    "Amount": money(tx.get("amount_paise")),
                    "Status": labels.status_label(tx.get("status")),
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
    content = "AURA payment receipt\n" + "\n".join(
        f"{label}: {item}" for label, item in fields if item is not None
    )
    with ui.card("receipt"):
        head, amount = st.columns([3, 2], vertical_alignment="center")
        with head:
            st.html('<p class="aura-eyebrow">Payment receipt</p>')
            st.subheader(str(receipt.get("receiptId") or "Receipt"), anchor=False)
        with amount:
            st.metric("Amount recorded", money(receipt.get("amountPaise")))
        left, right = st.columns(2)
        shown = [
            (label, content_value)
            for label, content_value in fields
            if content_value is not None and label not in {"Receipt", "Amount recorded"}
        ]
        for index, (label, item) in enumerate(shown):
            with left if index % 2 == 0 else right:
                st.caption(label)
                st.markdown(f"**{ui._md_safe(item)}**")
        st.download_button(
            "Download receipt",
            content,
            file_name=f"receipt-{receipt.get('receiptId', 'record')}.txt",
            mime="text/plain",
            on_click="ignore",
            icon=":material/download:",
        )


def render_parent_records(
    overview: dict[str, Any], actor: dict[str, Any], page: str
) -> None:
    children = overview.get("children") or []
    if not children:
        ui.page_header("Family workspace", eyebrow="Parent")
        ui.empty_state(
            "No linked student",
            "A student record has not been linked to this account yet.",
            "👪",
        )
        return
    if len(children) > 1:
        child_id = select_id(
            "Student", children, person_id, display_name, key="parent_child"
        )
    else:
        child_id = person_id(children[0])
    if not child_id:
        return
    detail = load("student", {"studentId": child_id})
    student = detail.get("student") or {}
    child_name = display_name(student).title()
    if page == "Overview":
        ui.page_header(
            f"{child_name}'s progress",
            "Attendance, results, mentor updates and fees shared with your family.",
            eyebrow="Family workspace",
        )
        courses = detail.get("courses") or []
        attendance_avg = average([percent(row.get("percentage")) for row in courses])
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
                    "label": "Open fee balance",
                    "value": money(
                        sum(
                            max(
                                0,
                                int(i.get("amount_paise") or 0)
                                - int(i.get("paid_paise") or 0),
                            )
                            for i in detail.get("invoices", [])
                        )
                    ),
                    "icon": ":material/account_balance_wallet:",
                },
            ]
        )
        render_support_cards(detail.get("support") or [], audience="family")
        if courses:
            ui.section("Courses", "Attendance and results recorded so far this term.")
            render_course_cards(courses)
        render_mentor_updates(detail.get("followups") or [])
    elif page == "Child records":
        ui.page_header(
            f"{child_name}'s records",
            "Attendance, marks and results available to your family account.",
            eyebrow="Family workspace",
        )
        render_academic_records(detail, heading=False)
    elif page == "Fees and receipts":
        render_fees(detail, actor)


def render_followups(overview: dict[str, Any]) -> None:
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
                "Student": r.get("student_name"),
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
    selected = st.selectbox(
        "Follow-up to edit",
        choices,
        format_func=lambda row: (
            "Create a follow-up"
            if row is None
            else f"{row.get('student_name', 'Student')} · due {labels.nice_date(row.get('due_on'))}"
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
            "No courses in your scope", "Assigned courses will appear here.", "🏫"
        )
        return
    classroom = load("classroom", {"offeringId": offering_id})
    course = classroom.get("course") or {}
    roster = classroom.get("roster") or []
    sessions = classroom.get("sessions") or []
    assessments = classroom.get("assessments") or []
    ui.kpi_row(
        [
            {"label": "Students", "value": len(roster), "icon": ":material/groups:"},
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
            "The roster is empty", "Registered students will appear here.", "👥"
        )
        return
    tab_attendance, tab_marks, tab_results = st.tabs(
        [
            ":material/event_available: Attendance",
            ":material/grading: Marks",
            ":material/workspace_premium: Results",
        ]
    )
    with tab_attendance:
        render_attendance_editor(offering_id, roster, sessions)
    with tab_marks:
        render_marks_editor(offering_id, roster, assessments)
    with tab_results:
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
    selected_session = st.selectbox(
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


SCORING_FIELDS = {
    "attendanceWeight": ("Attendance weight (points)", 20, 0),
    "markWeight": ("Marks weight (points)", 20, 0),
    "inactivityWeight": ("LMS inactivity weight (points)", 20, 0),
    "overdueWeight": ("Overdue assignments weight (points)", 10, 0),
    "internshipWeight": ("Internship weight (points)", 15, 0),
    "placementWeight": ("Placement weight (points)", 15, 0),
    "overdueMinimum": ("Overdue assignments that trigger a signal", 1, 1),
    "internshipMinimum": ("Missed internship milestones that trigger a signal", 1, 1),
    "placementMinimum": ("Missed placement activities that trigger a signal", 1, 1),
}


def render_policy_form() -> None:
    ui.section(
        "Approve a mentor policy",
        "These thresholds and weights are exactly what reviews will apply. Only faculty can approve them.",
        icon=":material/rule:",
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
        st.markdown("##### Signal weights and count thresholds")
        st.caption(
            "Weights are the points each signal adds to the composite risk score."
        )
        weight_cols = st.columns(3)
        for index, (field, (label, default, minimum)) in enumerate(
            SCORING_FIELDS.items()
        ):
            with weight_cols[index % 3]:
                scoring[field] = st.number_input(
                    label,
                    min_value=minimum,
                    max_value=100,
                    value=default,
                    step=1,
                    key=f"policy_{field}",
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
                    f"{SCORING_FIELDS[key][0].replace(' (points)', '')}: {policy.get(key, 'Not recorded')}"
                    for key in SCORING_FIELDS
                ),
                "owner": value(row, "faculty_person_id", "facultyPersonId"),
            }
        )
    return output


def student_name_map(review: dict[str, Any]) -> dict[str, str]:
    return {
        str(value(row, "id", "student_id", default="")): str(
            value(row, "display_name", "name", default="Student")
        )
        for row in review.get("students") or []
        if value(row, "id", "student_id")
    }


def render_policies(review: dict[str, Any], actor: dict[str, Any]) -> None:
    policies = policy_rows(review.get("policies") or [])
    ui.section(
        "Approved mentor policies",
        "Every review applies one of these faculty-approved policies. Reviews cannot run without one.",
        icon=":material/policy:",
    )
    dataframe(
        [
            {k: v for k, v in row.items() if k not in {"id", "owner"}}
            for row in policies
        ],
        empty="No policy has been approved yet.",
    )
    if actor.get("role") == "faculty":
        with ui.card("policy_form"):
            render_policy_form()
    else:
        st.caption(
            ":material/lock: Only the assigned faculty mentor can approve a scoring policy."
        )


def render_plan_workbench(review: dict[str, Any], actor: dict[str, Any]) -> None:
    raw_policies = review.get("policies") or []
    policies = policy_rows(raw_policies)
    role = actor.get("role")
    students = review.get("students") or []
    names = student_name_map(review)
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
    policy_by_id = {row["id"]: row for row in policies if row["id"]}
    plans = review.get("plans") or []
    st.caption(
        ":material/route: **How a review runs:** describe it → answer the coordinator's questions → "
        "lock the plan → run the agents → decide each draft in the review queue."
    )
    if role in {"faculty", "hod", "governance"}:
        with st.expander(
            "Create a review plan",
            expanded=not plans,
            icon=":material/add_circle:",
        ):
            with st.form("create_plan", border=False):
                request_text = st.text_area(
                    "Review request",
                    max_chars=2000,
                    placeholder="For example: check my mentees whose attendance dropped this month.",
                )
                chosen_students = st.multiselect(
                    "Students in scope",
                    student_options,
                    format_func=lambda item: student_labels.get(item, item),
                    max_selections=50,
                )
                left, middle, right = st.columns(3)
                with left:
                    domain = st.selectbox(
                        "Review focus",
                        [None, *PLAN_DOMAINS],
                        format_func=lambda item: (
                            "Choose a focus"
                            if item is None
                            else labels.domain_label(item)
                        ),
                    )
                with middle:
                    policy_id = st.selectbox(
                        "Approved mentor policy",
                        [None, *policy_by_id.keys()],
                        format_func=lambda item: (
                            "Choose an approved policy"
                            if item is None
                            else policy_by_id[item]["Policy version"]
                        ),
                    )
                with right:
                    modes = ["deterministic"] + (
                        ["model"] if review.get("modelConfigured") else []
                    )
                    mode = st.selectbox(
                        "Execution mode",
                        modes,
                        format_func=lambda item: (
                            "Rule-based review"
                            if item == "deterministic"
                            else "AI model review"
                        ),
                    )
                feedback = st.text_area("Planning notes", max_chars=1000)
                submitted = st.form_submit_button(
                    "Save review plan", type="primary", icon=":material/save:"
                )
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

    if not plans:
        ui.empty_state(
            "No review plans yet",
            "Create a plan above. The coordinator will ask for anything it needs before the plan can be locked.",
            "🧭",
        )
        return
    plan_options = [row for row in plans if row.get("id")]
    plan_by_id = {row["id"]: row for row in plan_options}
    ids = list(plan_by_id)
    prior = st.session_state.get("review_selected_id")
    selector_revision = st.session_state.get("review_plan_selector_revision", 0)
    default_index = st.session_state.setdefault(
        f"review_plan_default_{selector_revision}",
        ids.index(prior) if prior in ids else 0,
    )
    selected_id = st.selectbox(
        "Plan",
        ids,
        index=min(default_index, len(ids) - 1),
        format_func=lambda key: (
            f"{plan_by_id[key]['body']['request'][:70]} · {labels.status_label(plan_by_id[key]['status'])} · {labels.short_ref(key)}"
        ),
        key=f"review_plan_{selector_revision}",
    )
    selected_plan = plan_by_id[selected_id]
    st.session_state["review_selected_id"] = selected_id
    body = selected_plan.get("body") or {}
    questions = body.get("questions") or []
    review_jobs = [
        row
        for row in review.get("jobs", [])
        if str(value(row, "plan_id", "planId", default=""))
        == str(selected_plan.get("id"))
    ]

    with ui.card(f"plan_{selected_id}"):
        title, status = st.columns([4, 1.5], vertical_alignment="center")
        with title:
            st.markdown(
                f"#### {ui._md_safe(body.get('request', 'Review request not recorded'))}"
            )
        with status:
            st.markdown(
                ui.status_md(selected_plan.get("status"))
                + (
                    " " + ui.badge_md("Paused", "orange", ":material/pause:")
                    if selected_plan.get("paused")
                    else ""
                )
            )
        facts = st.columns(4)
        facts[0].caption("Focus")
        facts[0].markdown(
            f"**{labels.domain_label(body.get('domain')) if body.get('domain') else '—'}**"
        )
        facts[1].caption("Policy")
        facts[1].markdown(
            f"**{ui._md_safe(policy_by_id.get(body.get('policyId'), {}).get('Policy version', '—'))}**"
        )
        facts[2].caption("Students")
        facts[2].markdown(f"**{len(body.get('studentIds') or [])}**")
        facts[3].caption("Mode")
        facts[3].markdown(f"**{labels.mode_label(body.get('mode'))}**")
        if questions:
            st.warning(
                "Complete these details before locking the plan: "
                + " ".join(questions),
                icon=":material/help:",
            )
        steps = body.get("steps", [])
        if steps:
            with st.expander("Planned steps", icon=":material/format_list_numbered:"):
                for number, step in enumerate(steps, 1):
                    st.markdown(f"{number}. {ui._md_safe(step)}")
        render_planner_trace(body)
        ui.tech_details(
            [
                ("Plan reference", selected_plan.get("id")),
                ("Revision", selected_plan.get("revision")),
            ]
        )

    if selected_plan.get("status") != "locked":
        with st.expander(
            "Answer questions or revise this plan",
            expanded=bool(questions),
            icon=":material/edit:",
        ):
            with st.form(
                f"revise_plan_{selected_id}_{selected_plan['revision']}", border=False
            ):
                revised_request = st.text_area(
                    "Revised review request",
                    value=body.get("request", ""),
                    max_chars=2000,
                )
                revised_students = st.multiselect(
                    "Revised students in scope",
                    student_options,
                    default=[
                        sid
                        for sid in body.get("studentIds", [])
                        if sid in student_options
                    ],
                    format_func=lambda sid: student_labels.get(sid, sid),
                    max_selections=50,
                )
                left, middle, right = st.columns(3)
                focuses = [None, *PLAN_DOMAINS]
                with left:
                    revised_focus = st.selectbox(
                        "Revised focus",
                        focuses,
                        index=focuses.index(body.get("domain")),
                        format_func=lambda item: (
                            labels.domain_label(item) if item else "Choose a focus"
                        ),
                    )
                policy_ids = [None, *policy_by_id]
                with middle:
                    revised_policy = st.selectbox(
                        "Revised policy",
                        policy_ids,
                        index=policy_ids.index(body.get("policyId"))
                        if body.get("policyId") in policy_ids
                        else 0,
                        format_func=lambda item: (
                            policy_by_id[item]["Policy version"]
                            if item
                            else "Choose a policy"
                        ),
                    )
                with right:
                    revised_mode = st.selectbox(
                        "Revised mode",
                        ["deterministic", "model"],
                        index=1 if body.get("mode") == "model" else 0,
                        format_func=lambda item: (
                            "AI model review"
                            if item == "model"
                            else "Rule-based review"
                        ),
                    )
                revised_feedback = st.text_area(
                    "Revision feedback",
                    value=body.get("feedback", ""),
                    max_chars=1000,
                    help="Use the fields above to adjust the review. With AI model review, the planner also reads plain-English feedback "
                    "(for example: leave out final-years, focus on attendance). Notes help focus the planned steps and reference retrieval.",
                )
                revise = st.form_submit_button("Save revised plan", type="primary")
            if revise:
                revision_input = {
                    "request": revised_request,
                    "feedback": revised_feedback,
                    "mode": revised_mode,
                }
                if revised_students:
                    revision_input["studentIds"] = revised_students
                if revised_focus:
                    revision_input["domain"] = revised_focus
                if revised_policy:
                    revision_input["policyId"] = revised_policy
                save_action(
                    "plan_revise",
                    {
                        "planId": selected_id,
                        "expectedRevision": selected_plan["revision"],
                        "input": revision_input,
                    },
                    "Answers saved to the same plan as a new revision.",
                )

    action_col, export_col = st.columns([2, 1], vertical_alignment="bottom")
    with action_col:
        if selected_plan.get("status") == "locked":
            paused = bool(selected_plan.get("paused"))
            with st.form(
                f"pause_form_{selected_id}_{selected_plan['revision']}", border=False
            ):
                reason_col, button_col = st.columns([3, 1], vertical_alignment="bottom")
                with reason_col:
                    reason = st.text_input("Pause or resume reason")
                with button_col:
                    change_pause = st.form_submit_button(
                        "Resume review" if paused else "Pause review",
                        icon=":material/play_arrow:" if paused else ":material/pause:",
                        width="stretch",
                    )
            if change_pause:
                if len(reason.strip()) < 5:
                    st.error("Enter a reason of at least five characters.")
                else:
                    save_action(
                        "plan_pause",
                        {
                            "planId": selected_id,
                            "expectedRevision": selected_plan["revision"],
                            "paused": not paused,
                            "reason": reason.strip(),
                        },
                        "Review resumed." if paused else "Review paused.",
                    )
            if paused:
                st.warning(
                    "This review is paused. Resume before running.",
                    icon=":material/pause_circle:",
                )
            st.caption(
                ":material/lock: This plan is locked. Its saved scope and policy cannot be edited."
            )
            if st.button(
                "Run review",
                type="primary",
                key=f"run_{selected_plan['id']}",
                disabled=bool(selected_plan.get("paused")),
                icon=":material/smart_toy:",
            ):
                save_action(
                    "plan_execute",
                    {"planId": selected_plan["id"]},
                    "Review run recorded. Saved activity has been refreshed.",
                )
        elif selected_plan.get("status") != "locked" and not questions:
            if st.button(
                "Lock review plan",
                type="primary",
                key=f"lock_{selected_plan['id']}",
                icon=":material/lock:",
            ):
                save_action(
                    "plan_lock",
                    {
                        "planId": selected_plan["id"],
                        "expectedRevision": int(selected_plan.get("revision", 0)),
                    },
                    "Review plan locked.",
                )
    with export_col:
        if st.button(
            "Prepare evidence export",
            key=f"export_{selected_plan['id']}",
            icon=":material/inventory:",
            width="stretch",
        ):
            exported = load("plan_export", {"planId": selected_plan["id"]})
            st.download_button(
                "Download review evidence",
                json.dumps(exported, ensure_ascii=False, indent=2),
                file_name=f"review-{selected_plan['id']}.json",
                mime="application/json",
                key=f"download_{selected_plan['id']}",
                on_click="ignore",
                icon=":material/download:",
                width="stretch",
            )

    if not review_jobs:
        return
    ui.section(
        "Agent run",
        "Each student moves through the coordinator, four data agents, risk analysis, retrieval, drafting and validation, then stops at the mentor gate.",
        icon=":material/hub:",
    )
    traced = [job for job in review_jobs if job.get("node_trace")]
    if traced:
        trace_job = traced[0]
        if len(traced) > 1:
            trace_id = st.selectbox(
                "Show agent trace for",
                [str(job["id"]) for job in traced],
                format_func=lambda jid: names.get(
                    str(
                        next(j for j in traced if str(j["id"]) == jid).get("student_id")
                    ),
                    "Student",
                ),
                key=f"trace_{selected_id}",
            )
            trace_job = next(job for job in traced if str(job["id"]) == trace_id)
        ui.pipeline_stepper(trace_job.get("node_trace"))
    dataframe(
        [
            {
                "Student": names.get(str(row.get("student_id")), "Student"),
                "Status": labels.status_label(row.get("status")),
                "Stage": labels.status_label(row.get("stage")),
                "Mode": labels.mode_label(row.get("mode")),
                "Issue": labels.issue_label(row.get("error_code")),
            }
            for row in review_jobs
        ]
    )
    for job in review_jobs:
        if job.get("status") == "needs_human":
            who = names.get(str(job.get("student_id")), "A student")
            ui.gate_banner(
                f"{who}: the repair or execution budget is exhausted, so nothing was advanced. Review the diagnosis before creating another review.",
                title="Needs your decision",
            )
            with st.expander("Diagnosis", icon=":material/troubleshoot:"):
                render_diagnoses(job.get("failure_diagnosis"))
                st.json(job.get("failure_diagnosis") or {})
            if job.get("offered_template"):
                with st.expander(
                    "Rule template offered for human consideration",
                    icon=":material/description:",
                ):
                    st.caption(
                        "This template has not advanced to approval or publication."
                    )
                    st.json(job["offered_template"])
    for job in review_jobs:
        if job.get("retrieval"):
            with st.expander(
                f"Similar past support · {names.get(str(job.get('student_id')), 'Student')}",
                icon=":material/travel_explore:",
            ):
                st.caption(
                    "Prior cases are restricted to this account's student scope and reduced to approved action categories."
                )
                dataframe(
                    [
                        {
                            "Reference": labels.short_ref(ref["id"]),
                            "Tags": ", ".join(
                                labels.domain_label(t) for t in ref["tags"]
                            ),
                            "Similarity": round(ref["similarity"], 3),
                            "Summary": ref["text"],
                        }
                        for ref in job["retrieval"]
                    ],
                    column_config={
                        "Similarity": st.column_config.ProgressColumn(
                            "Similarity", min_value=0, max_value=1, format="%.2f"
                        )
                    },
                )
    for job in review_jobs:
        if job.get("source_timings"):
            with st.expander(
                f"Data agent timings · {names.get(str(job.get('student_id')), 'Student')}",
                icon=":material/timer:",
            ):
                st.caption(
                    "The four data agents read one shared database snapshot concurrently."
                )
                dataframe(
                    [
                        {
                            "Data agent": labels.source_label(name),
                            "Milliseconds": round(elapsed, 2),
                        }
                        for name, elapsed in job["source_timings"].items()
                    ]
                )


def render_composite_risk(review: dict[str, Any], actor: dict[str, Any]) -> None:
    if actor.get("role") != "faculty":
        return
    ui.section(
        "Composite risk view",
        "Scores combine the four signals using your approved policy. A flag only opens a review path; it is never a label.",
    )
    rows = review.get("riskView") or []
    plan_options = {
        p["id"]: (p.get("body") or {}).get("request", "Review plan")
        for p in review.get("plans", [])
    }
    filter_col, toggle_col = st.columns([3, 1], vertical_alignment="bottom")
    with filter_col:
        plan_filter = st.selectbox(
            "Risk cycle",
            [None, *plan_options],
            format_func=lambda item: (
                "All assigned cycles" if item is None else plan_options[item]
            ),
            key="risk_cycle",
        )
    with toggle_col:
        flagged_only = st.checkbox("Flagged students only", key="risk_flagged")
    scoped = [
        row
        for row in rows
        if (not plan_filter or row.get("planId") == plan_filter)
        and (not flagged_only or row.get("flagged"))
    ]
    evaluated = [row for row in scoped if row.get("score") is not None]
    ui.kpi_row(
        [
            {
                "label": "Evaluated",
                "value": len(evaluated),
                "icon": ":material/fact_check:",
            },
            {
                "label": "Flagged for review",
                "value": sum(1 for row in scoped if row.get("flagged")),
                "icon": ":material/flag:",
            },
            {
                "label": "High band",
                "value": sum(1 for row in scoped if row.get("band") == "high"),
                "icon": ":material/priority_high:",
            },
            {
                "label": "Medium band",
                "value": sum(1 for row in scoped if row.get("band") == "medium"),
                "icon": ":material/trending_up:",
            },
        ]
    )
    dataframe(
        [
            {
                "Student": row["studentName"],
                "Register number": row["registerNumber"],
                "Score": row["score"],
                "Band": labels.risk_label(row["band"]),
                "Status": labels.status_label(row["status"]),
                "Contributing signals": ", ".join(
                    labels.signal_label(signal["code"]) for signal in row["signals"]
                ),
            }
            for row in scoped
        ],
        empty="No evaluated students match these filters.",
        column_config={
            "Score": st.column_config.ProgressColumn(
                "Score", min_value=0, max_value=100, format="%d"
            )
        },
    )
    flagged = [row for row in scoped if row.get("flagged")]
    if flagged:
        st.markdown("##### Why each student was flagged")
    for row in flagged:
        with st.expander(
            f"{row['studentName']} · {labels.risk_label(row['band'])} · score {row['score']}",
            icon=":material/flag:",
        ):
            st.markdown(ui.risk_md(row.get("band"), row.get("score")))
            ui.html_block(ui.signal_chips(row["signals"]))
            ui.plain_text(row["reviewPath"], muted=True)
            dataframe(
                [
                    {
                        "Signal": labels.signal_label(signal["code"]),
                        "Source": labels.source_label(signal["source"]),
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
    ui.section(
        "Intervention outcomes",
        "Approved plans, what happened next, and the immutable history of every decision.",
        icon=":material/timeline:",
    )
    if not plans:
        ui.empty_state(
            "No approved plans yet",
            "Plans appear here after a mentor approves a draft.",
            "📋",
        )
        return
    ui.kpi_row(
        [
            {
                "label": "Approved plans",
                "value": len(plans),
                "icon": ":material/verified:",
            },
            {
                "label": "In progress",
                "value": sum(1 for row in plans if row.get("status") == "in_progress"),
                "icon": ":material/pending:",
            },
            {
                "label": "Completed",
                "value": sum(1 for row in plans if row.get("status") == "completed"),
                "icon": ":material/task_alt:",
            },
            {
                "label": "Withdrawn",
                "value": sum(1 for row in plans if row.get("status") == "withdrawn"),
                "icon": ":material/undo:",
            },
        ]
    )
    log_rows = [
        {
            "Student": row.get("display_name"),
            "Approved actions": "; ".join(
                action.get("label", "")
                for action in (row.get("plan") or {}).get("actions", [])
            ),
            "Status": labels.status_label(row.get("status")),
            "Outcome": row.get("outcome"),
            "Visible": "Yes" if row.get("visible_to_student") else "No",
            "Decision": labels.status_label(row.get("decision")),
            "Decided by": row.get("decided_by"),
            "Decision time": labels.nice_time(row.get("decided_at")),
            "Rationale": row.get("rationale"),
        }
        for row in plans
    ]
    log_rows.extend(
        {
            "Student": event.get("student_name"),
            "Approved actions": "",
            "Status": labels.status_label((event.get("payload") or {}).get("status")),
            "Outcome": (event.get("payload") or {}).get("outcome"),
            "Visible": "Recorded event",
            "Decision": labels.humanize(event.get("event_type")),
            "Decided by": event.get("actor_name"),
            "Decision time": labels.nice_time(event.get("occurred_at")),
            "Rationale": "Immutable intervention history",
        }
        for event in queue.get("interventionLog", [])
    )
    log_head, log_button = st.columns([3, 1], vertical_alignment="bottom")
    with log_head:
        st.markdown("##### Intervention log")
    with log_button:
        st.download_button(
            "Download intervention log CSV",
            pd.DataFrame(log_rows).to_csv(index=False),
            file_name="intervention-log.csv",
            mime="text/csv",
            on_click="ignore",
            icon=":material/download:",
            width="stretch",
        )
    dataframe(log_rows)
    if actor.get("role") != "faculty":
        return
    with ui.card("intervention_update"):
        st.markdown("##### Update an intervention")
        selected = st.selectbox(
            "Intervention",
            plans,
            format_func=lambda row: (
                f"{row.get('display_name', 'Student')} · {labels.status_label(row.get('status', 'planned'))}"
            ),
            key="intervention_plan",
        )
        versions = [
            v
            for v in queue.get("versions", [])
            if v["support_plan_id"] == selected["id"]
        ]
        if versions:
            st.caption(":material/history: Approved publication history")
            dataframe(
                [
                    {
                        "Version": v["version"],
                        "Published": labels.nice_time(v["created_at"]),
                        "Reference": labels.short_ref(v["content_hash"], 10),
                    }
                    for v in versions
                ]
            )
            restore_cols = st.columns(min(len(versions), 4))
            for index, version in enumerate(versions):
                with restore_cols[index % len(restore_cols)]:
                    if st.button(
                        f"Restore version {version['version']}",
                        key=f"restore_{selected['id']}_{version['version']}",
                        icon=":material/restore:",
                        width="stretch",
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
        with st.form("record_outcome", border=False):
            status = st.selectbox(
                "Status",
                statuses,
                index=statuses.index(current) if current in statuses else 0,
                format_func=lambda item: (
                    "Withdraw plan"
                    if item == "withdrawn"
                    else labels.status_label(item)
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


def check_line(name: str, result: Any) -> str:
    label = CHECK_LABELS.get(name, labels.humanize(name))
    if result is True:
        return f":green[:material/check_circle:] {label}"
    if result is False:
        return f":red[:material/cancel:] {label}"
    return f":gray[:material/remove_circle_outline:] {label} · not recorded for this version"


def render_planner_trace(body: dict[str, Any]) -> None:
    """How the planner agent read the request: tool calls, turns, provider, fallback."""
    agent = body.get("agent")
    if not isinstance(agent, dict):
        return
    with st.expander("How the planner read this request", icon=":material/psychology:"):
        rows = agent_rows(agent, "Planner", "Rule-based parser (tools not used)")
        source = agent.get("questionSource")
        if source:
            rows.append(
                {
                    "Step": "Questions came from",
                    "Detail": {
                        "model": "the planner model, about this request",
                        "model+rules": "the planner model, topped up by the standard rule questions",
                        "rules": "the standard rule questions (the model path was not used)",
                    }.get(str(source), labels.humanize(source)),
                }
            )
        criteria = body.get("filter")
        names = {
            "allMine": "all my mentees",
            "semesterMin": "from semester",
            "semesterMax": "up to semester",
            "attendanceBelowPct": "attendance below (%)",
            "markBelowPct": "marks below (%)",
        }
        if isinstance(criteria, dict) and criteria:
            rows.append(
                {
                    "Step": "Student criteria",
                    "Detail": ", ".join(
                        names.get(str(k), labels.humanize(k))
                        + ("" if v is True else f" {v}")
                        for k, v in criteria.items()
                    ),
                }
            )
        dataframe(rows)
        render_tool_calls(agent)
        understood = body.get("agentSteps") or []
        if understood:
            st.markdown("**What the planner understood**")
            for number, step in enumerate(understood, 1):
                st.markdown(f"{number}. {ui._md_safe(step)}")
        st.caption(
            "The planner only drafts. It resolves students from your own scope on the server, "
            "and you decide when the plan is locked and run."
        )


def provenance_rows(validation: dict[str, Any], mode: Any, model_id: Any) -> list[dict[str, str]]:
    """Plain-text rows describing how a draft was produced (mentor/governance only)."""
    prov = validation.get("provenance") if isinstance(validation, dict) else None
    if not isinstance(prov, dict):
        return [
            {"Step": "Drafted by", "Detail": f"{labels.mode_label(mode)}{' · ' + str(model_id) if model_id else ''}"},
            {"Step": "Trace", "Detail": "Recorded before provider tracing (packet v1)"},
        ]
    egress = [e for e in prov.get("egress") or [] if isinstance(e, dict)]
    sent = [e for e in egress if e.get("outcome") == "sent"]
    blocked = [e for e in egress if e.get("outcome") == "blocked"]
    rows = [
        {"Step": "Provider", "Detail": labels.provider_label(prov.get("provider")) if prov.get("provider") else labels.mode_label(mode)},
        {"Step": "Model", "Detail": str(prov.get("model") or "none (rule-based)")},
        {"Step": "Specialist", "Detail": labels.domain_label(prov.get("specialist"))},
        {"Step": "Packet format", "Detail": str(validation.get("packetSchema") or "packet-v1")},
        {"Step": "Repairs", "Detail": str(prov.get("repairs", len(validation.get("repairs") or [])))},
        {"Step": "Fallback reason", "Detail": str(prov.get("fallbackReason") or "none")},
    ]
    for fallback in prov.get("fallbacks") or []:
        rows.append({"Step": "Provider skipped", "Detail": f"{labels.provider_label(fallback.get('provider'))} {fallback.get('model', '')}: {fallback.get('reason', '')}"})
    if prov.get("tokens"):
        rows.append({"Step": "Tokens reported", "Detail": str(prov.get("tokens"))})
    rows.append({"Step": "Remote requests", "Detail": f"{len(sent)} sent, {len(blocked)} stopped by the privacy guard" if egress else "none (local or rule-based)"})
    for item in sent[-2:]:
        rows.append({"Step": "Egress audit hash", "Detail": f"{str(item.get('payloadHash', ''))[:16]}… · {item.get('bytes', '?')} bytes · {len(item.get('fields') or [])} fields"})
    for item in blocked:
        rows.append({"Step": "Privacy guard", "Detail": f"Refused: {labels.humanize(item.get('category'))}"})
    rows.extend(agent_rows(prov.get("agent")))
    return rows


def _tool_arguments(raw: Any) -> str:
    """Aliased tool arguments as short key=value text (plain text, no markup)."""
    if not isinstance(raw, dict):
        return "—"
    parts = []
    for key, value in list(raw.items())[:6]:
        if isinstance(value, (str, int, float, bool)):
            parts.append(f"{str(key)[:24]}={str(value)[:40]}")
    return ", ".join(parts) or "—"


def agent_rows(
    agent: Any,
    label: str = "Investigator",
    fallback_text: str = "Standard evidence set (tools not used)",
) -> list[dict[str, str]]:
    """Summary rows for an agent loop: turns, tool calls, provider and any fallback."""
    if not isinstance(agent, dict):
        return []
    calls = [c for c in agent.get("toolCalls") or [] if isinstance(c, dict)]
    ok = sum(1 for c in calls if c.get("status") == "ok")
    stopped = len(calls) - ok
    used_tools = agent.get("mode") == "tools"
    budget = agent.get("budget") or {}
    rows = [
        {
            "Step": label,
            "Detail": (
                f"{'Used tools' if used_tools else fallback_text} · "
                f"{agent.get('turns', 0)} of {budget.get('maxTurns', 2)} tool turns · "
                f"{ok} of {budget.get('maxToolCalls', 4)} tool calls ran"
                + (f", {stopped} refused" if stopped else "")
            ),
        }
    ]
    if agent.get("provider"):
        rows.append(
            {
                "Step": "Agent provider",
                "Detail": f"{labels.provider_label(agent.get('provider'))} · {agent.get('model') or 'model not recorded'}",
            }
        )
    if agent.get("evidenceValues"):
        rows.append(
            {
                "Step": "Evidence added",
                "Detail": f"{agent['evidenceValues']} tool values appended to the evidence snapshot",
            }
        )
    reason = agent.get("fallbackReason") or agent.get("skippedReason")
    if reason:
        rows.append({"Step": "Agent fallback", "Detail": str(reason)})
    return rows


def tool_call_rows(agent: Any) -> list[dict[str, Any]]:
    if not isinstance(agent, dict):
        return []
    return [
        {
            "#": call.get("seq"),
            "Turn": call.get("turn"),
            "Tool": str(call.get("tool", "")),
            "Arguments": _tool_arguments(call.get("args")),
            "Outcome": "Ran"
            if call.get("status") == "ok"
            else f"Refused · {labels.humanize(call.get('code'))}"
            if call.get("status") == "refused"
            else f"Failed · {labels.humanize(call.get('code'))}",
            "Result size (bytes)": call.get("resultBytes"),
            "Result hash": str(call.get("resultHash") or "")[:12] or "—",
        }
        for call in agent.get("toolCalls") or []
        if isinstance(call, dict)
    ]


def render_tool_calls(agent: Any) -> None:
    """Tool calls the agent made (name, aliased arguments, result size), refused ones included."""
    if not isinstance(agent, dict):
        return
    rows = tool_call_rows(agent)
    if rows:
        dataframe(rows)
        st.caption(
            "Arguments are aliases and numbers only. Results are stored as a hash and a size; "
            "the numbers they returned sit in the evidence snapshot under their own paths."
        )
    elif agent.get("mode") == "tools":
        st.caption(":material/search_off: The agent asked for no look-ups beyond the standard evidence.")


def repair_diagnosis_rows(validation: Any) -> tuple[list[dict[str, str]], bool]:
    """One row per diagnosed failure, tagged with its repair attempt (Brief 16-lite).

    Older reports have no stored diagnoses, so each row falls back to the plain wording
    of its failed check; the flag says so.
    """
    attempts = validation.get("repairs") if isinstance(validation, dict) else None
    rows: list[dict[str, str]] = []
    fallback = False
    for item in attempts or []:
        found, used_fallback = labels.diagnosis_rows(item)
        fallback = fallback or used_fallback
        rows.extend({"Attempt": str(item.get("attempt", "—")), **row} for row in found)
    return rows, fallback


DIAGNOSIS_FALLBACK_NOTE = (
    "Recorded before targeted diagnoses were stored, so this shows the standard wording "
    "for each failed check."
)


def render_diagnoses(validation: Any) -> None:
    """Targeted diagnoses: every repair attempt, then the latest open ones."""
    if not isinstance(validation, dict):
        return
    rows, fallback = repair_diagnosis_rows(validation)
    latest, latest_fallback = labels.diagnosis_rows(validation)
    rows.extend({"Attempt": "Latest", **row} for row in latest)
    if not rows:
        return
    dataframe(rows)
    st.caption(
        DIAGNOSIS_FALLBACK_NOTE
        if fallback or latest_fallback
        else "Each fix request names the failing part by code and position, with evidence references only: no names, dates or draft text."
    )


def render_draft_provenance(selected: dict[str, Any], validation: dict[str, Any]) -> None:
    with st.expander("How this draft was produced", icon=":material/route:"):
        dataframe(provenance_rows(validation, selected.get("mode"), selected.get("model_id")))
        render_tool_calls(((validation or {}).get("provenance") or {}).get("agent"))
        st.caption(
            "Remote models receive anonymised numbers only (case alias, values, thresholds, course aliases); "
            "aliases are restored on the server after validation."
        )


def render_draft_reviews(
    queue: dict[str, Any],
    actor: dict[str, Any],
    risk_by_student: dict[str, dict[str, Any]],
) -> None:
    drafts = queue.get("drafts") or []
    ui.section(
        "Support reviews",
        "Drafts the agents prepared for flagged students. Nothing reaches a student or family until you approve it.",
    )
    if not drafts:
        ui.empty_state(
            "Nothing is waiting for you",
            "When a review run drafts support for a flagged student, it appears here for your decision.",
            "✅",
        )
        return
    per_row = 3
    for start in range(0, min(len(drafts), 9), per_row):
        cols = st.columns(per_row)
        for col, row in zip(cols, drafts[start : start + per_row]):
            risk = risk_by_student.get(str(row.get("student_id"))) or {}
            with col, ui.card(f"queue_{row.get('id')}"):
                st.markdown(
                    f"**{ui._md_safe(labels.pretty_name(row.get('display_name', 'Student')))}**"
                )
                badges = [ui.status_md(row.get("status"))]
                if risk.get("band"):
                    badges.append(ui.risk_md(risk.get("band"), risk.get("score")))
                st.markdown(" ".join(badges))
                if risk.get("signals"):
                    ui.html_block(ui.signal_chips(risk["signals"][:3]))
                st.caption(
                    f":material/smart_toy: {labels.mode_label(row.get('mode'))} draft · version {row.get('revision', '?')}"
                )
    if len(drafts) > 9:
        st.caption(
            f":material/more_horiz: {len(drafts) - 9} more drafts are in the selector below."
        )
    selected = st.selectbox(
        "Draft",
        drafts,
        format_func=lambda row: (
            f"{row.get('display_name', 'Student')} · version {row.get('revision', '?')}"
        ),
        key="support_draft",
    )
    packet = selected.get("recommendation") or {}
    validation = selected.get("validation") or {}
    ui.gate_banner(
        "You are the final authority. Approving publishes this exact version to the student and their family; "
        "editing saves a new version that is validated again."
    )
    draft_col, check_col = st.columns([3, 2], gap="medium")
    with draft_col, ui.card(f"draft_{selected['id']}"):
        st.html('<p class="aura-eyebrow">Draft recommendation</p>')
        st.markdown(
            f"#### {ui._md_safe(labels.pretty_name(selected.get('display_name', 'Student')))}"
        )
        ui.plain_text(packet.get("summary") or "No summary recorded.")
        is_v2 = packet.get("schema") == "packet-v2"
        evidence_values = selected.get("evidence_values") or {}
        cited_signals = selected.get("signals") or []
        cited_policy = selected.get("policy") or {}
        if is_v2 and packet.get("rationale"):
            st.markdown("**Why this draft**")
            ui.html_block(
                "".join(
                    f'<p class="aura-claim">{ui.esc(sentence.get("text"))}</p>'
                    + ui.claim_chips(
                        sentence.get("citations"),
                        evidence_values,
                        cited_signals,
                        cited_policy,
                    )
                    for sentence in packet.get("rationale") or []
                    if isinstance(sentence, dict)
                )
            )
        if validation.get("mentorEdited"):
            st.caption(
                ":material/edit: This version includes edits by the mentor account."
            )
        actions = packet.get("actions") or []
        if actions:
            st.markdown("**Proposed actions**")
            dataframe(
                [
                    {
                        "Action": row.get("label"),
                        "Owner": ACTION_OWNER_LABELS.get(
                            row.get("owner"), labels.humanize(row.get("owner"))
                        ),
                        "Due in days": row.get("dueInDays"),
                    }
                    for row in actions
                ],
                column_config={
                    "Action": st.column_config.TextColumn("Action", width="large"),
                    "Owner": st.column_config.TextColumn("Owner", width="small"),
                    "Due in days": st.column_config.NumberColumn(
                        "Due in days", width="small"
                    ),
                },
            )
            if is_v2:
                for row in actions:
                    with st.expander(
                        ui._md_safe(row.get("label") or "Action"),
                        icon=":material/forum:",
                    ):
                        points = "".join(
                            f"<li>{ui.esc(point)}</li>"
                            for point in row.get("talkingPoints") or []
                        )
                        ui.html_block(
                            f'<p class="aura-claim">{ui.esc(row.get("personalisation"))}</p>'
                            + (
                                f'<p class="aura-eyebrow">Talking points</p><ul>{points}</ul>'
                                if points
                                else ""
                            )
                            + ui.claim_chips(
                                row.get("citations"),
                                evidence_values,
                                cited_signals,
                                cited_policy,
                            )
                        )
        if packet.get("citations"):
            st.markdown("**Evidence cited**")
            ui.citation_chips(packet.get("citations", []))
    with check_col, ui.card(f"validation_{selected['id']}"):
        st.html('<p class="aura-eyebrow">Validation report</p>')
        st.markdown(
            ui.badge_md("Passed every check", "green", ":material/verified:")
            if validation.get("valid")
            else ui.badge_md("Did not pass", "red", ":material/report:")
        )
        checks = validation.get("checks") or {}
        checks = checks if isinstance(checks, dict) else {}
        st.caption("Chapter 11 acceptance checks")
        for name in CHECK_LABELS:
            st.markdown(check_line(name, checks.get(name)))
        st.caption(
            f"Drafted by: {labels.mode_label(selected.get('mode'))}"
            + (f" · {selected.get('model_id')}" if selected.get("model_id") else "")
        )
        if validation.get("fallback"):
            st.caption(
                ":material/swap_horiz: A rule-based fallback produced this draft."
            )
        if validation.get("providerError"):
            st.caption(
                f":material/cloud_off: Model issue: {labels.issue_label(validation.get('providerError'))}"
            )
        repairs = validation.get("repairs", [])
        if repairs:
            st.caption(
                f":material/build: {len(repairs)} targeted repair attempt(s) before review."
            )
            with st.expander("Repair history", icon=":material/build:"):
                rows, fallback = repair_diagnosis_rows(validation)
                dataframe(rows, empty="No failed checks were recorded for these attempts.")
                st.caption(
                    DIAGNOSIS_FALLBACK_NOTE
                    if fallback
                    else "Only the failing parts were rewritten each time; the rest stayed as drafted."
                )
        open_rows, open_fallback = labels.diagnosis_rows(validation)
        if open_rows:
            with st.expander("Open issues", icon=":material/report:"):
                dataframe(open_rows)
                st.caption(
                    DIAGNOSIS_FALLBACK_NOTE
                    if open_fallback
                    else "The latest diagnosis of what is still wrong and the fix that was requested."
                )
        st.caption(
            "Reports describe the checks that existed when this version was recorded."
        )
        render_draft_provenance(selected, validation)
    ui.tech_details(
        [
            ("Case reference", selected.get("id")),
            ("Draft version reference", selected.get("artifact_id")),
            ("Content hash", selected.get("content_hash")),
            ("Case revision", selected.get("revision")),
        ]
    )
    if actor.get("role") != "faculty":
        st.info("This view is read-only for your role.", icon=":material/visibility:")
        return
    edit_col, decide_col = st.columns(2, gap="medium")
    with edit_col, ui.card(f"edit_{selected['id']}"):
        st.markdown("##### Edit the draft")
        with st.form(
            f"edit_draft_{selected['id']}_{selected.get('artifact_id')}", border=False
        ):
            summary = st.text_area(
                "Recommendation summary",
                value=str(packet.get("summary", "")),
                max_chars=600,
            )
            action_rows = [
                {
                    "Action": row.get("label", ""),
                    "Owner": ACTION_OWNER_LABELS.get(
                        row.get("owner"), "Assigned faculty"
                    ),
                    "Due in days": int(row.get("dueInDays", 7)),
                }
                for row in actions
            ]
            edited_actions = st.data_editor(
                pd.DataFrame(action_rows),
                column_config={
                    "Action": st.column_config.TextColumn("Action", max_chars=180),
                    "Owner": st.column_config.SelectboxColumn(
                        "Owner",
                        options=list(ACTION_OWNER_LABELS.values()),
                        required=True,
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
            edit_submitted = st.form_submit_button(
                "Save new draft version", icon=":material/edit_document:"
            )
        if edit_submitted:
            edited = edited_actions.to_dict(orient="records")
            original_codes = [row.get("code") for row in actions]
            for index, row in enumerate(edited):
                # packet-v2 keeps each action's personalisation, talking
                # points and citations; the edit is revalidated server-side.
                for key, value in (actions[index] or {}).items():
                    if key not in {"code", "label", "owner", "dueInDays"}:
                        row[key] = value
                row["code"] = original_codes[index]
                row["label"] = str(row.pop("Action", "")).strip()
                row["owner"] = {
                    label: code for code, label in ACTION_OWNER_LABELS.items()
                }.get(str(row.get("Owner", "Assigned faculty")), "assigned_faculty")
                row["dueInDays"] = int(row.get("Due in days", 7))
                row.pop("Owner", None)
                row.pop("Due in days", None)
            updated_packet = {
                **packet,
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
    with decide_col, st.container(border=True, key="gate_decision"):
        st.html(
            '<p class="aura-eyebrow" style="color:#7A4F0A">✋ Mentor decision · human gate</p>'
        )
        st.markdown("##### Approve or decline this version")
        with st.form(
            f"decide_draft_{selected['id']}_{selected.get('artifact_id')}", border=False
        ):
            decision = st.radio(
                "Decision",
                ["approved", "rejected"],
                format_func=lambda item: (
                    ":material/verified: Approve and publish"
                    if item == "approved"
                    else ":material/cancel: Do not approve"
                ),
                horizontal=True,
            )
            rationale = st.text_area("Decision rationale", max_chars=600)
            decided = st.form_submit_button(
                "Save decision", type="primary", icon=":material/gavel:"
            )
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
    role = actor.get("role")
    ui.page_header(
        "Support reviews",
        "AI agents gather evidence, score risk and draft support. You decide what reaches a student.",
        eyebrow="Mentor workspace" if role == "faculty" else "Department oversight",
    )
    review = load("review_overview")
    if role in {"faculty", "hod"}:
        queue = load("review_queue")
        risk_rows = review.get("riskView") or []
        risk_by_student = {str(row.get("studentId")): row for row in risk_rows}
        drafts = queue.get("drafts") or []
        ui.kpi_row(
            [
                {
                    "label": "Awaiting your decision"
                    if role == "faculty"
                    else "Awaiting mentors",
                    "value": len(drafts),
                    "icon": ":material/front_hand:",
                },
                {
                    "label": "Flagged students",
                    "value": sum(1 for row in risk_rows if row.get("flagged"))
                    if role == "faculty"
                    else "—",
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
                    else "Rule-based",
                    "icon": ":material/smart_toy:",
                },
            ]
        )
        tab_queue, tab_risk, tab_plans, tab_outcomes, tab_policies = st.tabs(
            [
                f":material/front_hand: Review queue ({len(drafts)})",
                ":material/monitoring: Risk view",
                ":material/hub: Plans & agent runs",
                ":material/timeline: Outcomes",
                ":material/policy: Policies",
            ]
        )
        with tab_queue:
            render_draft_reviews(queue, actor, risk_by_student)
        with tab_risk:
            if role == "faculty":
                render_composite_risk(review, actor)
            else:
                st.caption(
                    ":material/lock: Individual risk scores are visible only to each student's assigned mentor. Department trends are on the overview."
                )
        with tab_plans:
            render_plan_workbench(review, actor)
        with tab_outcomes:
            render_outcomes(queue, actor)
        with tab_policies:
            render_policies(review, actor)
    else:
        render_plan_workbench(review, actor)
        ui.section("Review operations", icon=":material/hub:")
        jobs = review.get("jobs") or []
        dataframe(
            [
                {
                    "Status": labels.status_label(row.get("status")),
                    "Stage": labels.status_label(row.get("stage")),
                    "Mode": labels.mode_label(row.get("mode")),
                    "Issue": labels.issue_label(row.get("error_code")),
                }
                for row in jobs
            ]
        )


def render_lms(actor: dict[str, Any]) -> None:
    is_student = actor.get("role") == "student"
    ui.page_header(
        "Learning",
        "Lessons, assignments and feedback for your courses."
        if is_student
        else "Publish lessons and assignments, then review submissions and give feedback.",
        eyebrow="Learning workspace · LMS",
    )
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
        ui.empty_state(
            "No courses yet",
            "Courses appear here once you are enrolled or assigned.",
            "📚",
        )
        return
    detail = load("lms_course", {"courseId": offering_id})
    course = detail.get("course") or {}
    lessons = detail.get("lessons") or []
    assignments = detail.get("assignments") or []
    submissions = detail.get("submissions") or []
    st.subheader(f"{course.get('code', '')} · {course.get('title', '')}", anchor=False)
    open_assignments = [a for a in assignments if not a.get("deadline_passed")]
    ui.kpi_row(
        [
            {
                "label": "Lessons",
                "value": len(lessons),
                "icon": ":material/auto_stories:",
            },
            {
                "label": "Assignments",
                "value": len(assignments),
                "icon": ":material/assignment:",
            },
            {
                "label": "Still open",
                "value": len(open_assignments),
                "icon": ":material/schedule:",
            },
            {
                "label": "Your submissions" if is_student else "Submissions",
                "value": len(submissions),
                "icon": ":material/upload_file:",
            },
        ]
    )
    ui.section("Lessons", icon=":material/auto_stories:")
    if not lessons:
        ui.empty_state(
            "No lessons yet", "Lessons appear here when they are published.", "📖"
        )
    for lesson in lessons:
        with st.expander(
            str(lesson.get("title", "Lesson")),
            icon=":material/article:"
            if lesson.get("published", True)
            else ":material/visibility_off:",
        ):
            if lesson.get("body"):
                ui.plain_text(lesson["body"])
            if lesson.get("material_url"):
                st.link_button(
                    "Open course material",
                    lesson["material_url"],
                    icon=":material/open_in_new:",
                )
            if lesson.get("attachment_name"):
                st.caption(
                    f":material/attach_file: {ui.code_span(lesson['attachment_name'])}"
                )
            if is_student and st.button(
                "Mark lesson as opened",
                key=f"open_lesson_{lesson['id']}",
                icon=":material/done:",
            ):
                save_action(
                    "lms_command",
                    {"action": "open-lesson", "lessonId": lesson["id"]},
                    "Lesson activity recorded.",
                )

    if not is_student:
        with st.expander("Add or update a lesson", icon=":material/post_add:"):
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
                    value=str(
                        selected_lesson.get("title", "") if selected_lesson else ""
                    ),
                    max_chars=160,
                )
                body = st.text_area(
                    "Lesson content",
                    value=str(
                        selected_lesson.get("body", "") if selected_lesson else ""
                    ),
                    max_chars=40000,
                    height=180,
                )
                material_url = st.text_input(
                    "Material link",
                    value=str(
                        selected_lesson.get("material_url", "")
                        if selected_lesson
                        else ""
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
                                    "expectedRevision": int(
                                        selected_lesson["revision"]
                                    ),
                                }
                            )
                        save_action("lms_command", payload, "Lesson saved.")

    ui.section("Assignments", icon=":material/assignment:")
    if not assignments:
        ui.empty_state(
            "No assignments yet",
            "Assignments appear here when they are published.",
            "📝",
        )
    submitted_ids = {row.get("assignment_id") for row in submissions}
    for assignment in assignments:
        passed = bool(assignment.get("deadline_passed"))
        with st.expander(
            f"{assignment.get('title', 'Assignment')} · due {labels.nice_time(assignment.get('due_at'))}",
            icon=":material/event_busy:" if passed else ":material/assignment:",
        ):
            badges = [
                ui.badge_md("Deadline passed", "red", ":material/event_busy:")
                if passed
                else ui.badge_md(
                    labels.due_phrase(assignment.get("due_at")),
                    "orange",
                    ":material/schedule:",
                )
            ]
            if is_student:
                badges.append(
                    ui.badge_md("Submitted", "green", ":material/check:")
                    if assignment.get("id") in submitted_ids
                    else ui.badge_md(
                        "Not submitted", "gray", ":material/radio_button_unchecked:"
                    )
                )
            st.markdown(" ".join(badges))
            ui.plain_text(assignment.get("instructions"))
            st.caption(
                f":material/grade: Maximum score: {assignment.get('maximum_score', 'Not recorded')}"
            )
            if assignment.get("attachment_name"):
                st.caption(
                    f":material/attach_file: {ui.code_span(assignment['attachment_name'])}"
                )
    if not is_student:
        with st.expander("Add or update an assignment", icon=":material/post_add:"):
            assignment_choices: list[dict[str, Any] | None] = [None, *assignments]
            selected_assignment = st.selectbox(
                "Assignment to edit",
                assignment_choices,
                format_func=lambda row: (
                    "New assignment"
                    if row is None
                    else str(row.get("title", "Assignment"))
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
                        selected_assignment.get("title", "")
                        if selected_assignment
                        else ""
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
                    "Due time",
                    value=initial_due.time().replace(second=0, microsecond=0),
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
        ui.section("Submit your work", icon=":material/upload_file:")
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
            st.markdown(
                ui.badge_md(
                    f"Submitted {labels.nice_time(current_submission.get('submitted_at'))}",
                    "green",
                    ":material/check:",
                )
            )
            if current_submission.get("feedback"):
                with ui.card(f"feedback_{current_submission.get('id')}"):
                    st.html('<p class="aura-eyebrow">Feedback from your teacher</p>')
                    if current_submission.get("score") is not None:
                        st.markdown(f"**Score: {current_submission.get('score')}**")
                    ui.plain_text(current_submission["feedback"])
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
            submitted = st.form_submit_button(
                "Submit assignment", type="primary", icon=":material/send:"
            )
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
        ui.section("Review submissions", icon=":material/rate_review:")
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
            submitted = st.form_submit_button(
                "Publish feedback", type="primary", icon=":material/send:"
            )
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
        ui.section("Course files", icon=":material/folder_open:")
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
                    clear_read_cache()
                    st.session_state.pop("token", None)
                    st.session_state.pop("actor", None)
                    st.warning("Your session has ended. Sign in again to continue.")
                else:
                    st.error(str(error))
            except (KeyError, TypeError, ValueError):
                st.error("The selected file could not be prepared for download.")


def rate(raw: Any) -> float | None:
    try:
        return None if raw is None else round(float(raw) * 100, 1)
    except (TypeError, ValueError):
        return None


def render_evaluation_metrics(review: dict[str, Any]) -> None:
    ui.section(
        "How the agents performed",
        "Calculated from recorded checkpoints, immutable drafts and mentor decisions. Undecided cases are excluded from decision metrics.",
        icon=":material/insights:",
    )
    metrics = review.get("metrics") or {}
    cycles = metrics.get("cycles") or []
    per_run = metrics.get("perRun") or []
    if not per_run:
        ui.empty_state(
            "No evaluated runs yet",
            "Metrics appear after the first review run is validated.",
            "📈",
        )
        return
    decided = [r for r in per_run if r.get("decision")]
    approved = [r for r in decided if r.get("decision") == "approved"]
    total = len(per_run)
    ui.kpi_row(
        [
            {
                "label": "Validation pass rate",
                "value": f"{round(100 * sum(1 for r in per_run if r.get('validationPassed')) / total)}%",
                "icon": ":material/verified:",
                "help": "Share of drafts that passed every acceptance check before mentor review.",
            },
            {
                "label": "Targeted repairs",
                "value": sum(int(r.get("repairsUsed") or 0) for r in per_run),
                "icon": ":material/build:",
            },
            {
                "label": "Escalated to a mentor",
                "value": sum(1 for r in per_run if r.get("escalated")),
                "icon": ":material/front_hand:",
            },
            {
                "label": "Approved as drafted",
                "value": f"{round(100 * sum(1 for r in approved if r.get('approveAsIs')) / len(approved))}%"
                if approved
                else "—",
                "icon": ":material/thumb_up:",
                "help": "Of approved drafts, how many mentors approved without editing.",
            },
        ]
    )
    dataframe(
        [
            {
                "Cycle": labels.short_ref(row.get("cycleId")),
                "Runs": row.get("evaluatedRuns"),
                "Pass rate": rate(row.get("validationPassRate")),
                "Repairs": row.get("repairsUsed"),
                "Fallback rate": rate(row.get("fallbackRate")),
                "Escalation rate": rate(row.get("escalationRate")),
                "AI model runs": row.get("modelRuns"),
                "Rule runs": row.get("ruleRuns"),
                "Decided": row.get("decidedRuns"),
                "Approved as drafted": rate(row.get("approveAsIsRate")),
                "Avg. decision time (min)": None
                if row.get("averageDecisionSeconds") is None
                else round(float(row["averageDecisionSeconds"]) / 60, 1),
            }
            for row in cycles
        ],
        column_config={
            name: st.column_config.NumberColumn(name, format="%.0f%%")
            for name in (
                "Pass rate",
                "Fallback rate",
                "Escalation rate",
                "Approved as drafted",
            )
        },
    )
    with st.expander("Per-run metrics", icon=":material/table_rows:"):
        dataframe(
            [
                {
                    "Run": labels.short_ref(row.get("jobId")),
                    "Cycle": labels.short_ref(row.get("cycleId")),
                    "Passed checks": "Yes" if row.get("validationPassed") else "No",
                    "Repairs": row.get("repairsUsed"),
                    "Fallback": "Yes" if row.get("fallback") else "No",
                    "Escalated": "Yes" if row.get("escalated") else "No",
                    "Mode": labels.mode_label(row.get("mode")),
                    "Decision": labels.status_label(row.get("decision"))
                    if row.get("decision")
                    else "Pending",
                    "Mentor edit distance": row.get("mentorEditDistance"),
                }
                for row in per_run
            ]
        )


TREND_SERIES = {
    "reviewed": ("Reviewed", "#1B2A4A"),
    "flagged": ("Flagged", "#6B3FA0"),
    "blocked": ("Blocked", "#B42318"),
    "awaiting_approval": ("Awaiting mentor", "#B7791F"),
    "approved": ("Approved", "#1F7A4D"),
    "completed": ("Completed", "#2F6FB0"),
    "withdrawn": ("Withdrawn", "#8A94A6"),
}
BAND_SERIES = {
    "low": ("Low", "#8A94A6"),
    "medium": ("Medium", "#6B3FA0"),
    "high": ("High", "#B42318"),
}


def trend_axis_config(chart: alt.Chart) -> alt.Chart:
    return (
        chart.configure_axis(
            labelFont="IBM Plex Sans",
            titleFont="IBM Plex Sans",
            labelColor="#4A5568",
            titleColor="#4A5568",
            gridColor="#ECE8E0",
            domainColor="#D9D4C9",
            tickColor="#D9D4C9",
        )
        .configure_legend(
            labelFont="IBM Plex Sans",
            titleFont="IBM Plex Sans",
            orient="bottom",
            labelColor="#14213D",
        )
        .configure_view(strokeWidth=0)
    )


def render_review_trends(review: dict[str, Any]) -> None:
    ui.section(
        "Support trends by review cycle",
        "Each cycle is one saved review plan. Aggregates only; no student can be identified here.",
        icon=":material/monitoring:",
    )
    rows = review.get("trends") or []
    if not rows:
        ui.empty_state(
            "No evaluated review cycles yet",
            "Trends appear after mentors run their first review.",
            "📊",
        )
        return
    evaluated = [r for r in rows if int(r.get("reviewed") or 0) > 0]
    if evaluated:
        rows = evaluated
    recent = 8
    if len(rows) > recent and not st.toggle(
        f"Show all {len(rows)} cycles", key="trend_all_cycles"
    ):
        rows = rows[-recent:]
        st.caption(f"Showing the {recent} most recent cycles with evaluated students.")
    order = [f"C{index}" for index in range(1, len(rows) + 1)]
    counts = pd.DataFrame(
        [
            {
                "Cycle": order[index],
                "Review cycle": str(r["day"]),
                "Measure": label,
                "Count": int(r.get(key, 0) or 0),
            }
            for index, r in enumerate(rows)
            for key, (label, _) in TREND_SERIES.items()
        ]
    )
    averages = pd.DataFrame(
        [
            {
                "Cycle": order[index],
                "Review cycle": str(r["day"]),
                "Band": label,
                "Average score": r.get("average_" + key),
            }
            for index, r in enumerate(rows)
            for key, (label, _) in BAND_SERIES.items()
            if r.get("average_" + key) is not None
        ]
    )
    left, right = st.columns([3, 2], gap="medium")
    with left, ui.card("trend_outcomes"):
        st.markdown("**Outcomes per cycle**")
        bars = (
            alt.Chart(counts)
            .mark_bar(cornerRadiusTopLeft=3, cornerRadiusTopRight=3)
            .encode(
                x=alt.X("Cycle:N", title=None, sort=order, axis=alt.Axis(labelAngle=0)),
                xOffset=alt.XOffset(
                    "Measure:N", sort=[v[0] for v in TREND_SERIES.values()]
                ),
                y=alt.Y("Count:Q", title="Students", axis=alt.Axis(tickMinStep=1)),
                color=alt.Color(
                    "Measure:N",
                    sort=[v[0] for v in TREND_SERIES.values()],
                    scale=alt.Scale(
                        domain=[v[0] for v in TREND_SERIES.values()],
                        range=[v[1] for v in TREND_SERIES.values()],
                    ),
                    title=None,
                ),
                tooltip=["Review cycle", "Measure", "Count"],
            )
            .properties(height=300)
        )
        st.altair_chart(trend_axis_config(bars), width="stretch")
    with right, ui.card("trend_bands"):
        st.markdown("**Average risk score by band**")
        if averages.empty:
            averages = pd.DataFrame(
                [
                    {
                        "Cycle": "C1",
                        "Review cycle": "",
                        "Band": "Low",
                        "Average score": None,
                    }
                ]
            )
        lines = (
            alt.Chart(averages)
            .mark_line(point=alt.OverlayMarkDef(size=60, filled=True), strokeWidth=2.5)
            .encode(
                x=alt.X("Cycle:N", title=None, sort=order, axis=alt.Axis(labelAngle=0)),
                y=alt.Y(
                    "Average score:Q",
                    title="Score (0–100)",
                    scale=alt.Scale(domain=[0, 100]),
                ),
                color=alt.Color(
                    "Band:N",
                    scale=alt.Scale(
                        domain=[v[0] for v in BAND_SERIES.values()],
                        range=[v[1] for v in BAND_SERIES.values()],
                    ),
                    title=None,
                ),
                tooltip=[
                    "Review cycle",
                    "Band",
                    alt.Tooltip("Average score:Q", format=".1f"),
                ],
            )
            .properties(height=300)
        )
        st.altair_chart(trend_axis_config(lines), width="stretch")
        st.caption("Gaps mean no evaluated students in that band for the cycle.")


def render_department_home(overview: dict[str, Any]) -> None:
    ui.page_header(
        "Department overview",
        "How the department's students and support reviews are doing, in aggregate.",
        eyebrow="Department head",
    )
    review = load("review_overview")
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
    render_evaluation_metrics(review)
    tab_courses, tab_students = st.tabs(
        [":material/menu_book: Courses", ":material/groups: Students"]
    )
    with tab_courses:
        dataframe(
            [
                {
                    "Course": f"{r.get('code', '')} · {r.get('title', '')}",
                    "Section": r.get("section"),
                    "Faculty": r.get("faculty_name"),
                    "Enrolled": r.get("enrolled"),
                    "Status": labels.status_label(r.get("status")),
                }
                for r in overview.get("courses", [])
            ]
        )
    with tab_students:
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


def render_agent_graph(review: dict[str, Any]) -> None:
    ui.section(
        "Agent graph",
        "The executor runs this graph for every student. Validation can regenerate at most twice; publication waits for the assigned mentor's approval of the exact draft.",
        icon=":material/account_tree:",
    )
    jobs = [job for job in review.get("jobs", []) if job.get("node_trace")]
    trace = None
    if jobs:
        job_id = st.selectbox(
            "Show node activity for run",
            [str(job["id"]) for job in jobs],
            format_func=lambda jid: (
                f"Run {labels.short_ref(jid)} · "
                f"{labels.status_label(next(j for j in jobs if str(j['id']) == jid).get('status'))}"
            ),
            key="graph_job",
        )
        selected_job = next(job for job in jobs if str(job["id"]) == job_id)
        trace = selected_job.get("node_trace")
    ui.pipeline_stepper(trace)
    if jobs:
        validation = selected_job.get("validation") or {}
        with st.expander(
            "Model calls for this run", icon=":material/smart_toy:", expanded=True
        ):
            dataframe(
                provenance_rows(
                    validation if isinstance(validation, dict) else {},
                    selected_job.get("mode"),
                    None,
                )
            )
            render_tool_calls(
                (validation.get("provenance") or {}).get("agent")
                if isinstance(validation, dict)
                else None
            )
        if isinstance(validation, dict) and (
            validation.get("repairs") or validation.get("failures") or validation.get("diagnoses")
        ):
            with st.expander(
                "Diagnosis and repairs for this run", icon=":material/troubleshoot:", expanded=True
            ):
                render_diagnoses(validation)
    if trace:
        with st.expander("Node timings", icon=":material/timer:"):
            dataframe(
                [
                    {
                        "Node": labels.node_label(node),
                        "Status": labels.NODE_STATES.get(
                            state["status"], (labels.humanize(state["status"]), "")
                        )[0],
                        "Visits": state["visits"],
                        "Milliseconds": round(state["elapsedMs"], 2),
                    }
                    for node, state in trace.items()
                ]
            )
    graph = review.get("graph") or {}
    edges = graph.get("edges") or []
    if edges:
        with st.expander(
            "Full graph with transition conditions", icon=":material/schema:"
        ):

            def node_id(raw: Any) -> str:
                return "".join(ch for ch in str(raw) if ch.isalnum()) or "Node"

            def node_text(raw: Any) -> str:
                return labels.node_label(raw).replace('"', "'")

            nodes = {edge["from"] for edge in edges} | {edge["to"] for edge in edges}
            colours = {
                "coordinator": "#1B2A4A",
                "agent": "#2F6FB0",
                "gate": "#B7791F",
                "publish": "#1F7A4D",
            }
            declarations = " ".join(
                f'{node_id(n)} [label="{node_text(n)}", color="{colours.get(labels.AGENT_NODES.get(str(n), ("", "agent"))[1], "#2F6FB0")}"];'
                for n in sorted(nodes)
            )
            links = " ".join(
                f'{node_id(edge["from"])} -> {node_id(edge["to"])} [label="{str(edge.get("condition", "")).replace(chr(34), chr(39))}"];'
                for edge in edges
            )
            st.graphviz_chart(
                "digraph AURA { rankdir=LR; bgcolor=transparent; "
                'node [shape=box, style="rounded,filled", fillcolor=white, fontname="Helvetica", fontsize=11, penwidth=2]; '
                'edge [fontname="Helvetica", fontsize=9, color="#8A94A6", fontcolor="#4A5568"]; '
                + declarations
                + " "
                + links
                + " }",
                width="stretch",
            )


def render_governance(actor: dict[str, Any]) -> None:
    ui.page_header(
        "AI activity",
        "Watch the agents work, verify recorded runs and export evidence. This workspace can observe but never decide.",
        eyebrow="Governance & audit",
    )
    review = load("review_overview")
    jobs = review.get("jobs") or []
    per_run = (review.get("metrics") or {}).get("perRun") or []
    ui.kpi_row(
        [
            {
                "label": "Recorded runs",
                "value": len(jobs),
                "icon": ":material/smart_toy:",
            },
            {
                "label": "AI model runs",
                "value": sum(1 for job in jobs if job.get("mode") == "model"),
                "icon": ":material/psychology:",
            },
            {
                "label": "Passed validation",
                "value": f"{round(100 * sum(1 for r in per_run if r.get('validationPassed')) / len(per_run))}%"
                if per_run
                else "—",
                "icon": ":material/verified:",
            },
            {
                "label": "Escalations",
                "value": sum(1 for job in jobs if job.get("status") == "needs_human"),
                "icon": ":material/front_hand:",
            },
        ]
    )
    tab_graph, tab_runs, tab_eval, tab_plans, tab_policies = st.tabs(
        [
            ":material/account_tree: Agent graph",
            ":material/history: Runs & replay",
            ":material/insights: Evaluation",
            ":material/hub: Plans",
            ":material/policy: Policies",
        ]
    )
    with tab_graph:
        render_agent_graph(review)
    with tab_runs:
        ui.section("Recorded runs", icon=":material/history:")
        dataframe(
            [
                {
                    "Run": labels.short_ref(row.get("id")),
                    "Status": labels.status_label(row.get("status")),
                    "Stage": labels.status_label(row.get("stage")),
                    "Mode": labels.mode_label(row.get("mode")),
                    "Replay record": "Available"
                    if row.get("run_id")
                    else "Not available",
                    "Issue": labels.issue_label(row.get("error_code")),
                }
                for row in jobs
            ],
            empty="No runs have been recorded yet.",
        )
        replayable = [row for row in jobs if row.get("run_id")]
        if actor.get("role") == "governance" and replayable:
            with ui.card("replay"):
                st.markdown("##### Verify a recorded run")
                st.caption(
                    "Recomputes policy and validation checks from the recorded inputs and compares hashes. It does not re-run model inference."
                )
                run_id = select_id(
                    "Completed run",
                    replayable,
                    lambda row: str(row.get("run_id", "")),
                    lambda row: (
                        f"{labels.status_label(row.get('status', 'Run'))} · {labels.nice_time(row.get('updated_at'))}"
                    ),
                    key="governance_replay_run",
                )
                if (
                    st.button(
                        "Replay saved run",
                        type="primary",
                        key="governance_replay",
                        icon=":material/replay:",
                    )
                    and run_id
                ):
                    result = save_action(
                        "replay", {"runId": run_id}, "Replay completed."
                    )
                    if result:
                        replay = result.get("replay") or {}
                        if replay.get("matched"):
                            st.success(
                                "Replay matched the saved run.",
                                icon=":material/verified:",
                            )
                        else:
                            st.warning(
                                "Replay did not match the saved run.",
                                icon=":material/report:",
                            )
                        ui.tech_details(
                            [
                                ("Input hash", replay.get("inputHash", "Not recorded")),
                                (
                                    "Output hash",
                                    replay.get("outputHash", "Not recorded"),
                                ),
                            ],
                            label="Replay hashes",
                        )
        elif actor.get("role") != "governance":
            st.info(
                "This governance workspace is read-only for your account.",
                icon=":material/visibility:",
            )
    with tab_eval:
        render_evaluation_metrics(review)
    with tab_plans:
        render_plan_workbench(review, actor)
    with tab_policies:
        render_policies(review, actor)


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
        "governance": ["AI activity", "Source records"],
        "lms": ["Learning"],
    }.get(portal, ["Overview"])


def page_label(page: str) -> str:
    return f"{PAGE_ICONS.get(page, ':material/circle:')} {page}"


def render_mentor_home(overview: dict[str, Any], actor: dict[str, Any]) -> None:
    ui.page_header(
        f"Welcome, {display_name(actor)}",
        "Your mentees, courses and the decisions waiting for you today.",
        eyebrow="Mentor workspace",
    )
    counts = overview.get("counts") or {}
    pending = value(counts, "pending_reviews", default=0)
    ui.kpi_row(
        [
            {
                "label": "Assigned students",
                "value": len(overview.get("students") or []),
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
                "label": "Reviews awaiting you",
                "value": pending,
                "icon": ":material/front_hand:",
            },
            {
                "label": "Overdue follow-ups",
                "value": value(counts, "overdue_followups", default=0),
                "icon": ":material/alarm:",
            },
        ]
    )
    if pending:
        ui.gate_banner(
            f"{pending} support draft{'s are' if pending != 1 else ' is'} waiting at the mentor gate. "
            "Open Support reviews to approve, edit or decline them.",
            title="Needs you today",
        )
    followups = overview.get("followups", [])
    ui.section("Upcoming check-ins", icon=":material/event_note:")
    dataframe(
        [
            {
                "Student": r.get("student_name"),
                "Due": labels.nice_date(r.get("due_on")),
                "When": "Overdue"
                if r.get("overdue")
                else labels.due_phrase(r.get("due_on")),
                "Note": r.get("note"),
                "Status": labels.status_label(r.get("status")),
            }
            for r in followups
        ],
        empty="No check-ins scheduled. Add one from Mentor follow-ups.",
    )


def main() -> None:
    ui.inject_styles()
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
        st.toast(success_notice, icon=":material/check_circle:")
    pages = portal_pages(portal)
    page = (
        st.sidebar.radio(
            "Workspace", pages, label_visibility="collapsed", format_func=page_label
        )
        if len(pages) > 1
        else pages[0]
    )
    sidebar_footer()

    if portal == "lms" or page == "Learning":
        render_lms(actor)
        return
    if portal == "governance" and page == "AI activity":
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
            render_mentor_home(overview, actor)
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
