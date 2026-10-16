"""Offline checks for fix batch B1 (16 Oct review): counts that must agree across
screens. Fictional data; no server, database, model or network.

R-06: the department head's Drafts waiting card and the flagged list give the real
reason when they differ (a draft on earlier figures, a newer review still running,
or a draft from the retired rule-based path), and say nothing when they agree.
R-08: AI activity "Waiting for AI" counts each student's latest review only, like the
other cards on the Runs page.
R-09: the department head's "Flagged students" lists only reviews the risk check
flagged (the Core's `flagged`, never the score); reviews that stopped before the risk
check are listed apart as "Reviews that stopped early".
R-10: the department head's Mentors table counts declines as decisions and its last
decision time includes them; the page caption promises only what the table shows.
R-11: the student and parent "Attendance this term" card shows the Core's pooled
figure (the value the risk check and the plan cite), not a mean of course percentages.
Batch B2, P2-3: the mentor's Today lists the reviews that stopped and wait on the mentor
(each student's latest review only) and opens that plan under Reviews > Start a review.
P2-4: Mentees > Outcomes shows the support trends for the mentor's own review cycles."""

import json
import sys
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
from views.hod import mentor_workload, waiting_gap_note  # noqa: E402


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

# R-08: an earlier review with no model answer does not count once a newer review ran
RUNS = {"students": STUDENTS, "metrics": {"totals": {}}, "jobs": [
    job("s1", "ai_unavailable", "2026-10-14T10:00:00Z"),
    job("s1", "awaiting_faculty", "2026-10-16T10:00:00Z", run_id="r1"),
    job("s2", "ai_unavailable", "2026-10-16T09:00:00Z"),
    job("s3", "ai_unavailable", "2026-10-15T09:00:00Z"),
    job("s3", "ai_unavailable", "2026-10-16T08:00:00Z"),
]}
at = run(f"REVIEW = {data(RUNS)}\nns['load'] = lambda action, payload=None: REVIEW\nns['runs_page']()")
metrics = {m.label: m.value for m in at.metric}
assert metrics["Waiting for AI"] == "2", metrics
assert metrics["Students checked"] == "3", metrics

# R-09: flagged means the risk check flagged the student; stopped reviews are listed apart
FLAGS = {"students": STUDENTS, "jobs": [
    job("s1", "awaiting_faculty", "2026-10-16T10:00:00Z", run_id="r1", flagged=True),
    job("s2", "blocked", "2026-10-16T10:00:00Z", error_code="DATA_BLOCKED", flagged=False),
    job("s3", "needs_human", "2026-10-16T10:00:00Z", error_code="LEASE_EXPIRED", flagged=False),
    job("s4", "ai_unavailable", "2026-10-16T10:00:00Z", flagged=True),
    job("s5", "not_flagged", "2026-10-16T10:00:00Z", flagged=False),
    job("s5", "failed", "2026-10-15T10:00:00Z", flagged=False),
]}
at = run(f"ns['render_flagged_students']({data(FLAGS)}, {data({'awaitingCount': 1, 'drafts': [draft('s1')]})})")
heads = [h.value for h in at.subheader]
assert heads == ["Flagged students (2)", "Reviews that stopped early (2)"], heads
tables = [t.value for t in at.dataframe]
assert sorted(tables[0]["Register number"]) == ["REG001", "REG004"], tables[0]
assert sorted(tables[1]["Register number"]) == ["REG002", "REG003"], tables[1]
assert "Drafts waiting card" not in captions(at), captions(at)
# nobody flagged: the empty state, and the stopped reviews still listed
at = run(f"ns['render_flagged_students']({data({'students': STUDENTS, 'jobs': FLAGS['jobs'][1:3]})})")
assert [h.value for h in at.subheader] == ["Flagged students (0)", "Reviews that stopped early (2)"], [h.value for h in at.subheader]

# R-10: a mentor who only declined shows those decisions and when the last one was made
OVERVIEW = {
    "students": STUDENTS[:2] + [{**STUDENTS[2], "mentor_name": "MENTOR TWO"}],
    "faculty": [{"name": "MENTOR ONE"}, {"name": "MENTOR TWO"}, {"name": "MENTOR THREE"}],
}
DECISIONS = {"plans": [], "drafts": [], "mentorDecisions": [
    {"mentor_name": "MENTOR ONE", "decisions": 5, "approved": 0, "declined": 5, "last_decided_at": "2026-10-16T09:30:00+00:00"},
    {"mentor_name": "MENTOR TWO", "decisions": 2, "approved": 1, "declined": 1, "last_decided_at": "2026-10-15T09:30:00+00:00"},
]}
rows = {r["Mentor"]: r for r in mentor_workload(OVERVIEW, DECISIONS)}
assert rows["Mentor One"]["Decisions made"] == 5 and rows["Mentor One"]["Last decision"] != "None yet", rows["Mentor One"]
assert rows["Mentor Two"]["Decisions made"] == 2, rows["Mentor Two"]
assert rows["Mentor Three"]["Decisions made"] == 0 and rows["Mentor Three"]["Last decision"] == "None yet", rows["Mentor Three"]
at = run(
    f"OVERVIEW, QUEUE = {data(OVERVIEW)}, {data(DECISIONS)}\n"
    "ns['load_many'] = lambda requests: [OVERVIEW if name == 'overview' else QUEUE for name, _ in requests]\n"
    "ns['mentors_page']()"
)
shown = captions(at) + "\n" + "\n".join(str(h.proto.body) for h in at.get("html"))
assert "how quickly" not in shown, shown
assert "approved or declined" in shown and "Decisions made counts approvals and declines" in shown, shown
table = at.dataframe[0].value
assert list(table["Decisions made"]) == [5, 0, 2], table

# R-11: courses with unequal session counts. Pooled: 26 of 40 attended = 65%; the
# unweighted mean of the course percentages would say 80%.
DETAIL = {
    "student": {"id": "s1", "name": "FICTIONAL STUDENT"},
    "grants": ["attendance", "marks", "fees", "support"],
    "courses": [
        {"offering_id": "o1", "code": "CS201", "title": "Data structures", "percentage": 100, "present": 6, "late": 0, "absent": 0},
        {"offering_id": "o2", "code": "CS202", "title": "Algorithms", "percentage": 59, "present": 20, "late": 0, "absent": 14},
    ],
    "attendance_overall": 65,
    "support": [], "invoices": [], "followups": [], "marks": [], "attendance": [],
}
at = run(
    f"DETAIL = {data(DETAIL)}\n"
    "st.session_state['actor'] = {'role': 'student', 'studentId': 's1', 'displayName': 'Fictional Student'}\n"
    "ns['load'] = lambda action, payload=None: DETAIL\n"
    "import views.student\nviews.student.overview_page()"
)
assert {m.label: m.value for m in at.metric}["Attendance this term"] == "65%", [(m.label, m.value) for m in at.metric]
at = run(
    f"DETAIL = {data({**DETAIL, 'attendance_overall': 66.66666666666667})}\n"
    "OVERVIEW = {'children': [{'id': 's1', 'name': 'FICTIONAL STUDENT'}]}\n"
    "st.session_state['actor'] = {'role': 'parent', 'displayName': 'Fictional Parent'}\n"
    "ns['load'] = lambda action, payload=None: OVERVIEW if action == 'overview' else DETAIL\n"
    "import views.parent\nviews.parent.overview_page()"
)
assert {m.label: m.value for m in at.metric}["Attendance this term"] == "66.7%", [(m.label, m.value) for m in at.metric]

# P2-3: Today's "Needs your decision" lists each student's latest stopped review
TODAY = {"students": STUDENTS, "riskView": [], "jobs": [
    job("s1", "needs_human", "2026-10-16T10:00:00Z", plan_id="p1", error_code="REPAIR_BUDGET_EXHAUSTED"),
    job("s2", "ai_unavailable", "2026-10-16T09:00:00Z", plan_id="p2", error_code="AI_UNAVAILABLE"),
    job("s3", "ai_unavailable", "2026-10-14T09:00:00Z", plan_id="p3", error_code="AI_UNAVAILABLE"),
    job("s3", "awaiting_faculty", "2026-10-16T08:00:00Z", plan_id="p4"),
    job("s4", "not_flagged", "2026-10-16T08:00:00Z", plan_id="p4"),
]}
TODAY_SCRIPT = (
    f"REVIEW = {data(TODAY)}\n"
    "st.session_state['actor'] = {'role': 'faculty', 'displayName': 'Mentor One'}\n"
    "ns['load_many'] = lambda requests: [{'followups': []} if name == 'overview' else "
    "({'drafts': []} if name == 'review_queue' else REVIEW) for name, _ in requests]\n"
    "st.switch_page = lambda page: st.session_state.__setitem__('switched', page.url_path)\n"
    "import views.mentor\nviews.mentor.today_page()"
)
at = run(TODAY_SCRIPT)
assert "Needs your decision (2)" in [h.value for h in at.subheader], [h.value for h in at.subheader]
shown = "\n".join(str(h.proto.body) for h in at.get("html"))
assert "failed its checks after every repair" in shown and "No AI model answered" in shown, shown
opens = [b for b in at.button if b.label.startswith("Open the review for")]
assert [b.label for b in opens] == ["Open the review for Fictional Student 1", "Open the review for Fictional Student 2"], [b.label for b in opens]
opens[0].click()
at.run()
assert not at.exception, [e.message for e in at.exception]
assert at.session_state["open_review_plan"] == "p1" and at.session_state["switched"] == "reviews"
# nothing stopped: a calm empty state
at = run(TODAY_SCRIPT.replace("REVIEW = ", "REVIEW = {'students': [], 'jobs': []} or "))
assert "Needs your decision" in [h.value for h in at.subheader]
assert "Nothing needs a decision" in "\n".join(str(h.proto.body) for h in at.get("html"))
# Reviews opens Start a review with that plan chosen
PLANS = [
    {"id": pid, "revision": 1, "status": "locked", "paused": False,
     "body": {"request": f"Review plan {pid}", "studentIds": ["s1"], "questions": []}}
    for pid in ("p1", "p2")
]
at = run(
    f"REVIEW = {data({'students': STUDENTS, 'policies': [], 'plans': PLANS, 'jobs': []})}\n"
    "st.session_state['open_review_plan'] = 'p2'\n"
    "ns['load_many'] = lambda requests: [{'drafts': []} if name == 'review_queue' else REVIEW for name, _ in requests]\n"
    "import views.mentor\nviews.mentor.reviews_body({'role': 'faculty'})"
)
from apptest_util import picker  # noqa: E402

assert picker(at, "Plan").value == "p2", picker(at, "Plan").value

# P2-4: the mentor's Outcomes view ends with the review trends (scoped by the Core)
TRENDS = {"students": STUDENTS, "plans": [{"id": "p1", "created_at": "2026-10-16T10:00:00Z", "body": {}}],
          "trends": [{"cycle_id": "p1", "day": "2026-10-16 / p1", "reviewed": 2, "flagged": 1, "approved": 1}]}
at = run(
    "st.session_state['actor'] = {'role': 'faculty'}\n"
    "st.session_state['mentees_view'] = 'Outcomes'\n"
    f"REVIEW = {data(TRENDS)}\n"
    "ns['load_many'] = lambda requests: [{'plans': []} if name == 'review_queue' else REVIEW for name, _ in requests]\n"
    "import views.mentor\nviews.mentor.mentees_body()"
)
heads = [h.value for h in at.subheader]
assert "Intervention outcomes" in heads and "Support trends by review cycle" in heads, heads

print("verify_count_fixes: ok")
