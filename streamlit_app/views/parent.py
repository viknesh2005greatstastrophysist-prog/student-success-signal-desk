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
    money,
    percent,
    person_id,
    pick,
    save_action,
    select_id,
    short_time,
)
from views.student import (
    render_course_cards,
    render_mentor_updates,
    render_support_cards,
)


def render_fees(detail: dict[str, Any], actor: dict[str, Any]) -> None:
    ui.page_header(
        "Fees and receipts",
        "Invoices, payments and receipts for this term.",
        eyebrow="Fees",
    )
    invoices = detail.get("invoices") or []
    if not invoices:
        ui.empty_state("No fee records", "Invoices will appear here once issued.")
        return
    # A voided invoice (replaced by a later fee schedule) is kept in the list for the
    # record but is not part of what is billed, paid or owed.
    counted = [row for row in invoices if row.get("status") != "void"]
    billed = sum(int(row.get("amount_paise") or 0) for row in counted)
    paid = sum(int(row.get("paid_paise") or 0) for row in counted)
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
                    0
                    if row.get("status") == "void"
                    else max(
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
                scenario = pick(
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
        ("Student", labels.pretty_name(receipt.get("studentName"))),
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


def _child_context() -> tuple[dict[str, Any], dict[str, Any]] | None:
    """The linked child's record (a parent with several children picks one)."""
    actor = st.session_state.get("actor") or {}
    overview = load("overview")
    children = overview.get("children") or []
    if not children:
        ui.page_header("Family workspace", eyebrow="Parent")
        ui.empty_state(
            "No linked student",
            "A student record has not been linked to this account yet.",
        )
        return None
    ids = [person_id(c) for c in children]
    chosen = st.session_state.get("parent_child_id")
    if len(children) > 1:
        names = {person_id(c): display_name(c) for c in children}
        chosen = pick(
            "Student",
            ids,
            format_func=lambda i: names.get(i, i),
            index=ids.index(chosen) if chosen in ids else 0,
        )
    else:
        chosen = ids[0]
    st.session_state["parent_child_id"] = chosen
    return actor, load("student", {"studentId": chosen})


def overview_page() -> None:
    """The child's term at a glance, in plain words: no scores or labels."""
    context = _child_context()
    if not context:
        return
    _, detail = context
    child_name = display_name(detail.get("student") or {}).title()
    ui.page_header(
        f"{child_name}'s term",
        "Attendance, results and fees at a glance.",
        eyebrow="Family workspace",
    )
    courses = detail.get("courses") or []
    attendance_avg = average([percent(row.get("percentage")) for row in courses])
    open_balance = sum(
        max(0, int(i.get("amount_paise") or 0) - int(i.get("paid_paise") or 0))
        for i in detail.get("invoices", [])
    )
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
                "value": money(open_balance),
                "icon": ":material/account_balance_wallet:",
            },
        ]
    )
    if courses:
        ui.section("Courses", "Attendance and results recorded so far this term.")
        render_course_cards(courses)
    else:
        ui.empty_state(
            "No courses yet",
            "Registered courses will appear here once the term begins.",
        )


def support_page() -> None:
    context = _child_context()
    if not context:
        return
    _, detail = context
    child_name = display_name(detail.get("student") or {}).title()
    ui.page_header(
        "Support plan and mentor updates",
        f"What {child_name}'s mentor has agreed, and how it is going.",
        eyebrow="Family workspace",
    )
    support = detail.get("support") or []
    followups = detail.get("followups") or []
    if not support and not followups:
        ui.empty_state(
            "Nothing here yet",
            "Approved support and mentor updates will appear here.",
        )
        return
    render_support_cards(support, audience="family")
    render_mentor_updates(followups)


def fees_page() -> None:
    context = _child_context()
    if not context:
        return
    actor, detail = context
    render_fees(detail, actor)


def profile_page() -> None:
    context = _child_context()
    if not context:
        return
    actor, detail = context
    student = detail.get("student") or {}
    mentor = detail.get("mentor") or {}
    ui.page_header(
        "Profile",
        "Your family account and the student it is linked to.",
        eyebrow="Family workspace",
    )
    with ui.card("parent_profile"):
        for label, shown in [
            ("Student", display_name(student).title() if student else None),
            ("Register number", student.get("register_number")),
            ("Semester", student.get("semester")),
            ("Mentor", mentor.get("name")),
            ("Mentor email", mentor.get("email")),
            ("Your account", actor.get("email") or actor.get("displayName")),
        ]:
            if shown not in (None, ""):
                st.markdown(f"**{label}**  \n{ui._md_safe(str(shown))}")
    st.caption(
        ":material/lock: Only you, the student and the student's mentor can see this record."
    )
