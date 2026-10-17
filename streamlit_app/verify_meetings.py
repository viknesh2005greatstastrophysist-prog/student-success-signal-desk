"""Offline check for meeting records after a support plan (owner request, 17 Oct).
Fictional data; no server, database, model or network.

The mentor's Today lists "Meetings to record (N)" above Check-ins: one card per approved
current plan without a meeting record, saying when the check-in was due; once seven days
overdue the card adds "Now visible to the department head". "Record the meeting" opens a
form (date met, reasons from the fixed list, note, what was agreed) that sends
record-meeting; "Other" needs a note and a future date is refused. With nothing pending
the section says "No meetings to record". The department head's Overview lists "Meetings
pending (N)", overdue first. The profile and Outcomes read "Meeting held <date>: <reasons>"
or "Meeting not recorded, due <date>"; the student and parent see only "Your mentor met
you on <date>", never the reasons. The reasons list matches the Core and migration 014."""

import json
import re
import sys
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent
ROOT = APP.parent
sys.path.insert(0, str(APP))
import labels  # noqa: E402
from apptest_util import choose  # noqa: E402

S1, S2, S3 = (f"00000000-0000-4000-8000-00000000000{i}" for i in (1, 2, 3))
P1, P2, P3 = (f"55555555-5555-4555-8555-55555555555{i}" for i in (1, 2, 3))
F1 = "66666666-6666-4666-8666-666666666661"
MEETING = {
    "id": "77777777-7777-4777-8777-777777777771", "followup_id": "66666666-6666-4666-8666-666666666663",
    "met_on": "2026-10-15", "reasons": ["Health", "Course difficulty"], "note": "Tired after the fever",
    "agreed_next_step": "Two tutorials a week", "recorded_by": "DR MIRA SEN", "recorded_at": "2026-10-15T10:00:00Z",
}
MEETINGS = [
    {"plan_id": P1, "student_id": S1, "student_name": "ASHA RAO", "register_number": "01FE23BCI024",
     "mentor_id": "m1", "mentor_name": "DR MIRA SEN", "approved_at": "2026-10-01T08:00:00Z", "meeting": None,
     "checkin": {"id": F1, "due_on": "2026-10-08", "status": "planned"}, "due_on": "2026-10-08",
     "days_overdue": 9, "head_notice": True},
    {"plan_id": P2, "student_id": S2, "student_name": "BHARAT KULKARNI", "register_number": "01FE23BCI031",
     "mentor_id": "m1", "mentor_name": "DR MIRA SEN", "approved_at": "2026-10-14T08:00:00Z", "meeting": None,
     "checkin": None, "due_on": "2026-10-19", "days_overdue": -2, "head_notice": False},
    {"plan_id": P3, "student_id": S3, "student_name": "CHITRA NAIK", "register_number": "01FE23BCI040",
     "mentor_id": "m1", "mentor_name": "DR MIRA SEN", "approved_at": "2026-10-05T08:00:00Z", "meeting": MEETING,
     "checkin": {"id": MEETING["followup_id"], "due_on": "2026-10-12", "status": "completed"}, "due_on": "2026-10-12",
     "days_overdue": 5, "head_notice": False},
]
OVERVIEW = {"meetings": MEETINGS, "followups": [], "students": [], "faculty": [], "counts": {"students": 3}}
EMPTY = {"meetings": [MEETINGS[2]], "followups": [], "students": [], "counts": {}}


def data(value: object) -> str:
    return f"json.loads({json.dumps(json.dumps(value))})"


def run(body: str, overview: dict = OVERVIEW, actor: dict | None = None, extra: str = "") -> AppTest:
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
ns["_review_again"] = lambda student_id, role: st.session_state.update(review_again=[student_id, role])
OVERVIEW = {data(overview)}
DATA = {{"overview": OVERVIEW, "review_queue": {{"drafts": []}}, "review_overview": {{"jobs": [], "students": []}}}}
{extra}
ns["load"] = lambda action, payload=None: DATA.get(action, {{}})
ns["load_many"] = lambda requests: [DATA.get(a, {{}}) for a, _ in requests]
st.session_state["actor"] = {data(actor or {"role": "faculty", "displayName": "Dr Mira Sen"})}
{body}
"""
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception, [e.message for e in at.exception]
    return at


def text_of(at: AppTest) -> str:
    parts = [h.value for h in at.subheader] + [m.value for m in at.markdown] + [c.value for c in at.caption]
    parts += [t.value for t in at.text] + [w.value for w in at.warning] + [i.value for i in at.info] + [e.value for e in at.error]
    parts += [df.value.to_csv(index=False) for df in at.dataframe]
    parts += [str(el.proto.body) for el in at.get("html")]
    return "\n".join(str(p) for p in parts)


def headings(at: AppTest) -> list[str]:
    return [h.value for h in at.subheader] + [m.value for m in at.markdown if m.value.startswith("#")]


# 1. The reasons list is the Core's, in the same order, and migration 014 allows exactly it.
core = (ROOT / "platform/services/core-api/lib/meetings.ts").read_text(encoding="utf-8")
core_list = re.search(r"MEETING_REASONS = \[(.*?)\] as const", core, re.S).group(1)
assert re.findall(r'"([^"]+)"', core_list) == labels.MEETING_REASONS, "Core and screens list the same reasons"
migration = (ROOT / "platform/services/core-api/migrations/014_meeting_records.sql").read_text(encoding="utf-8")
sql_list = re.search(r"reasons <@ ARRAY\[(.*?)\]::text\[\]", migration, re.S).group(1)
assert re.findall(r"'([^']+)'", sql_list) == labels.MEETING_REASONS, "migration 014 allows exactly that list"

# 2. Today: "Meetings to record (2)" above Check-ins, one card per plan without a record.
at = run("import views.mentor as mentor\nmentor.today_page()")
text = text_of(at)
order = [h.value for h in at.subheader if h.value in ("Meetings to record (2)", "Check-ins")]
assert order[:2] == ["Meetings to record (2)", "Check-ins"], order
assert (
    "Check-in with Asha Rao was due 8 Oct 2026 (9 days ago). Record when you met and the reasons the student gave. "
    "Now visible to the department head." in text
), text
assert "Check-in with Bharat Kulkarni is due 19 Oct 2026 (in 2 days). Record when you met and the reasons the student gave." in text
assert "Bharat Kulkarni is due 19 Oct 2026 (in 2 days). Record when you met and the reasons the student gave. Now visible" not in text
assert "Chitra Naik" not in text, "a plan with its meeting recorded has no card"
labels_shown = [b.label for b in at.button]
assert labels_shown.count("Record the meeting") == 2 and labels_shown.count("Review again with the latest figures") == 2
next(b for b in at.button if b.key == f"meeting_rereview_{P2}").click().run()
assert at.session_state["review_again"] == [S2, "faculty"], "opens a new review for that student"

# 3. The form: reasons from the fixed list, Other needs a note, then record-meeting is sent.
at = run("import views.mentor as mentor\nmentor.today_page()")
next(b for b in at.button if b.key == f"record_meeting_{P1}").click().run()
reasons = at.multiselect(key=f"meeting_reasons_{P1}")
assert list(reasons.options) == labels.MEETING_REASONS, reasons.options
reasons.set_value(["Other", "Health"])
next(b for b in at.button if b.label == "Save the meeting record").click().run()
assert "Add a note saying what the other reason was." in text_of(at)
assert "calls" not in at.session_state, "nothing is sent until the form is complete"
at.multiselect(key=f"meeting_reasons_{P1}").set_value(["Other", "Health"])
at.text_area(key=f"meeting_note_{P1}").set_value("Looks after a younger brother after school")
at.text_area(key=f"meeting_agreed_{P1}").set_value("Meet again in two weeks")
at.date_input(key=f"meeting_date_{P1}").set_value(labels.college_today())
next(b for b in at.button if b.label == "Save the meeting record").click().run()
action, payload, success = at.session_state["calls"][-1]
assert action == "experience_command", action
assert payload == {
    "action": "record-meeting",
    "studentId": S1,
    "supportPlanId": P1,
    "metOn": labels.college_today().isoformat(),
    "reasons": ["Health", "Other"],
    "note": "Looks after a younger brother after school",
    "agreedNextStep": "Meet again in two weeks",
    "followupId": F1,
}, payload
assert success == "Meeting with Asha Rao recorded.", success
# Without an open check-in the Core finds or creates one, so none is named.
at = run("import views.mentor as mentor\nmentor.today_page()")
next(b for b in at.button if b.key == f"record_meeting_{P2}").click().run()
at.multiselect(key=f"meeting_reasons_{P2}").set_value(["Transport or distance"])
next(b for b in at.button if b.label == "Save the meeting record").click().run()
assert "followupId" not in at.session_state["calls"][-1][1]

# 4. Nothing pending: the empty state.
at = run("import views.mentor as mentor\nmentor.today_page()", overview=EMPTY)
assert "No meetings to record" in text_of(at)
assert "Record the meeting" not in [b.label for b in at.button]

# 5. Department head Overview: "Meetings pending (2)", overdue first.
at = run(
    "import views.hod as hod\nhod.overview_page()",
    actor={"role": "hod", "displayName": "Department Head"},
)
text = text_of(at)
assert "Meetings pending (2)" in text and "1 is overdue by more than a week." in text, text
pending = next(df.value for df in at.dataframe if "Where it stands" in df.value.columns)
assert list(pending["Student"]) == ["Asha Rao", "Bharat Kulkarni"], list(pending["Student"])
assert list(pending["Where it stands"]) == ["Overdue by 9 days, more than a week", "Due in 2 days"]

# 6. Profile (mentor and department head): the meeting line and the Meeting column.
PLAN = {"id": P3, "visible": True, "evidence_current": True, "created_at": "2026-10-05T08:00:00Z",
        "plan": {"summary": "Two tutorials a week", "actions": []}, "meeting": MEETING,
        "checkin_due_on": "2026-10-12", "checkin_days_overdue": 5}
DETAIL = {"student": {"id": S3, "name": "CHITRA NAIK", "register_number": "01FE23BCI040", "semester": 5},
          "mentor": {"name": "DR MIRA SEN"}, "courses": [], "followups": [], "support": [PLAN],
          "grants": ["attendance", "marks", "fees", "support", "private"]}
QUEUE_PLAN = {"id": P3, "student_id": S3, "display_name": "CHITRA NAIK", "visible_to_student": True,
              "plan": PLAN["plan"], "decision": "approved", "status": "planned", "revision": 0, "outcome": "",
              "decided_by": "DR MIRA SEN", "decided_at": "2026-10-05T08:00:00Z", "evidence_current": True,
              "meeting": MEETING, "checkin_due_on": "2026-10-12", "checkin_days_overdue": 5}
PROFILE_DATA = (
    f"DATA['student'] = {data(DETAIL)}\n"
    f"DATA['review_queue'] = {data({'drafts': [], 'plans': [QUEUE_PLAN]})}\n"
)
for role in ("faculty", "hod"):
    at = run(f"ns['render_profile']({S3!r}, {role!r})", extra=PROFILE_DATA, actor={"role": role})
    assert "Meeting held 15 Oct 2026: Health, Course difficulty" in text_of(at), (role, text_of(at))
    choose(at, "Section", "Plans and outcomes" if role == "faculty" else "Support plans").run()
    assert not at.exception, [e.message for e in at.exception]
    plans = next(df.value for df in at.dataframe if "Meeting" in df.value.columns)
    assert list(plans["Meeting"]) == ["Held 15 Oct 2026: Health, Course difficulty"], list(plans["Meeting"])
DUE = {**DETAIL, "support": [{**PLAN, "meeting": None, "checkin_due_on": "2026-10-08", "checkin_days_overdue": 9}]}
at = run(f"ns['render_profile']({S3!r}, 'faculty')", extra=f"DATA['student'] = {data(DUE)}\n")
assert "Meeting not recorded, due 8 Oct 2026 (9 days overdue)" in text_of(at), text_of(at)

# 7. Outcomes: a Meeting column.
at = run(f"ns['render_outcomes']({data({'plans': [QUEUE_PLAN, {**QUEUE_PLAN, 'id': P1, 'meeting': None, 'checkin_due_on': '2026-10-08'}]})}, {{'role': 'faculty'}})")
log = next(df.value for df in at.dataframe if "Meeting" in df.value.columns)
assert list(log["Meeting"])[:2] == ["Held 15 Oct 2026: Health, Course difficulty", "Not recorded, due 8 Oct 2026"], list(log["Meeting"])

# 8. Student and parent: only the day they met, never the reasons.
FAMILY_PLAN = {"id": P3, "visible": True, "created_at": "2026-10-05T08:00:00Z", "met_on": "2026-10-15",
               "plan": {"summary": "Two tutorials a week", "actions": []}}
FAMILY = {"student": {"id": S3, "name": "CHITRA NAIK"}, "support": [FAMILY_PLAN], "followups": [],
          "grants": ["attendance", "marks", "support"]}
at = run(
    "import views.student as student\nstudent.support_page()",
    extra=f"DATA['student'] = {data(FAMILY)}\n",
    actor={"role": "student", "studentId": S3},
)
text = text_of(at)
assert "Your mentor met you on 15 Oct 2026." in text, text
assert "Health" not in text and "Course difficulty" not in text
at = run(
    "import views.parent as parent\nparent.support_page()",
    extra=f"DATA['student'] = {data(FAMILY)}\nDATA['overview'] = {data({'children': [{'id': S3, 'name': 'CHITRA NAIK'}]})}\n",
    actor={"role": "parent"},
)
text = text_of(at)
assert "Chitra's mentor met them on 15 Oct 2026." in text, text
assert "Health" not in text and "Course difficulty" not in text

print(json.dumps({"status": "passed", "checks": [
    "reasons match the Core and migration 014", "Today: meetings to record above check-ins",
    "card due text and department head notice", "review again", "form: Other needs a note, record-meeting sent",
    "empty state", "department head meetings pending, overdue first", "profile meeting line and column",
    "Outcomes Meeting column", "student and parent see only the day",
]}))
