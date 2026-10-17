"""Presentation-only labels: internal codes become plain English.

Nothing here grants or checks access. Unknown codes fall back to a readable,
title-cased form so new backend values never render as raw enums.
"""

from __future__ import annotations

import re
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
    "awaiting_faculty": ("Awaiting mentor review", "orange", ":material/front_hand:"),
    "awaiting_review": ("Awaiting review", "orange", ":material/front_hand:"),
    "needs_human": ("Needs your decision", "red", ":material/report:"),
    "ai_unavailable": ("AI unavailable, retry", "orange", ":material/cloud_off:"),
    "not_flagged": ("Not flagged", "gray", ":material/check:"),
    "blocked": ("Blocked", "red", ":material/block:"),
    "failed": ("Failed", "red", ":material/error:"),
    "complete": ("Complete", "green", ":material/check_circle:"),
    "approved": ("Approved", "green", ":material/verified:"),
    "rejected": ("Not approved", "red", ":material/cancel:"),
    "superseded": ("Replaced by new data", "gray", ":material/update:"),
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
    "low": ("Low risk", "green", ":material/trending_flat:"),
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

# Informational records (quiz scores, internship and placement detail): shown for
# context with their source and date, never part of a risk score or a flag.
INFORMATIONAL_NOTE = "For context, not scored"
INTERNSHIP_STATUS = {
    "not_registered": "Not registered",
    "registered": "Registered, not started yet",
    "ongoing": "In progress",
    "completed": "Completed",
    "withdrawn": "Withdrawn",
}
PLACEMENT_OUTCOMES = {
    "awaiting_result": "Waiting for the result",
    "next_round": "Through to the next round",
    "not_selected": "Not selected",
    "offer": "Offer received",
    "offer_declined": "Offer declined",
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
    "UNCITED_CLAIM": "A sentence without an evidence citation",
    "UNKNOWN_COURSE_ALIAS": "A course reference that does not exist",
    "OUTPUT_PII": "Personal details in the draft text",
    "LENGTH_LIMIT": "Draft text outside the length limits",
    "SPECIALIST_LANGUAGE": "Wording not allowed for a wellbeing referral",
    "SPECIALIST_SCOPE": "Evidence outside the specialist's scope",
    "SPECIALIST_MISMATCH": "Draft from the wrong specialist",
    "EGRESS_BLOCKED": "Private details stopped before leaving the server",
    "JUDGE_ACTIONABILITY_LOW": "Judge: actions not practical enough for the mentor",
    "JUDGE_GROUNDING_LOW": "Judge: claims not grounded in the cited evidence",
    "JUDGE_SPECIFICITY_LOW": "Judge: too generic, lacks the concrete values",
    "JUDGE_TONE_LOW": "Judge: tone not safe and supportive enough",
    "MODEL_RATE_LIMITED": "Model rate limit reached",
    "MODEL_DAILY_CAP": "Daily model allowance used up",
    "MODEL_HTTP_429": "Model provider rate limit",
    "MODEL_NOT_CONFIGURED": "No model is configured",
    "AI_UNAVAILABLE": "No AI model answered; retry when one is available",
    "LEGACY_DRAFT_READ_ONLY": "Retired rule-based draft, read-only",
}

PROVIDERS = {
    "local": "Local Qwen (this laptop)",
    "groq": "Groq",
    "gemini": "Gemini",
    "configured": "Configured endpoint",
}

DOMAINS = {
    "academic": "Academic",
    "attendance": "Attendance",
    "wellbeing-referral": "Wellbeing referral",
}

# Every review now runs on an AI model. The rule-based labels only describe
# drafts and runs recorded before that path was retired.
MODES = {
    "deterministic": "Rule-based (retired)",
    "model": "AI model",
    "fallback": "Rule-based fallback (retired)",
    "unavailable": "AI unavailable",
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
    "InvestigatorAgent": ("Investigator", "agent"),
    "PlannerAgent": ("Planner", "coordinator"),
    "AcademicSpecialist": ("Academic specialist", "agent"),
    "AttendanceSpecialist": ("Attendance specialist", "agent"),
    "WellbeingReferralSpecialist": ("Wellbeing-referral specialist", "agent"),
    "PacketValidator": ("Validation gate", "coordinator"),
    "JudgeAgent": ("Judge", "agent"),
    "Regenerator": ("Targeted repair", "agent"),
    "HumanGate": ("Mentor gate", "gate"),
    "DashboardPublisher": ("Publish", "publish"),
}

JUDGE_DIMENSIONS = ("grounding", "specificity", "actionability", "tone")

NODE_STATES = {
    "completed": ("Done", "green"),
    "running": ("Running", "blue"),
    "waiting": ("Waiting", "orange"),
    "escalated": ("Escalated", "red"),
    "failed": ("Failed", "red"),
    "cancelled": ("Cancelled", "gray"),
}


# Where the attendance figures come from (data generation realistic-v3): derived from the college's attendance
# report, per course, not the raw register. The college's original cells stay unchanged under Source records.
ATTENDANCE_BASIS_NOTE = (
    "Attendance figures are based on the college attendance report (course-level values built from its "
    "recorded attendance), not raw register entries."
)
ATTENDANCE_BASIS_VALUES = {
    "college_attendance_report": "College attendance report (course-level values built from it, not raw register entries)"
}


def attendance_basis_label(code: Any) -> str:
    return ATTENDANCE_BASIS_VALUES.get(str(code), humanize(code))


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


SUMMARY_KEYWORDS = {
    "attendance low": "attendance",
    "mark low": "marks",
    "marks low": "marks",
    "lms inactive": "activity on the learning platform",
    "assignment overdue": "overdue assignments",
    "internship milestone": "an internship milestone",
    "placement activity": "placement activities",
}


def family_summary(text: Any) -> str:
    """Family-facing form of 'Mentor review requested: attendance low, mark low, ...' (#28).

    Display only; the stored summary is never changed."""
    raw = str(text or "").strip()
    prefix = "Mentor review requested:"
    if not raw.startswith(prefix):
        return raw
    items = [
        part.strip().rstrip(".")
        for part in raw[len(prefix) :].split(",")
        if part.strip()
    ]
    if not items:
        return "Your mentor has asked to check in with you."
    names = [SUMMARY_KEYWORDS.get(item.lower(), item.lower()) for item in items]
    joined = (
        names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
    )
    return f"Your mentor would like to check in about {joined}."


def version_number(raw: Any) -> Any:
    """Stored artifact versions start at 0; people count from 1 (E2E L6)."""
    try:
        return int(raw) + 1
    except (TypeError, ValueError):
        return "?"


def risk_label(band: Any) -> str:
    return RISK_BANDS.get(str(band or "not evaluated"), (humanize(band), "", ""))[0]


def signal_label(code: Any) -> str:
    return SIGNALS.get(str(code or ""), humanize(code))


def source_label(code: Any) -> str:
    return SOURCES.get(str(code or ""), humanize(code))


def internship_status_label(code: Any) -> str:
    return INTERNSHIP_STATUS.get(str(code), humanize(code)) if code else "Not recorded"


def placement_outcome_label(code: Any) -> str:
    return PLACEMENT_OUTCOMES.get(str(code), humanize(code)) if code else "No interview yet"


def issue_label(code: Any) -> str:
    if not code:
        return "No issue"
    return ISSUES.get(str(code), humanize(code))


_PATH = re.compile(r"^([a-z]+)(?:\[(\d+)\])?(?:\.([A-Za-z]+)(?:\[(\d+)\])?)?$")
_PARTS = {
    "rationale": "Rationale sentence",
    "actions": "Action",
    "citations": "Citation",
}
_SUBPARTS = {
    "talkingPoints": "talking point",
    "personalisation": "personalisation",
    "citations": "citations",
}


def path_label(path: Any) -> str:
    """Plain place of a failure: rationale[1] -> 'Rationale sentence 2'. Empty when the whole draft."""
    match = _PATH.match(str(path or ""))
    if not match:
        return ""
    field, index, sub, sub_index = match.groups()
    if index is None:
        return humanize(field) if field not in {"summary"} else "Summary"
    text = f"{_PARTS.get(field, humanize(field))} {int(index) + 1}"
    if sub and sub != "text":
        text += f", {_SUBPARTS.get(sub, humanize(sub).lower())}"
        if sub_index is not None:
            text += f" {int(sub_index) + 1}"
    return text


def diagnosis_rows(record: Any) -> tuple[list[dict[str, str]], bool]:
    """Rows (Diagnosis, Fix requested) for a validation report or one repair attempt.

    Reports recorded before targeted diagnoses were stored carry none, so each failed
    check falls back to its plain `ISSUES` wording; the flag says the fallback was used.
    """
    if not isinstance(record, dict):
        return [], False
    stored = [
        d
        for d in record.get("diagnoses") or []
        if isinstance(d, dict) and d.get("code")
    ]
    if stored:
        return (
            [
                {
                    "Diagnosis": str(d.get("diagnosis") or issue_label(d.get("code"))),
                    "Fix requested": str(d.get("instruction") or "—"),
                }
                for d in stored
            ],
            False,
        )
    failures = [
        f for f in record.get("failures") or [] if isinstance(f, dict) and f.get("code")
    ]
    rows = []
    for failure in failures:
        where = path_label(failure.get("path"))
        wording = issue_label(failure.get("code"))
        rows.append(
            {
                "Diagnosis": f"{wording} ({where.lower()})" if where else wording,
                "Fix requested": "—",
            }
        )
    return rows, bool(rows)


def domain_label(code: Any) -> str:
    return DOMAINS.get(str(code or ""), humanize(code))


def mode_label(code: Any) -> str:
    if not code:
        return "Not recorded"
    return MODES.get(str(code), humanize(code))


def model_name(model_id: Any) -> str:
    """The model that wrote a draft, as stored on its agent run, in plain words."""
    full = str(model_id or "")
    raw = full.split(";")[0].strip()
    if not raw:
        return ""
    if "shared action profiles" in full:
        # Retired cross-student reuse: one model answer applied to students with the same signals.
        return f"{model_name(raw)}, shared bulk draft"
    provider, _, model = raw.partition(":") if raw.startswith(("groq:", "gemini:")) else ("", "", raw)
    model = model.split("/")[-1]
    qwen = re.match(r"qwen(\d+(?:\.\d+)?)[-:](\d+)b", model, re.I)
    if qwen:
        name = f"Qwen{qwen.group(1)} {qwen.group(2)}B"
        if provider == "groq":
            return f"{name} on Groq"
        return f"{name} (local)" if not provider else f"{name} on {provider.capitalize()}"
    if model.lower().startswith("gemini"):
        words = model.split("-")
        version = words[1] if len(words) > 1 else ""
        rest = "-".join(w.capitalize() for w in words[2:])
        return " ".join(part for part in ("Gemini", version, rest) if part)
    return re.sub(r"[_\s]+", " ", model).strip()


RUN_OUTCOMES = {
    "not_flagged": "Checked, no support needed",
    "awaiting_faculty": "Plan drafted, waiting for the mentor",
    "awaiting_review": "Plan drafted, waiting for the mentor",
    "human_review": "Plan drafted, waiting for the mentor",
    "approved": "Plan approved by the mentor",
    "published": "Plan approved and shared",
    "rejected": "Plan declined by the mentor",
    "declined": "Plan declined by the mentor",
    "superseded": "Replaced after new data",
    "withdrawn": "Withdrawn",
    "needs_human": "Handed to the mentor to decide",
    "ai_unavailable": "No AI model answered; waiting for a retry",
    "running": "Agents working now",
    "queued": "Review planned, waiting for the mentor to run it",
}


def run_outcome(status: Any, error_code: Any = None, intervention: Any = None) -> str:
    """One plain sentence for what a review run ended with (replaces Status, Stage and Issue).

    An approved case keeps the status "approved" after the mentor withdraws its plan,
    so the plan's intervention status is passed alongside (review R-17)."""
    code = str(status or "")
    if code == "approved" and intervention == "withdrawn":
        return "Approved, then withdrawn"
    if code in ("failed", "blocked"):
        return f"Stopped: {issue_label(error_code).lower()}" if error_code else "Stopped before a draft"
    return RUN_OUTCOMES.get(code, status_label(code))


def drafted_by(mode: Any, model_id: Any = None, status: Any = None) -> str:
    """Who wrote a draft: the real model when one did, otherwise why there is none."""
    name = model_name(model_id)
    if name:
        return name
    if mode in ("deterministic", "fallback"):
        return "Rules (retired, no AI model)"
    if mode == "unavailable" or status == "ai_unavailable":
        return "No model answered"
    if status == "not_flagged":
        return "No draft needed"
    if status in ("queued", "running", "blocked"):
        return "Not drafted yet"
    if mode == "model":
        return "AI model (name not recorded)"
    return "Not drafted"


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


def evidence_figure(raw: Any) -> str:
    """A stored figure as the plan's citations show it: a long decimal to one place."""
    return re.sub(r"\d+\.\d{3,}", lambda m: f"{float(m.group(0)):.1f}", str(raw))


def readable_claim(statement: Any) -> str:
    """Display form of a canonical evidence statement; the stored text is unchanged."""
    text = evidence_figure(statement or "")
    for field, label in EVIDENCE_FIELDS.items():
        if text.startswith(field + " "):
            return label + text[len(field) :]
    return text


def tool_label(raw: Any) -> str:
    """'list_policies' -> 'List policies' (display only)."""
    return humanize(raw) if raw else "Not recorded"


def pretty_name(raw: Any) -> str:
    """Title-case names stored in capitals; leave mixed-case names untouched."""
    text = str(raw or "").strip()
    return text.title() if text.isupper() else text


def provider_label(code: Any) -> str:
    return PROVIDERS.get(str(code), humanize(code)) if code else "No model answered"


def fmt_number(raw: Any) -> str:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return "not recorded" if raw is None else str(raw)
    return str(int(raw)) if float(raw).is_integer() else f"{raw:.1f}"


POLICY_THRESHOLDS = {
    "attendancePct": "attendanceMinimum",
    "markPct": "markMinimum",
    "inactivityDays": "inactivityMaximum",
    "overdueAssignments": "overdueMinimum",
    "missedMilestones": "internshipMinimum",
    "missedActivities": "placementMinimum",
}


def threshold_for(metric: str, signals: Any, policy: Any) -> Any:
    """Threshold for a cited metric: the triggering signal first, then policy."""
    for signal in signals or []:
        if str(signal.get("path", "")).endswith(f".values.{metric}"):
            return signal.get("threshold")
    key = POLICY_THRESHOLDS.get(metric)
    return (policy or {}).get(key) if key and isinstance(policy, dict) else None


# --- Counts shared by several screens (E2E log fix pass B) -------------------
# Pure functions so the headline numbers can be checked without a server.

CHECK_NAMES = (
    "alerts_cite_triggers",
    "thresholds_faculty_set",
    "advisor_review_required",
    "privacy_scope_enforced",
)


def percent_text(part: int, whole: int) -> str:
    """A percentage that never rounds a failure up to 100%."""
    if not whole:
        return "—"
    if part >= whole:
        return "100%"
    return f"{min(99.9, round(100 * part / whole, 1)):g}%"


def validation_headline(validation: Any) -> tuple[str, str, str]:
    """(text, colour, icon) for the validation report badge. A pass is claimed
    only when the acceptance checks were recorded for this version."""
    validation = validation if isinstance(validation, dict) else {}
    checks = validation.get("checks")
    checks = checks if isinstance(checks, dict) else {}
    recorded = {
        name: checks.get(name)
        for name in CHECK_NAMES
        if isinstance(checks.get(name), bool)
    }
    if validation.get("valid") is False or (recorded and not all(recorded.values())):
        return ("Did not pass", "red", ":material/report:")
    if not recorded:
        return ("Checks not recorded for this version", "gray", ":material/help:")
    if len(recorded) < len(CHECK_NAMES):
        return (
            f"Passed the {len(recorded)} recorded of {len(CHECK_NAMES)} checks",
            "orange",
            ":material/rule:",
        )
    return ("Passed every check", "green", ":material/verified:")


def risk_scope(
    rows: list[dict[str, Any]], plan_id: Any = None, flagged_only: bool = False
) -> list[dict[str, Any]]:
    """Risk rows are student x review cycle. For one cycle, that cycle's rows
    (one per student). For all cycles, only each student's latest row, so the
    count of rows is a count of students."""
    scoped = [
        row
        for row in rows
        if (row.get("planId") == plan_id if plan_id else row.get("latest", True))
    ]
    return [row for row in scoped if row.get("flagged")] if flagged_only else scoped


def risk_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    evaluated = [row for row in rows if row.get("score") is not None]
    return {
        "students": len({row.get("studentId") for row in rows}),
        "evaluated": len(evaluated),
        "flagged": sum(1 for row in rows if row.get("flagged")),
        "high": sum(1 for row in rows if row.get("band") == "high"),
        "medium": sum(1 for row in rows if row.get("band") == "medium"),
    }


def outcome_counts(plans: list[dict[str, Any]]) -> dict[str, int]:
    """Each approved plan counted once, by its current intervention status."""
    counts = {"planned": 0, "in_progress": 0, "completed": 0, "withdrawn": 0}
    for plan in plans:
        status = str(plan.get("status") or "planned")
        counts[status if status in counts else "planned"] += 1
    return {"plans": len(plans), **counts}


def is_late(due_at: Any, submitted_at: Any, flag: Any = None) -> bool:
    """True when a submission came in after the due time. The Core's own flag
    wins when it sends one; otherwise compare the two timestamps."""
    if isinstance(flag, bool):
        return flag
    try:
        due = datetime.fromisoformat(str(due_at))
        sent = datetime.fromisoformat(str(submitted_at))
        return sent > due
    except (TypeError, ValueError):
        return False


def hours_phrase(hours: float) -> str:
    """'3 hours' or '2 days': how long something has waited, in plain words."""
    if hours < 1:
        return "under an hour"
    if hours < 48:
        count = round(hours)
        return f"{count} hour{'s' if count != 1 else ''}"
    days = round(hours / 24)
    return f"{days} days"


# ---------------------------------------------------------------------------
# The conversation with the student about the AI report (owner decisions, 17 Oct). The
# clock starts when the AI writes the report (the draft reaches the mentor gate): meet
# the student within 7 days, submit the conversation within 14. The reasons are the
# Core's fixed list, in the same order (platform/services/core-api/lib/meetings.ts and
# migration 014); "Other" needs a note.
MEETING_REASONS = [
    "Health",
    "Family responsibilities",
    "Financial pressure",
    "Transport or distance",
    "Course difficulty",
    "Lost motivation or interest",
    "Part-time work",
    "Personal or mental-health concern",
    "Timetable clash",
    "Other",
]
MEET_WITHIN_DAYS = 7
SUBMIT_WITHIN_DAYS = 14
PAST_DEADLINE_NOTE = "Past the deadline; the department head can see this."


def college_today() -> date:
    """Today in the college's time zone (India), the day the Core checks a meeting date against."""
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


def days_word(n: int) -> str:
    return f"{n} day{'s' if n != 1 else ''}"


def meeting_timeline(row: dict[str, Any] | None) -> dict[str, Any]:
    """The report dates and stage of a row: a plan row carries them under `meeting_due`,
    a meeting-status row (Today, Overview, profile) carries them itself."""
    if not row:
        return {}
    nested = row.get("meeting_due")
    return nested if isinstance(nested, dict) else row


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def meeting_stage_text(row: dict[str, Any] | None, *, for_mentor: bool = True) -> str:
    """Where the conversation stands, in the words of the mentor's card: "Due in 3 days",
    "Meet by now (2 days overdue)", "Past the deadline; the department head can see this."
    (for the department head: "Past the deadline"), or "Conversation submitted"."""
    timeline = meeting_timeline(row)
    stage = timeline.get("stage")
    if stage == "met" or (row or {}).get("meeting"):
        return "Conversation submitted"
    if stage == "due":
        left = _int(timeline.get("days_left"))
        return f"Due in {days_word(left)}" if left is not None else "Due"
    if stage == "meet_now":
        overdue = _int(timeline.get("days_overdue")) or 0
        return "Meet by now (" + (f"{days_word(overdue)} overdue" if overdue else "due today") + ")"
    if stage == "past_deadline":
        return PAST_DEADLINE_NOTE if for_mentor else "Past the deadline"
    return "Not tracked"


def meeting_schedule_text(row: dict[str, Any] | None) -> str:
    """"AI report on 10 Oct 2026. Meet the student by 17 Oct 2026 and submit the
    conversation by 24 Oct 2026." """
    timeline = meeting_timeline(row)
    return (
        f"AI report on {nice_date(timeline.get('report_on'))}. "
        f"Meet the student by {nice_date(timeline.get('meet_by'))} and submit the conversation by "
        f"{nice_date(timeline.get('deadline'))}."
    )


def met_text(meeting: dict[str, Any]) -> str:
    """"Met on 15 Oct 2026: Health, Course difficulty" """
    reasons = ", ".join(str(r) for r in meeting.get("reasons") or [])
    return f"Met on {nice_date(meeting.get('met_on'))}" + (f": {reasons}" if reasons else "")


def meeting_line(row: dict[str, Any] | None, *, for_mentor: bool = True) -> str:
    """One student's conversation about their AI report, for staff (the profile line):
    "Met on 15 Oct 2026: Health" or "AI report on 10 Oct 2026. Meet the student by ...
    and submit the conversation by .... Due in 3 days." """
    if not row:
        return "No AI report to discuss"
    meeting = row.get("meeting")
    if isinstance(meeting, dict) and meeting.get("met_on"):
        report = meeting_timeline(row).get("report_on")
        return met_text(meeting) + (f" (AI report of {nice_date(report)})" if report else "")
    if not meeting_timeline(row).get("report_on"):
        return "Meeting not recorded"
    stage = meeting_stage_text(row, for_mentor=for_mentor)
    return f"{meeting_schedule_text(row)} {stage}" + ("" if stage.endswith(".") else ".")


def meeting_cell(row: dict[str, Any] | None, *, for_mentor: bool = True) -> str:
    """meeting_line for a table's Meeting column: "Met on 15 Oct 2026: Health" or where it
    stands ("Due in 3 days", "Meet by now (2 days overdue)", ...)."""
    if not row:
        return "No AI report to discuss"
    meeting = row.get("meeting")
    if isinstance(meeting, dict) and meeting.get("met_on"):
        return met_text(meeting)
    if not meeting_timeline(row).get("report_on"):
        return "Meeting not recorded"
    return meeting_stage_text(row, for_mentor=for_mentor)


def college_day(raw: Any) -> str:
    """A timestamp as its calendar day in India ("17 Oct 2026"); a plain date as it is."""
    if not raw:
        return nice_date(raw)
    text = str(raw)
    if len(text) <= 10:
        return nice_date(text)
    try:
        from zoneinfo import ZoneInfo

        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if moment.tzinfo is None:
            return nice_date(text)
        return nice_date(moment.astimezone(ZoneInfo("Asia/Kolkata")).date().isoformat())
    except ValueError:
        return nice_date(text)


def reminder_cell(row: dict[str, Any] | None) -> str:
    """The department head's last reminder about a report: "Reminder sent 17 Oct 2026",
    then "Read 18 Oct 2026" once the mentor has read it, or "None sent"."""
    reminder = (row or {}).get("reminder")
    if not isinstance(reminder, dict) or not reminder.get("sent_at"):
        return "None sent"
    text = f"Reminder sent {college_day(reminder['sent_at'])}"
    if reminder.get("read_at"):
        text += f" · Read {college_day(reminder['read_at'])}"
    return text


def reminder_text(row: dict[str, Any]) -> str:
    """The standard reminder (the Core stores the same words, lib/staff-messages.ts)."""
    student = pretty_name(row.get("student_name") or "the student")
    return (
        f"The conversation with {student} about the AI report of {nice_date(meeting_timeline(row).get('report_on'))} "
        "has not been submitted. Please meet the student and record it, or tell me why not."
    )
