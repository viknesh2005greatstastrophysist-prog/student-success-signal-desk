"""Offline checks for fix batch B1 (16 Oct review): counts that must agree across
screens. Fictional data; no server, database, model or network.

R-06: the department head's Drafts waiting card and the flagged list give the real
reason when they differ (a draft on earlier figures, a newer review still running,
or a draft from the retired rule-based path), and say nothing when they agree."""

import json
import sys
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
from views.hod import waiting_gap_note  # noqa: E402


def run(body: str) -> AppTest:
    script = f"""
import json, sys
import streamlit as st
sys.path.insert(0, {str(APP)!r})
from apptest_util import namespace
ns = namespace()
{body}
"""
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception, [e.message for e in at.exception]
    return at


def captions(at: AppTest) -> str:
    return "\n".join(c.value for c in at.caption)


def data(value: object) -> str:
    return f"json.loads({json.dumps(json.dumps(value))})"


STUDENTS = [
    {"id": f"s{i}", "display_name": f"FICTIONAL STUDENT {i}", "register_number": f"REG{i:03d}", "mentor_name": "MENTOR ONE"}
    for i in range(1, 6)
]


def job(student: str, status: str, created: str, **extra: object) -> dict:
    return {"id": f"j-{student}-{created}", "student_id": student, "status": status, "created_at": created,
            "updated_at": created, **extra}


# R-06: the note names each real reason, and nothing when the card and the list agree
draft = lambda sid, current=True: {"id": f"c-{sid}", "student_id": sid, "evidence_current": current}  # noqa: E731
assert waiting_gap_note({"s1"}, {"drafts": [draft("s1")]}) is None
assert waiting_gap_note(set(), {}) is None
note = waiting_gap_note({"s1"}, {"drafts": [draft("s1"), draft("s2", False)]})
assert note == "The Drafts waiting card also counts 1 draft from a review on earlier figures, kept on record unchanged.", note
note = waiting_gap_note({"s1"}, {"drafts": [draft("s1"), draft("s2"), draft("s3")]})
assert note == "The Drafts waiting card also counts 2 drafts for students whose newer review is still running.", note
note = waiting_gap_note({"s1", "s4"}, {"drafts": [draft("s1")], "legacyDrafts": [draft("s4")]})
assert note == "1 student in the list waits on a draft from the retired rule-based path, which the card does not count.", note

# rendered: the caption comes from the queue the card counts, not from a fixed sentence
REVIEW = {"students": STUDENTS, "jobs": [
    job("s1", "awaiting_faculty", "2026-10-16T10:00:00Z", run_id="r1", flagged=True),
    job("s2", "running", "2026-10-16T11:00:00Z", flagged=True),
    job("s2", "awaiting_faculty", "2026-10-14T10:00:00Z", run_id="r2", flagged=True),
]}
QUEUE = {"awaitingCount": 3, "drafts": [draft("s1"), draft("s2"), draft("s5", False)]}
at = run(f"ns['render_flagged_students']({data(REVIEW)}, {data(QUEUE)})")
shown = captions(at)
assert "1 draft from a review on earlier figures" in shown and "1 draft for students whose newer review is still running" in shown, shown
at = run(f"ns['render_flagged_students']({data(REVIEW)}, {data({'awaitingCount': 1, 'drafts': [draft('s1')]})})")
assert "Drafts waiting card" not in captions(at), captions(at)

print("verify_count_fixes: ok")
