"""Source records: the college's original rows, shown as evidence inside a student's profile.

Visible to staff only (mentor for their own mentees, department head for the
department). The scope is enforced by the engine; the student and parent
workspaces do not offer these pages at all.
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
