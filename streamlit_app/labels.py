"""Presentation-only labels: internal codes become plain English.

Nothing here grants or checks access. Unknown codes fall back to a readable,
title-cased form so new backend values never render as raw enums.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

# Semantic tones map onto Streamlit's themed palette (see .streamlit/config.toml):
# blue = agent output, orange = waiting on a human, green = approved/published,
# red = needs attention, violet = medium risk, gray = neutral.
STATUS = {
    # Review plans
    "draft": ("Draft", "gray", ":material/edit_note:"),
    "clarifying": ("Needs details", "orange", ":material/help:"),
    "ready": ("Ready to lock", "blue", ":material/task_alt:"),
    "locked": ("Locked", "blue", ":material/lock:"),
    # Review jobs and cases
    "queued": ("Queued", "gray", ":material/schedule:"),
    "running": ("Running", "blue", ":material/autorenew:"),
    "collected": ("Evidence collected", "blue", ":material/inventory_2:"),
    "retrieved": ("References retrieved", "blue", ":material/travel_explore:"),
    "validated": ("Validated", "blue", ":material/verified:"),
    "human_review": ("At the mentor gate", "orange", ":material/front_hand:"),
    "awaiting_faculty": ("Awaiting your review", "orange", ":material/front_hand:"),
    "awaiting_review": ("Awaiting review", "orange", ":material/front_hand:"),
    "needs_human": ("Needs your decision", "red", ":material/report:"),
    "not_flagged": ("Not flagged", "gray", ":material/check:"),
    "blocked": ("Blocked", "red", ":material/block:"),
    "failed": ("Failed", "red", ":material/error:"),
    "complete": ("Complete", "green", ":material/check_circle:"),
    "approved": ("Approved", "green", ":material/verified:"),
    "rejected": ("Not approved", "red", ":material/cancel:"),
    "published": ("Published", "green", ":material/campaign:"),
    # Interventions and follow-ups
    "planned": ("Planned", "blue", ":material/event:"),
    "in_progress": ("In progress", "blue", ":material/pending:"),
    "completed": ("Completed", "green", ":material/check_circle:"),
    "withdrawn": ("Withdrawn", "gray", ":material/undo:"),
    "scheduled": ("Scheduled", "blue", ":material/event:"),
    # Fees and payments
    "open": ("Open", "orange", ":material/receipt_long:"),
    "due": ("Due", "orange", ":material/receipt_long:"),
    "paid": ("Paid", "green", ":material/paid:"),
    "void": ("Void", "gray", ":material/block:"),
    "captured": ("Paid", "green", ":material/paid:"),
    "authorized": ("Authorised", "blue", ":material/credit_card:"),
    "declined": ("Declined", "red", ":material/credit_card_off:"),
    # Registration and LMS
    "registered": ("Registered", "green", ":material/how_to_reg:"),
    "submitted": ("Submitted", "green", ":material/upload_file:"),
    # Attendance
    "present": ("Present", "green", ":material/check:"),
    "absent": ("Absent", "red", ":material/close:"),
    "late": ("Late", "orange", ":material/schedule:"),
    "excused": ("Excused", "gray", ":material/event_busy:"),
}

RISK_BANDS = {
    "high": ("High risk", "red", ":material/priority_high:"),
    "medium": ("Medium risk", "violet", ":material/trending_up:"),
    "low": ("Low risk", "gray", ":material/trending_flat:"),
    "not evaluated": ("Not evaluated", "gray", ":material/remove:"),
}

SIGNALS = {
    "ATTENDANCE_LOW": "Attendance below threshold",
    "MARK_LOW": "Marks below threshold",
    "LMS_INACTIVE": "Inactive on the LMS",
    "ASSIGNMENT_OVERDUE": "Overdue assignments",
    "INTERNSHIP_MILESTONE": "Missed internship milestone",
    "PLACEMENT_ACTIVITY": "Missed placement activity",
}

SOURCES = {
    "academic": "Academic records",
    "lms": "Learning platform",
    "internship": "Internship records",
    "placement": "Placement records",
}

ISSUES = {
    "ADVISOR_REVIEW_REQUIRED": "Mentor review required",
    "CATALOGUE_OR_DOMAIN_MISMATCH": "Action outside the approved catalogue",
    "MISSING_TRIGGER_COVERAGE": "A triggering signal was not cited",
    "MODEL_INVALID_JSON": "Model returned an unreadable draft",
    "MODEL_TIMEOUT": "Model timed out",
    "MODEL_UNAVAILABLE": "Model unavailable",
    "PRIVACY_SCOPE_MISMATCH": "Evidence outside the permitted scope",
    "SCHEMA_INVALID": "Draft did not match the required format",
    "THRESHOLDS_NOT_FACULTY_SET": "Thresholds not set by faculty",
    "UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS": "Unsafe or diagnostic wording",
    "UNSUPPORTED_CITATION": "Citation not found in the evidence",
    "UNSUPPORTED_NUMBER": "A number not found in the evidence",
    "UNSUPPORTED_SUMMARY": "Summary not supported by the evidence",
    "INJECTED_STOP": "Stopped for a recovery test",
}

DOMAINS = {
    "academic": "Academic",
    "attendance": "Attendance",
    "wellbeing-referral": "Wellbeing referral",
}

MODES = {
    "deterministic": "Rule-based",
    "model": "AI model",
    "fallback": "Rule-based fallback",
}

AGENT_NODES = {
    "Coordinator": ("Coordinator", "coordinator"),
    "ContineoCollector": ("Academic collector", "agent"),
    "LMSCollector": ("LMS collector", "agent"),
    "InternshipCollector": ("Internship collector", "agent"),
    "PlacementCollector": ("Placement collector", "agent"),
    "EvidenceValidator": ("Evidence check", "coordinator"),
    "RiskAnalysisAgent": ("Risk analysis", "agent"),
    "HistoryRetriever": ("History retrieval", "agent"),
    "RecommendationAgent": ("Recommendation", "agent"),
    "PacketValidator": ("Validation gate", "coordinator"),
    "Regenerator": ("Targeted repair", "agent"),
    "HumanGate": ("Mentor gate", "gate"),
    "DashboardPublisher": ("Publish", "publish"),
}

NODE_STATES = {
    "completed": ("Done", "green"),
    "running": ("Running", "blue"),
    "waiting": ("Waiting", "orange"),
    "escalated": ("Escalated", "red"),
    "failed": ("Failed", "red"),
    "cancelled": ("Cancelled", "gray"),
}


def humanize(code: Any) -> str:
    text = str(code or "").strip()
    if not text:
        return "Not recorded"
    return text.replace("_", " ").replace("-", " ").strip().capitalize()


def status_label(code: Any) -> str:
    return STATUS.get(str(code or ""), (humanize(code), "gray", ""))[0]


def status_tone(code: Any) -> str:
    return STATUS.get(str(code or ""), ("", "gray", ""))[1]


def status_icon(code: Any) -> str:
    return STATUS.get(str(code or ""), ("", "gray", ":material/circle:"))[2]


def risk_label(band: Any) -> str:
    return RISK_BANDS.get(str(band or "not evaluated"), (humanize(band), "", ""))[0]


def signal_label(code: Any) -> str:
    return SIGNALS.get(str(code or ""), humanize(code))


def source_label(code: Any) -> str:
    return SOURCES.get(str(code or ""), humanize(code))


def issue_label(code: Any) -> str:
    if not code:
        return "None"
    return ISSUES.get(str(code), humanize(code))


def domain_label(code: Any) -> str:
    return DOMAINS.get(str(code or ""), humanize(code))


def mode_label(code: Any) -> str:
    if not code:
        return "Not recorded"
    return MODES.get(str(code), humanize(code))


def node_label(node: Any) -> str:
    return AGENT_NODES.get(str(node or ""), (humanize(node), "agent"))[0]


def short_ref(raw: Any, length: int = 6) -> str:
    text = str(raw or "")
    return f"#{text.replace('-', '')[:length]}" if text else "—"


def nice_date(raw: Any) -> str:
    if not raw:
        return "—"
    try:
        parsed = date.fromisoformat(str(raw)[:10])
    except ValueError:
        return str(raw)
    return f"{parsed.day} {parsed.strftime('%b %Y')}"


def nice_time(raw: Any) -> str:
    if not raw:
        return "—"
    try:
        moment = datetime.fromisoformat(str(raw)).astimezone()
    except (TypeError, ValueError):
        return str(raw)
    hour = moment.strftime("%I").lstrip("0") or "12"
    return f"{moment.day} {moment.strftime('%b')}, {hour}:{moment.strftime('%M %p')}"


def due_phrase(raw: Any) -> str:
    try:
        due = date.fromisoformat(str(raw)[:10])
    except (TypeError, ValueError):
        return "No due date"
    days = (due - datetime.now().astimezone().date()).days
    if days < 0:
        return f"Overdue by {-days} day{'s' if days != -1 else ''}"
    if days == 0:
        return "Due today"
    if days == 1:
        return "Due tomorrow"
    return f"Due in {days} days"


def friendly_source_name(filename: Any) -> str:
    """'Full_Attendance_Report(6) (1).xls' -> 'Full attendance report'."""
    text = str(filename or "").strip()
    if not text:
        return "Supplied source"
    stem = text.rsplit(".", 1)[0]
    stem = stem.split("(")[0].replace("_", " ").replace("-", " ")
    words = " ".join(stem.split())
    return words.capitalize() if words else "Supplied source"


EVIDENCE_FIELDS = {
    "attendancePct": "Attendance (%)",
    "markPct": "Marks (%)",
    "inactivityDays": "Days inactive on the LMS",
    "overdueAssignments": "Overdue assignments",
    "missedMilestones": "Missed internship milestones",
    "missedActivities": "Missed placement activities",
}


def readable_claim(statement: Any) -> str:
    """Display form of a canonical evidence statement; the stored text is unchanged."""
    text = str(statement or "")
    for field, label in EVIDENCE_FIELDS.items():
        if text.startswith(field + " "):
            return label + text[len(field) :]
    return text


def pretty_name(raw: Any) -> str:
    """Title-case names stored in capitals; leave mixed-case names untouched."""
    text = str(raw or "").strip()
    return text.title() if text.isupper() else text
