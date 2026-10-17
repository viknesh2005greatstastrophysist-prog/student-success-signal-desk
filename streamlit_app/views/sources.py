"""Source records: the college's original rows, shown as evidence inside a student's profile,
and the learning and career records (quiz scores, internship and placement records).

The college's original rows are visible to staff only (mentor for their own mentees,
department head for the department); the student and parent workspaces do not offer
them. The learning and career records come with the student's own record, so the Core
applies the usual grants: the mentor and the department head see them, the student sees
their own, a parent sees quiz scores with the marks grant and internship and placement
records with the support grant. They are shown for context with their source and date
and are never part of a risk score or a flag.
"""

from __future__ import annotations

from typing import Any

import streamlit as st

import labels
import ui
from common import dataframe, load


def render_source_reports(
    student: dict[str, Any], source_by_id: dict[str, dict[str, Any]]
) -> None:
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


def render_source_evidence(register_number: Any, name: Any = None) -> None:
    """The original rows behind one student's numbers (loaded when this section opens)."""
    sources = load("sources")
    if not isinstance(sources, dict):
        ui.empty_state("No source records", "None are available to this account.")
        return
    unknowns = [str(note) for note in sources.get("unknowns", []) if note]
    source_by_id = {str(item.get("id")): item for item in sources.get("sources", [])}
    wanted = str(register_number or "").strip().lower()
    match = next(
        (
            s
            for s in sources.get("students") or []
            if wanted and str(s.get("srn") or "").strip().lower() == wanted
        ),
        None,
    ) or next(
        (
            s
            for s in sources.get("students") or []
            if name
            and labels.pretty_name(s.get("name") or "").lower()
            == labels.pretty_name(name).lower()
        ),
        None,
    )
    st.caption(
        ":material/dataset: The college's original records, exactly as supplied. "
        "Nothing here has been reinterpreted."
    )
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
    if not match:
        ui.empty_state(
            "No source rows for this student",
            "Rows appear here for the students you are permitted to see.",
        )
        return
    render_source_reports(match, source_by_id)


# ---------------------------------------------------------------------------
# Learning and career records (informational, never scored)

CONTEXT_CAPTION = (
    ":material/info: For context, not scored. Quiz scores, internship and placement records give "
    "the fuller picture; they do not change any risk score, flag or plan."
)
NOT_SHARED = "not shared with this account."


def _plural(count: Any, word: str, plural: str | None = None) -> str:
    number = int(count or 0)
    return f"{number} {word if number == 1 else (plural or word + 's')}"


def quiz_rows(quizzes: list[dict[str, Any]], *, with_course: bool = True) -> list[dict[str, Any]]:
    """One row per quiz: the score, the day it was taken and where the record comes from."""
    return [
        {
            **({"Course": q.get("course")} if with_course else {}),
            "Quiz": q.get("title") or "Quiz",
            "Score": f"{labels.fmt_number(q.get('score'))} / {labels.fmt_number(q.get('maximum_score'))}",
            "Taken on": labels.nice_date(q.get("taken_at")),
            "Source": q.get("source") or "Not recorded",
        }
        for q in quizzes
        if isinstance(q, dict)
    ]


def internship_rows(record: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Registration and evaluation, each with its source and date."""
    if not isinstance(record, dict):
        return []
    source = record.get("source") or "Not recorded"
    if record.get("status") == "not_registered":
        return [
            {
                "Record": "Registration",
                "Detail": "Not registered for an internship",
                "Source": source,
                "Date": labels.nice_date(record.get("recorded_on")),
            }
        ]
    where = " at ".join(str(p) for p in (record.get("role_title"), record.get("organisation")) if p)
    rows = [
        {
            "Record": "Registration",
            "Detail": f"{where or 'Details not recorded'} · {labels.internship_status_label(record.get('status'))}",
            "Source": source,
            "Date": labels.nice_date(record.get("registered_on") or record.get("recorded_on")),
        }
    ]
    score, grade = record.get("evaluation_score"), record.get("evaluation_grade")
    if score is not None or grade:
        detail = " ".join(
            part
            for part in (
                f"Grade {grade}" if grade else "",
                f"({labels.fmt_number(score)} of 100)" if score is not None else "",
            )
            if part
        )
        rows.append(
            {
                "Record": "Final evaluation" if record.get("status") == "completed" else "Mid-term evaluation",
                "Detail": detail,
                "Source": source,
                "Date": labels.nice_date(record.get("evaluated_on")),
            }
        )
    else:
        rows.append(
            {
                "Record": "Evaluation",
                "Detail": "Not evaluated yet",
                "Source": source,
                "Date": labels.nice_date(record.get("recorded_on")),
            }
        )
    return rows


def placement_rows(record: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Readiness, application activity and interview outcomes, each with its source and date."""
    if not isinstance(record, dict):
        return []
    source = record.get("source") or "Not recorded"
    readiness = record.get("readiness_score")
    applications = int(record.get("applications") or 0)
    interviews = int(record.get("interviews") or 0)
    if readiness is None and not applications and not interviews:
        return [
            {
                "Record": "Placement",
                "Detail": "Not started this semester",
                "Source": source,
                "Date": labels.nice_date(record.get("recorded_on")),
            }
        ]
    rows = [
        {
            "Record": "Readiness",
            "Detail": f"{labels.fmt_number(readiness)} of 100" if readiness is not None else "Not assessed yet",
            "Source": source,
            "Date": labels.nice_date(record.get("readiness_as_of")),
        }
    ]
    rows.append(
        {
            "Record": "Latest application" if applications else "Applications",
            "Detail": f"{_plural(applications, 'application')} so far" if applications else "No applications yet",
            "Source": source,
            "Date": labels.nice_date(record.get("last_applied_on")),
        }
    )
    tally = f"{_plural(interviews, 'interview')}, {_plural(record.get('offers'), 'offer')} so far"
    rows.append(
        {
            "Record": "Latest interview outcome" if interviews else "Interviews",
            "Detail": f"{labels.placement_outcome_label(record.get('last_outcome'))} ({tally})"
            if interviews
            else "No interviews yet",
            "Source": source,
            "Date": labels.nice_date(record.get("outcome_on")),
        }
    )
    return rows


def render_informational_records(
    detail: dict[str, Any], *, heading: str = "Learning and career records"
) -> None:
    """Quiz scores, internship and placement records, within the account's grants."""
    info = detail.get("informational")
    ui.section(heading)
    st.caption(CONTEXT_CAPTION)
    if not isinstance(info, dict):
        ui.empty_state(
            "No records yet",
            "Quiz scores, internship and placement records appear here once they are recorded.",
        )
        return
    st.markdown("**Quiz scores**")
    quizzes = info.get("quizzes")
    if quizzes is None:
        st.caption(f":material/lock: Quiz scores are {NOT_SHARED}")
    else:
        dataframe(quiz_rows(quizzes), empty="No quiz scores recorded yet.")
    if not info.get("career_shared"):
        st.caption(f":material/lock: Internship and placement records are {NOT_SHARED}")
        return
    st.markdown("**Internship**")
    dataframe(internship_rows(info.get("internship")), empty="No internship record yet.")
    st.markdown("**Placement**")
    dataframe(placement_rows(info.get("placement")), empty="No placement record yet.")


def context_rows(detail: dict[str, Any]) -> list[dict[str, Any]]:
    """One line each for quiz scores, the internship and placement (the mentor's Signals)."""
    info = detail.get("informational")
    if not isinstance(info, dict):
        return []
    rows: list[dict[str, Any]] = []
    quizzes = [q for q in info.get("quizzes") or [] if isinstance(q, dict) and q.get("maximum_score")]
    if quizzes:
        share = sum(float(q.get("score") or 0) / float(q["maximum_score"]) for q in quizzes) / len(quizzes)
        rows.append(
            {
                "Record": "Quiz scores",
                "Detail": f"{_plural(len(quizzes), 'quiz', 'quizzes')}, average {round(share * 100)}%",
                "Source": quizzes[0].get("source") or "Not recorded",
                "Date": labels.nice_date(max(str(q.get("taken_at") or "") for q in quizzes)),
            }
        )
    internship = info.get("internship")
    if isinstance(internship, dict):
        rows.append(
            {
                "Record": "Internship",
                "Detail": "; ".join(
                    line["Detail"] if line["Record"] == "Registration" else f"{line['Record'].lower()}: {line['Detail']}"
                    for line in internship_rows(internship)
                ),
                "Source": internship.get("source") or "Not recorded",
                "Date": labels.nice_date(internship.get("recorded_on")),
            }
        )
    placement = info.get("placement")
    if isinstance(placement, dict):
        rows.append(
            {
                "Record": "Placement",
                "Detail": _placement_summary(placement),
                "Source": placement.get("source") or "Not recorded",
                "Date": labels.nice_date(placement.get("recorded_on")),
            }
        )
    return rows


def _placement_summary(record: dict[str, Any]) -> str:
    lines = placement_rows(record)
    if lines and lines[0]["Record"] == "Placement":
        return lines[0]["Detail"]
    readiness = record.get("readiness_score")
    interviews = int(record.get("interviews") or 0)
    parts = [
        f"Readiness {labels.fmt_number(readiness)} of 100" if readiness is not None else "Readiness not assessed yet",
        _plural(record.get("applications"), "application"),
        f"{_plural(interviews, 'interview')}, {_plural(record.get('offers'), 'offer')}",
    ]
    if interviews and record.get("last_outcome"):
        parts.append(f"latest outcome: {labels.placement_outcome_label(record.get('last_outcome')).lower()}")
    return "; ".join(parts)


def render_context_fields(detail: dict[str, Any]) -> None:
    """The informational fields next to the scored signals, clearly apart from them."""
    ui.section(
        labels.INFORMATIONAL_NOTE,
        "Quiz scores, internship and placement records. They are not part of the risk score "
        "above and do not change any flag.",
    )
    dataframe(context_rows(detail), empty="No quiz, internship or placement records yet.")
