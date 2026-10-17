"""Offline check for spec conformance P2-5: the learning and career records (quiz scores,
internship registration and evaluation, placement readiness, applications and interview
outcomes) are shown with their source and date, within the account's grants, and always
apart from the scored signals as "For context, not scored". Fictional data; no server,
database, model or network.

Source records (mentor and department head profiles): the new records come first, each
row with Source and Date, then the college's original records. The mentor's Signals view
lists them under "For context, not scored", below the scored signals. The student sees
their own records on Profile and their own quiz scores in Learning. A parent sees quiz
scores only with the marks grant and internship and placement records only with the
support grant; otherwise a lock line says they are not shared.
"""

import json
import sys
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
import labels  # noqa: E402
from apptest_util import choose  # noqa: E402
from views.sources import context_rows, internship_rows, placement_rows, quiz_rows  # noqa: E402


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


def profile(role: str, section: str) -> AppTest:
    """A staff profile opened on one section (the picker is clicked, as a person would)."""
    at = run(LOADER + f"ns['render_profile']('s1', {role!r})")
    choose(at, "Section", section).run()
    assert not at.exception, [e.message for e in at.exception]
    return at


def data(value: object) -> str:
    return f"json.loads({json.dumps(json.dumps(value))})"


def captions(at: AppTest) -> str:
    return "\n".join(c.value for c in at.caption)


def frames(at: AppTest) -> list:
    return [df.value for df in at.dataframe]


QUIZZES = [
    {"course": "CS401", "title": "Quiz 1", "score": 7.5, "maximum_score": 10, "taken_at": "2026-09-04T05:15:00.000Z", "source": "LMS quiz log"},
    {"course": "CS401", "title": "Quiz 2", "score": 6, "maximum_score": 10, "taken_at": "2026-09-18T05:15:00.000Z", "source": "LMS quiz log"},
    {"course": "CS402", "title": "Quiz 1", "score": 9, "maximum_score": 10, "taken_at": "2026-09-05T05:15:00.000Z", "source": "LMS quiz log"},
]
INTERNSHIP = {
    "status": "ongoing", "registered_on": "2026-08-01", "organisation": "Fictional Data Labs",
    "role_title": "Data analytics intern", "evaluation_grade": "B+", "evaluation_score": 61,
    "evaluated_on": "2026-09-25", "source": "Internship cell register", "recorded_on": "2026-09-26",
}
PLACEMENT = {
    "readiness_score": 72, "readiness_as_of": "2026-10-03", "applications": 6, "last_applied_on": "2026-10-11",
    "interviews": 2, "offers": 0, "last_outcome": "awaiting_result", "outcome_on": "2026-10-01",
    "source": "Placement cell tracker", "recorded_on": "2026-10-12",
}
INFO = {"scored": False, "note": "For context, not scored", "quizzes": QUIZZES, "career_shared": True,
        "internship": INTERNSHIP, "placement": PLACEMENT}
STUDENT = {"id": "s1", "name": "FICTIONAL STUDENT", "register_number": "REG001", "semester": 6}
DETAIL = {"student": STUDENT, "mentor": {"name": "MENTOR ONE"}, "gpa": {}, "courses": [], "followups": [],
          "grants": ["attendance", "marks", "fees", "support", "private"], "informational": INFO}
RISK = {"riskView": [{"studentId": "s1", "band": "medium", "score": 35, "latest": True, "signals": [
    {"code": "ATTENDANCE_LOW", "source": "academic", "value": 61, "threshold": 75, "points": 20,
     "explanation": "attendancePct is 61; policy threshold is below 75."}]}]}
SOURCES = {"students": [], "sources": [], "unknowns": []}
LOADER = (
    f"DETAIL, RISK, SOURCES = {data(DETAIL)}, {data(RISK)}, {data(SOURCES)}\n"
    "ns['load'] = lambda action, payload=None: {'student': DETAIL, 'review_overview': RISK, 'sources': SOURCES}.get(action, {})\n"
)

# Pure rows: every record carries its source and a date.
for row in [*internship_rows(INTERNSHIP), *placement_rows(PLACEMENT)]:
    assert row["Source"] in ("Internship cell register", "Placement cell tracker") and row["Date"] != "—", row
assert [r["Score"] for r in quiz_rows(QUIZZES)] == ["7.5 / 10", "6 / 10", "9 / 10"]
assert all(r["Source"] == "LMS quiz log" and r["Taken on"] != "—" for r in quiz_rows(QUIZZES))
assert "Course" not in quiz_rows(QUIZZES, with_course=False)[0]
assert internship_rows({**INTERNSHIP, "status": "not_registered"})[0]["Detail"] == "Not registered for an internship"
assert placement_rows({"readiness_score": None, "applications": 0, "interviews": 0, "offers": 0,
                       "source": "Placement cell tracker", "recorded_on": "2026-10-01"})[0]["Detail"] == "Not started this semester"
context = {r["Record"]: r for r in context_rows(DETAIL)}
assert set(context) == {"Quiz scores", "Internship", "Placement"}, context
assert context["Quiz scores"]["Detail"] == "3 quizzes, average 75%", context["Quiz scores"]
assert "Readiness 72 of 100" in context["Placement"]["Detail"] and "waiting for the result" in context["Placement"]["Detail"]
assert labels.INFORMATIONAL_NOTE == "For context, not scored"

# Mentor, Source records: the new records with Source and Date, then the college records.
at = profile("faculty", "Source records")
heads = [h.value for h in at.subheader]
assert heads[1:3] == ["Learning and career records", "College records"], heads
assert "For context, not scored" in captions(at), captions(at)
tables = frames(at)
assert list(tables[0].columns) == ["Course", "Quiz", "Score", "Taken on", "Source"], list(tables[0].columns)
assert list(tables[1].columns) == ["Record", "Detail", "Source", "Date"], list(tables[1].columns)
assert "Data analytics intern at Fictional Data Labs" in tables[1]["Detail"][0]
assert list(tables[2]["Record"]) == ["Readiness", "Latest application", "Latest interview outcome"], list(tables[2]["Record"])

# Department head, Source records: the same records (the department head holds every grant).
at = profile("hod", "Source records")
assert "Learning and career records" in [h.value for h in at.subheader]
assert len(frames(at)) >= 3

# Mentor, Signals: the scored signals first, then the informational fields under the caption.
at = profile("faculty", "Signals")
heads = [h.value for h in at.subheader]
assert heads[-1] == "For context, not scored", heads
assert "not part of the risk score above and do not change any flag" in captions(at), captions(at)
signals, context_table = frames(at)[0], frames(at)[-1]
assert list(signals["Signal"]) == ["Attendance below threshold"], signals
assert list(context_table["Record"]) == ["Quiz scores", "Internship", "Placement"], context_table

# Student: their own records on Profile, their own quiz scores in Learning.
at = run(LOADER + "st.session_state['actor'] = {'role': 'student', 'studentId': 's1'}\n"
         "import views.student\nviews.student.profile_page()")
assert "Your learning and career records" in [h.value for h in at.subheader]
assert len(frames(at)) == 3 and "lock" not in captions(at)
COURSE = {"course": {"id": "o1", "code": "CS401", "title": "Data structures"}, "lessons": [], "assignments": [],
          "submissions": [], "canManage": False, "quizzes": QUIZZES[:2]}
at = run(
    f"COURSE = {data(COURSE)}\n"
    "ns['load'] = lambda action, payload=None: {'courses': [{'id': 'o1', 'code': 'CS401', 'title': 'Data structures', 'section': 'A'}]} if action == 'lms_overview' else COURSE\n"
    "ns['render_lms']({'role': 'student'})"
)
assert "Your quiz scores" in [h.value for h in at.subheader]
quiz_table = next(t for t in frames(at) if "Quiz" in t.columns)
assert list(quiz_table["Score"]) == ["7.5 / 10", "6 / 10"] and "Course" not in quiz_table.columns, quiz_table
# Staff do not get the student's quiz section in Learning.
at = run(
    f"COURSE = {data({**COURSE, 'canManage': True, 'quizzes': []})}\n"
    "ns['load'] = lambda action, payload=None: {'courses': [{'id': 'o1', 'code': 'CS401', 'title': 'Data structures', 'section': 'A'}]} if action == 'lms_overview' else COURSE\n"
    "ns['render_lms']({'role': 'faculty'})"
)
assert "Your quiz scores" not in [h.value for h in at.subheader]

# Parent: within the grants the Core applied (null quizzes, career_shared false).
PARENT = {**DETAIL, "grants": ["attendance"], "informational": {**INFO, "quizzes": None, "career_shared": False,
                                                                 "internship": None, "placement": None}}
PARENT_SCRIPT = (
    f"DETAIL = {data(PARENT)}\n"
    "st.session_state['actor'] = {'role': 'parent'}\n"
    "ns['load'] = lambda action, payload=None: {'children': [{'id': 's1', 'name': 'FICTIONAL STUDENT'}]} if action == 'overview' else DETAIL\n"
    "import views.parent\nviews.parent.profile_page()"
)
at = run(PARENT_SCRIPT)
shown = captions(at)
assert "Quiz scores are not shared with this account." in shown, shown
assert "Internship and placement records are not shared with this account." in shown, shown
assert not frames(at), "nothing is tabled without the grants"
at = run(PARENT_SCRIPT.replace(data(PARENT), data({**DETAIL, "grants": ["marks", "support"]})))
assert len(frames(at)) == 3 and "not shared" not in captions(at)

# An engine without the records (before the migration) still renders.
at = run(f"DETAIL = {data({k: v for k, v in DETAIL.items() if k != 'informational'})}\n"
         "st.session_state['actor'] = {'role': 'student', 'studentId': 's1'}\n"
         "ns['load'] = lambda action, payload=None: DETAIL\nimport views.student\nviews.student.profile_page()")

print(json.dumps({"status": "passed", "checks": [
    "rows carry source and date", "mentor and department head Source records", "mentor Signals context caption",
    "student profile and Learning quiz scores", "parent grants", "engine without the records",
]}))
