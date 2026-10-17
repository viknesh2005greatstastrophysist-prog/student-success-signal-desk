"""Offline check for the owner decisions of 17 Oct: the department head sees everything in
the department and can decide drafts if needed, but never plans or runs a review or
approves a policy. Fictional data; no server, database, model or network.

Covered: the department head's Reviews page (drafts across the department with a Mentor
column and filter and the decision form, and Outcomes with the update form; no Start a
review); the Policies page lists the approved policies and the scoring detail read-only
with the footnote "Mentors approve their own scoring policies; the department head can
read them."; a student's profile, Support plans tab, shows the draft and the mentor's
approve, edit and decline form; the Overview's flagged list shows the risk band and
score, below "Conversations not submitted" (the department head's main job: check that
mentors met their students and message the mentor when they have not); and none of the
old "the department head only observes" or "acts on everything" wording is left in the
screens."""

import json
import re
import sys
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
from apptest_util import choose, picker  # noqa: E402

HOD = {"role": "hod", "displayName": "Department Head"}
M1, M2 = "aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002"
S1, S2 = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
POLICY = "7ba9aaf6-9a6e-40eb-bc11-600257503a31"
DRAFT = {
    "id": "33333333-3333-4333-8333-333333333333",
    "student_id": S1,
    "display_name": "ASHA RAO",
    "register_number": "01FE23BCI024",
    "revision": 2,
    "status": "awaiting_faculty",
    "mode": "model",
    "model_id": "groq:qwen/qwen3.8-27b",
    "drafted_at": "2026-10-16T08:00:00.000Z",
    "artifact_id": "44444444-4444-4444-8444-444444444444",
    "content_hash": "c" * 64,
    "validation": {"valid": True},
    "parent_support_access": True,
    "recommendation": {
        "summary": "Meet Asha this week about attendance in two courses.",
        "actions": [{"code": "faculty-check-in", "label": "Schedule a 20-minute check-in", "owner": "assigned_faculty", "dueInDays": 5}],
    },
}
OTHER = {**DRAFT, "id": "33333333-3333-4333-8333-333333333334", "student_id": S2, "display_name": "BHARAT KULKARNI",
         "register_number": "01FE23BCI031", "artifact_id": "44444444-4444-4444-8444-444444444445"}
PLAN = {
    "id": "55555555-5555-4555-8555-555555555555", "student_id": S1, "display_name": "ASHA RAO", "register_number": "01FE23BCI024",
    "visible_to_student": True, "plan": DRAFT["recommendation"], "decision": "approved", "rationale": "Agreed with the student",
    "decided_at": "2026-10-10T08:00:00.000Z", "decided_by": "DR MIRA SEN", "status": "planned", "revision": 0, "outcome": "",
    "evidence_current": True,
}
STUDENTS = [
    {"id": S1, "register_number": "01FE23BCI024", "display_name": "ASHA RAO", "mentor_id": M1, "mentor_name": "DR MIRA SEN"},
    {"id": S2, "register_number": "01FE23BCI031", "display_name": "BHARAT KULKARNI", "mentor_id": M2, "mentor_name": "DR ARUN DESAI"},
]
RISK = [{"studentId": S1, "band": "high", "score": 72, "latest": True, "signals": []}]
REVIEW = {
    "modelConfigured": True, "students": STUDENTS, "riskView": RISK, "plans": [], "trends": [],
    "policies": [{"id": POLICY, "policy": {"version": "SEN-REVIEW-V1"}, "rationale": "Approved for the cycle.", "faculty_person_id": M1}],
    "jobs": [
        {"id": "j1", "plan_id": "p1", "student_id": S1, "status": "awaiting_faculty", "flagged": True, "mode": "model",
         "model_id": "groq:qwen/qwen3.8-27b", "risk": {"band": "high", "score": 72, "flagged": True}, "created_at": "2026-10-16T08:00:00Z"},
    ],
}
QUEUE = {"drafts": [DRAFT, OTHER], "legacyDrafts": [], "plans": [PLAN], "versions": [], "interventionLog": [], "awaitingCount": 2}
DETAIL = {"student": {"id": S1, "name": "ASHA RAO", "register_number": "01FE23BCI024", "semester": 5},
          "mentor": {"name": "DR MIRA SEN"}, "courses": [], "followups": [], "support": [],
          "grants": ["attendance", "marks", "fees", "support", "private"]}
LATE = {"case_id": DRAFT["id"], "plan_id": None, "case_status": "awaiting_faculty", "student_id": S1,
        "student_name": "ASHA RAO", "register_number": "01FE23BCI024", "mentor_id": M1, "mentor_name": "DR MIRA SEN",
        "report_on": "2026-09-30", "meet_by": "2026-10-07", "deadline": "2026-10-14", "days_since": 17,
        "stage": "past_deadline", "days_left": None, "days_overdue": 10, "checkin": None, "meeting": None, "reminder": None}
OVERVIEW = {"students": STUDENTS, "faculty": [], "counts": {"students": 2}, "meetings": [LATE]}


def data(value: object) -> str:
    return f"json.loads({json.dumps(json.dumps(value))})"


LOADER = (
    f"REVIEW, QUEUE, DETAIL, OVERVIEW = {data(REVIEW)}, {data(QUEUE)}, {data(DETAIL)}, {data(OVERVIEW)}\n"
    "DATA = {'review_overview': REVIEW, 'review_queue': QUEUE, 'student': DETAIL, 'overview': OVERVIEW}\n"
    "ns['load'] = lambda action, payload=None: DATA.get(action, {})\n"
    "ns['load_many'] = lambda requests: [DATA.get(a, {}) for a, _ in requests]\n"
    f"st.session_state['actor'] = {data(HOD)}\n"
)


def run(body: str) -> AppTest:
    script = f"""
import json, sys
import streamlit as st
sys.path.insert(0, {str(APP)!r})
from apptest_util import namespace
ns = namespace()
def fake_save(action, data, success):
    st.session_state.setdefault("calls", []).append([action, data, success])
    return {{}}
ns["save_action"] = fake_save
{LOADER}
{body}
"""
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception, [e.message for e in at.exception]
    return at


def text_of(at: AppTest) -> str:
    parts = [m.value for m in at.markdown] + [c.value for c in at.caption]
    parts += [w.value for w in at.warning] + [i.value for i in at.info]
    parts += [df.value.to_csv(index=False) for df in at.dataframe]
    parts += [str(el.proto.body) for el in at.get("html")]
    return "\n".join(str(p) for p in parts)


DECISIONS = ["Approve and publish", "Edit", "Decline"]

# 1. Reviews > Drafts at the gate: every draft in the department, a Mentor column and filter.
at = run("import views.hod as hod\nhod.reviews_page()")
section = at.segmented_control(key="head_reviews_section")
assert list(section.options) == ["Drafts at the gate (2)", "Outcomes"], section.options
table = next(df.value for df in at.dataframe if "Mentor" in df.value.columns)
assert list(table["Mentor"]) == ["Dr Mira Sen", "Dr Arun Desai"], list(table["Mentor"])
assert list(table["Risk"]) == ["High risk · 72", "—"], list(table["Risk"])
assert [b.label for b in at.button if b.label in DECISIONS] == DECISIONS
choose(at, "Mentor", "Dr Arun Desai").run()
table = next(df.value for df in at.dataframe if "Mentor" in df.value.columns)
assert list(table["Register number"]) == ["01FE23BCI031"], "the filter keeps that mentor's students"
assert "You decide as the department head for Dr Arun Desai's mentee" in text_of(at)

# 3. Outcomes: the update form, the same one the mentor has.
at.segmented_control(key="head_reviews_section").set_value("Outcomes").run()
assert "Save outcome" in [b.label for b in at.button], [b.label for b in at.button]

assert "Create a review plan" not in text_of(at), "no Start a review"

# 4. Policies: the approved policies and the scoring detail, read-only.
at = run("import views.hod as hod\nhod.policies_page()")
shown = text_of(at)
assert "SEN-REVIEW-V1" in shown, "the approved policy is listed"
assert "Mentors approve their own scoring policies; the department head can read them." in shown
assert "Approve policy" not in [b.label for b in at.button], "no approve control"
assert not [w for w in at.text_input], "no policy form"
assert any("Policy version" in df.value.columns for df in at.dataframe), "the scoring detail table"

# 5. A student's profile, Support plans: the draft and the mentor's form.
at = run(f"ns['render_profile']({S1!r}, 'hod')")
choose(at, "Section", "Support plans").run()
assert not at.exception, [e.message for e in at.exception]
shown = text_of(at)
assert "Meet Asha this week about attendance in two courses." in shown, "the department head reads the draft"
assert [b.label for b in at.button if b.label in DECISIONS] == DECISIONS
next(t for t in at.text_area if t.label == "Decision rationale").set_value("Not the right step yet")
next(b for b in at.button if b.label == "Decline").click().run()
action, payload, _ = at.session_state["calls"][-1]
assert action == "case_decide" and payload["decision"] == "rejected" and payload["caseId"] == DRAFT["id"], (action, payload)
choose(at, "Section", "Signals").run()
assert not at.exception, [e.message for e in at.exception]

# 6. Overview: the department head's main job comes first, conversations not submitted
# with "Message the mentor" for a past-deadline student; then the flagged list with the
# band and score.
at = run("import views.hod as hod\nhod.overview_page()")
headings = [h.value for h in at.subheader]
assert headings.index("Conversations not submitted (1)") < headings.index("Flagged students (1)"), headings
assert "Message the mentor" in [b.label for b in at.button]
late = next(m for m in at.metric if m.label == "Conversations past the deadline")
assert late.value == "1", late.value
flagged = next(df.value for df in at.dataframe if "Risk" in df.value.columns)
assert list(flagged["Risk"]) == ["High risk · 72"], list(flagged["Risk"])

# 7. None of the old "observe only" wording is left in the screens.
OLD = [
    "Mentors alone decide",
    "the department head observes",
    "only the assigned mentor sees its content",
    "Mentors approve them; you can read them",
    "Only the assigned faculty mentor can approve a scoring policy",
    "visible only to the student's assigned mentor",
    "visible only to the student's mentor",
    "can see and act on everything",
    "You can approve one for any mentor",
    "starts one for a mentor's",
    "Meetings pending",
    "Meetings to record",
    "Approve a mentor policy for",
]
for path in sorted((APP / "views").glob("*.py")):
    source = path.read_text(encoding="utf-8")
    for phrase in OLD:
        assert phrase not in source, (path.name, phrase)
assert re.search(r"the department head can see everything", (APP / "views" / "reviews.py").read_text())

print(json.dumps({"status": "passed", "checks": [
    "HoD Reviews drafts with Mentor column and filter, no Start a review",
    "HoD Outcomes update form", "HoD Policies read-only with footnote", "HoD profile draft and decision form",
    "HoD Overview leads with conversations not submitted", "HoD flagged list band and score",
    "old observe-only wording removed",
]}))
