"""Staff-side flag for plans and drafts computed on earlier figures, with a re-review offer.

The Core stamps every plan and draft it returns to staff with `evidence_current` (False
when the evidence was captured before the current data generation was applied). A student
or parent never receives such a plan (the Core withholds it); staff see it labelled
"Based on earlier figures" and can start a new review with the latest figures.
"""

from __future__ import annotations

from typing import Any

import streamlit as st

import ui

EARLIER_FIGURES = "Based on earlier figures"
CURRENT_FIGURES = "Current figures"


def figures_label(row: dict[str, Any]) -> str:
    """Current figures, or the earlier-figures flag, for one plan or draft row."""
    return CURRENT_FIGURES if row.get("evidence_current", True) is not False else EARLIER_FIGURES


def stale_rows(rows: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [row for row in rows or [] if row.get("evidence_current") is False]


REREVIEW_BUTTONS = 3


def render_rereview(rows: list[dict[str, Any]] | None, *, role: str, key: str, noun: str = "plan") -> None:
    """One quiet note when any row is on earlier figures, and (mentor only) a button that
    opens a new review for that student. When some students get no button, a caption
    says why, so the count and the buttons always agree."""
    stale = stale_rows(rows)
    if not stale:
        return
    by_student: dict[str, list[dict[str, Any]]] = {}
    for row in stale:
        by_student.setdefault(str(row.get("student_id")), []).append(row)
    count = len(by_student)
    ui.insight(
        EARLIER_FIGURES,
        f"{count} student{'s' if count != 1 else ''} with a {noun} computed before the latest data refresh. "
        "Students and families do not see these; they are told the mentor will review again. "
        "The record stays here as history.",
    )
    if role != "faculty":
        return
    # A frozen record (the Core marks it frozen) is kept unchanged: no new review.
    frozen = [sid for sid, found in by_student.items() if any(r.get("frozen") for r in found)]
    offer = [found[0] for sid, found in by_student.items() if sid not in frozen]
    shown = offer[:REREVIEW_BUTTONS]
    if len(shown) < count:
        notes = [
            f"{len(shown)} of these {count} can be reviewed again below."
            if shown
            else "None of these can be reviewed again here."
        ]
        if frozen:
            notes.append(
                f"{len(frozen)} {'is' if len(frozen) == 1 else 'are'} kept unchanged for the project presentation."
            )
        if len(offer) > len(shown):
            notes.append(f"Start the other {len(offer) - len(shown)} from Reviews > Start a review.")
        st.caption(" ".join(notes))
    for row in shown:
        student_id = str(row.get("student_id"))
        name = row.get("display_name") or row.get("register_number") or "this student"
        if st.button(
            f"Review {name} again with the latest figures",
            key=f"{key}_{student_id}",
            icon=":material/refresh:",
        ):
            from views.pages import pages_for

            st.session_state["rereview_student"] = student_id
            target = next((p for p in pages_for("faculty") if p.url_path == "reviews"), None)
            if target is not None:
                st.switch_page(target)


def render_earlier_reviews_note(review: dict[str, Any]) -> None:
    """Says that review cycles on earlier figures are history and not counted in the
    risk view, the department trends or the AI activity figures."""
    info = review.get("dataGeneration") or {}
    earlier = int(info.get("earlierReviews") or 0)
    if not earlier:
        return
    cycles = int(info.get("earlierCycles") or 0)
    st.caption(
        f"Counts and scores here use the current data ({info.get('current')}). "
        f"{earlier} earlier review{'s' if earlier != 1 else ''} in {cycles} cycle{'s' if cycles != 1 else ''} "
        "were computed on earlier figures; they stay on record as history and are not counted."
    )
