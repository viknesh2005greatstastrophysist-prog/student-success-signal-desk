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
P2-4: Mentees > Outcomes shows the support trends for the mentor's own review cycles.
R-14 to R-18 (wording): "Visible to family" needs a shown plan on current figures; the
profile captions name everyone who can see the record; students without a mentor are a
separate line, not a mentor row; a withdrawn approved plan reads "Approved, then
withdrawn"; a parent without the support or fees grant is told it is not shared.
Earlier figures: the "Based on earlier figures" count and the "Review ... again" buttons
agree, or a caption says why some students have no button (frozen, or past the first three)."""

import json
import sys
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
import labels  # noqa: E402
from views.hod import mentor_workload, students_without_mentor, waiting_gap_note  # noqa: E402


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

# R-14: "Visible to family" is Yes only for a shown plan on current figures
PLAN_ROWS = [
    {"id": "sp1", "student_id": "s1", "display_name": "FICTIONAL STUDENT 1", "status": "planned", "visible_to_student": True, "evidence_current": True, "plan": {"actions": []}},
    {"id": "sp2", "student_id": "s2", "display_name": "FICTIONAL STUDENT 2", "status": "planned", "visible_to_student": True, "evidence_current": False, "plan": {"actions": []}},
    {"id": "sp3", "student_id": "s3", "display_name": "FICTIONAL STUDENT 3", "status": "withdrawn", "visible_to_student": False, "evidence_current": True, "plan": {"actions": []}},
]
at = run(f"ns['render_outcomes']({data({'plans': PLAN_ROWS})}, {{'role': 'hod'}})")
log = next(df.value for df in at.dataframe if "Visible to family" in df.value.columns)
assert "Visible" not in log.columns, list(log.columns)
assert list(log["Visible to family"]) == ["Yes", "No", "No"], list(log["Visible to family"])

# R-15: the profile captions name the mentor, the department head and the course teachers
PROFILE = {"student": {"id": "s1", "name": "FICTIONAL STUDENT", "register_number": "REG001"}, "mentor": {"name": "MENTOR ONE"}, "gpa": {}}
at = run(
    f"DETAIL = {data(PROFILE)}\n"
    "st.session_state['actor'] = {'role': 'student', 'studentId': 's1'}\n"
    "ns['load'] = lambda action, payload=None: DETAIL\n"
    "import views.student\nviews.student.profile_page()"
)
assert "Your mentor, your department head and your course teachers can also see your college record." in captions(at), captions(at)
at = run(
    f"DETAIL = {data(PROFILE)}\n"
    "st.session_state['actor'] = {'role': 'parent'}\n"
    "ns['load'] = lambda action, payload=None: {'children': [{'id': 's1', 'name': 'FICTIONAL STUDENT'}]} if action == 'overview' else DETAIL\n"
    "import views.parent\nviews.parent.profile_page()"
)
assert "mentor, department head and course teachers can also see the student's college record" in captions(at), captions(at)
assert "Only you" not in captions(at), captions(at)

# R-16: a student without a mentor is a separate line, never a mentor called "Unassigned"
UNASSIGNED = {**OVERVIEW, "students": OVERVIEW["students"] + [{"id": "s9", "display_name": "FICTIONAL NINE", "mentor_name": None}]}
assert "Unassigned" not in {r["Mentor"] for r in mentor_workload(UNASSIGNED, DECISIONS)}
assert students_without_mentor(UNASSIGNED) == 1 and students_without_mentor(OVERVIEW) == 0
at = run(
    f"OVERVIEW, QUEUE = {data(UNASSIGNED)}, {data(DECISIONS)}\n"
    "ns['load_many'] = lambda requests: [OVERVIEW if name == 'overview' else QUEUE for name, _ in requests]\n"
    "ns['mentors_page']()"
)
assert "Students without a mentor: 1" in captions(at), captions(at)
assert "Unassigned" not in " ".join(at.dataframe[0].value["Mentor"]), at.dataframe[0].value

# R-17: an approved case whose plan the mentor withdrew
assert labels.run_outcome("approved", None, "withdrawn") == "Approved, then withdrawn"
assert labels.run_outcome("approved", None, "planned") == "Plan approved by the mentor"
assert labels.run_outcome("approved") == "Plan approved by the mentor"

# R-18: without the support or fees grant the parent is told so, not "None yet"
PARENT = {**DETAIL, "grants": ["attendance", "marks"], "support": [], "invoices": [], "followups": []}
PARENT_SCRIPT = (
    "OVERVIEW = {'children': [{'id': 's1', 'name': 'FICTIONAL STUDENT'}]}\n"
    "st.session_state['actor'] = {'role': 'parent', 'displayName': 'Fictional Parent'}\n"
    "ns['load'] = lambda action, payload=None: OVERVIEW if action == 'overview' else DETAIL\n"
    "import views.parent\nviews.parent.{page}()"
)


def parent_page(detail: dict, page: str) -> AppTest:
    return run(f"DETAIL = {data(detail)}\n" + PARENT_SCRIPT.replace("{page}", page))


def page_text(at: AppTest) -> str:
    return captions(at) + "\n" + "\n".join(str(h.proto.body) for h in at.get("html"))


figures = {m.label: m.value for m in parent_page(PARENT, "overview_page").metric}
assert figures["Support plan"] == "Not shared" and figures["Open fee balance"] == "Not shared", figures
for page in ("support_page", "fees_page"):
    shown = page_text(parent_page(PARENT, page))
    assert "This information is not shared with your account." in shown, (page, shown)
    assert "Nothing here yet" not in shown and "No fee records" not in shown, (page, shown)
# with the grants, an empty record still reads as empty
granted = {**PARENT, "grants": ["attendance", "marks", "fees", "support"]}
assert {m.label: m.value for m in parent_page(granted, "overview_page").metric}["Support plan"] == "None yet"
assert "No fee records" in page_text(parent_page(granted, "fees_page"))
assert "Nothing here yet" in page_text(parent_page(granted, "support_page"))

# Earlier figures: the count, the buttons and the caption agree
def stale_plan(sid: str, **extra: object) -> dict:
    return {"id": f"sp-{sid}", "student_id": sid, "display_name": f"STUDENT {sid}", "evidence_current": False, **extra}


def rereview(rows: list) -> tuple[str, list[str]]:
    at = run(f"ns['render_rereview']({data(rows)}, role='faculty', key='rr')")
    shown = captions(at) + "\n" + "\n".join(str(h.proto.body) for h in at.get("html"))
    return shown, [b.label for b in at.button if b.label.startswith("Review ")]


# four students, one frozen (as seen locally: 4 in the box, 3 buttons)
shown, buttons = rereview([stale_plan("a", frozen=True), stale_plan("b"), stale_plan("c"), stale_plan("d", status="withdrawn")])
assert "4 students with a plan computed before the latest data refresh" in shown, shown
assert len(buttons) == 3, buttons
assert "3 of these 4 can be reviewed again below. 1 is kept unchanged for the project presentation." in shown, shown
# more students than buttons: the rest are pointed to Start a review
shown, buttons = rereview([stale_plan(s) for s in "abcde"])
assert len(buttons) == 3 and "3 of these 5 can be reviewed again below. Start the other 2 from Reviews > Start a review." in shown, shown
# the same student twice counts once; every student has a button, so no caption
shown, buttons = rereview([stale_plan("a"), stale_plan("a"), stale_plan("b")])
assert "2 students with a plan" in shown and len(buttons) == 2 and "can be reviewed again below" not in shown, shown
shown, buttons = rereview([stale_plan("a", frozen=True)])
assert not buttons and "None of these can be reviewed again here. 1 is kept unchanged" in shown, shown

print("verify_count_fixes: ok")
