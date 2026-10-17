"""Offline check for the conversation with the student about the AI report (owner
decisions, 17 Oct). Fictional data; no server, database, model or network.

The clock starts at the AI report (the draft reaches the mentor gate): meet the student
within 7 days, submit the conversation within 14. The mentor's Today lists "Students to
meet (N)" above Check-ins: one card per current report without a submitted conversation,
"<Student>: AI report on <date>. Meet the student by <date+7> and submit the conversation
by <date+14>.", then "Due in n days" before day 7, "Meet by now" with the days overdue on
days 7 to 14 and "Past the deadline; the department head can see this." after day 14.
Buttons: "Record the meeting" (date met, reasons from the fixed list, note; no "What was
agreed") sends record-meeting for the report's case, and "Open the draft" (at the gate) or
"Open the plan" (approved). With nothing pending the section says "No students to meet".
The profile line and the Outcomes Meeting column use the same wording. Students and
parents see only "Your mentor met you on <date>", never the reasons, and a meeting
check-in shows them its date without the note. The reasons list matches the Core and
migration 014."""

import json
import re
import sys
from datetime import date
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent
ROOT = APP.parent
sys.path.insert(0, str(APP))
import labels  # noqa: E402
from apptest_util import choose  # noqa: E402

S1, S2, S3, S4 = (f"00000000-0000-4000-8000-00000000000{i}" for i in (1, 2, 3, 4))
C1, C2, C3, C4 = (f"cccccccc-cccc-4ccc-8ccc-cccccccccc0{i}" for i in (1, 2, 3, 4))
P1, P3 = "55555555-5555-4555-8555-555555555551", "55555555-5555-4555-8555-555555555553"
F1, F2 = "66666666-6666-4666-8666-666666666661", "66666666-6666-4666-8666-666666666662"
MEETING = {
    "id": "77777777-7777-4777-8777-777777777771", "followup_id": "66666666-6666-4666-8666-666666666663",
    "met_on": "2026-10-15", "reasons": ["Health", "Course difficulty"], "note": "Tired after the fever",
    "agreed_next_step": "", "recorded_by": "DR MIRA SEN", "recorded_at": "2026-10-15T10:00:00Z",
}


def status(case, plan, student, name, register, report, meet_by, deadline, since, stage, *, left=None, overdue=None,
           checkin=None, meeting=None):
    return {
        "case_id": case, "plan_id": plan, "case_status": "approved" if plan else "awaiting_faculty",
        "student_id": student, "student_name": name, "register_number": register,
        "mentor_id": "m1", "mentor_name": "DR MIRA SEN", "report_on": report, "meet_by": meet_by,
        "deadline": deadline, "days_since": since, "stage": stage, "days_left": left, "days_overdue": overdue,
        "checkin": checkin, "meeting": meeting,
    }


# The Core's order: most urgent first, submitted last.
LATE = status(C1, P1, S1, "ASHA RAO", "01FE23BCI024", "2026-10-01", "2026-10-08", "2026-10-15", 16, "past_deadline",
              overdue=9, checkin={"id": F1, "due_on": "2026-10-08", "status": "planned"})
NOW = status(C4, None, S4, "DEV PATIL", "01FE23BCI052", "2026-10-08", "2026-10-15", "2026-10-22", 9, "meet_now", overdue=2)
DUE = status(C2, None, S2, "BHARAT KULKARNI", "01FE23BCI031", "2026-10-14", "2026-10-21", "2026-10-28", 3, "due", left=4,
             checkin={"id": F2, "due_on": "2026-10-21", "status": "planned"})
MET = status(C3, P3, S3, "CHITRA NAIK", "01FE23BCI040", "2026-10-05", "2026-10-12", "2026-10-19", 12, "met",
             checkin={"id": MEETING["followup_id"], "due_on": "2026-10-12", "status": "completed"}, meeting=MEETING)
MEETINGS = [LATE, NOW, DUE, MET]
OVERVIEW = {"meetings": MEETINGS, "followups": [], "students": [], "faculty": [], "counts": {"students": 4}}
EMPTY = {"meetings": [MET], "followups": [], "students": [], "counts": {}}


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
ns["open_report"] = lambda row, role="faculty": st.session_state.update(opened=[row["case_id"], row["case_status"], role])
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


# 1. The reasons list is the Core's, in the same order, and migration 014 allows exactly it.
core = (ROOT / "platform/services/core-api/lib/meetings.ts").read_text(encoding="utf-8")
core_list = re.search(r"MEETING_REASONS = \[(.*?)\] as const", core, re.S).group(1)
assert re.findall(r'"([^"]+)"', core_list) == labels.MEETING_REASONS, "Core and screens list the same reasons"
migration = (ROOT / "platform/services/core-api/migrations/014_meeting_records.sql").read_text(encoding="utf-8")
sql_list = re.search(r"reasons <@ ARRAY\[(.*?)\]::text\[\]", migration, re.S).group(1)
assert re.findall(r"'([^']+)'", sql_list) == labels.MEETING_REASONS, "migration 014 allows exactly that list"
assert labels.MEET_WITHIN_DAYS == 7 and labels.SUBMIT_WITHIN_DAYS == 14
assert "MEET_WITHIN_DAYS = 7" in core and "SUBMIT_WITHIN_DAYS = 14" in core, "the same 7 and 14 days as the Core"

# 2. Today: "Students to meet (3)" above Check-ins, one card per report without a conversation.
at = run("import views.mentor as mentor\nmentor.today_page()")
text = text_of(at)
order = [h.value for h in at.subheader if h.value in ("Students to meet (3)", "Check-ins")]
assert order[:2] == ["Students to meet (3)", "Check-ins"], order
for line in (
    "Asha Rao: AI report on 1 Oct 2026. Meet the student by 8 Oct 2026 and submit the conversation by 15 Oct 2026.",
    "Past the deadline; the department head can see this.",
    "Dev Patil: AI report on 8 Oct 2026. Meet the student by 15 Oct 2026 and submit the conversation by 22 Oct 2026.",
    "Meet by now (2 days overdue)",
    "Bharat Kulkarni: AI report on 14 Oct 2026. Meet the student by 21 Oct 2026 and submit the conversation by 28 Oct 2026.",
    "Due in 4 days",
):
    assert line in text, (line, text)
assert "Chitra Naik" not in text, "a submitted conversation has no card"
shown = [b.label for b in at.button]
assert shown.count("Record the meeting") == 3, shown
assert shown.count("Open the draft") == 2 and shown.count("Open the plan") == 1, shown
next(b for b in at.button if b.key == f"meeting_open_{C2}").click().run()
assert at.session_state["opened"] == [C2, "awaiting_faculty", "faculty"], "opens the draft at the gate"
at = run("import views.mentor as mentor\nmentor.today_page()")
next(b for b in at.button if b.key == f"meeting_open_{C1}").click().run()
assert at.session_state["opened"] == [C1, "approved", "faculty"], "opens the approved plan"
# Day 7 exactly: "Meet by now (due today)".
assert labels.meeting_stage_text({**NOW, "days_since": 7, "days_overdue": 0}) == "Meet by now (due today)"
assert labels.meeting_stage_text({**DUE, "days_left": 1}) == "Due in 1 day"

# 3. The form: date met, reasons from the fixed list, note; Other needs a note; record-meeting is sent.
at = run("import views.mentor as mentor\nmentor.today_page()")
next(b for b in at.button if b.key == f"record_meeting_{C1}").click().run()
reasons = at.multiselect(key=f"meeting_reasons_{C1}")
assert list(reasons.options) == labels.MEETING_REASONS, reasons.options
assert [t.label for t in at.text_area] == ["Note"], "no What was agreed"
reasons.set_value(["Other", "Health"])
next(b for b in at.button if b.label == "Save the meeting record").click().run()
assert "Add a note saying what the other reason was." in text_of(at)
assert "calls" not in at.session_state, "nothing is sent until the form is complete"
at.multiselect(key=f"meeting_reasons_{C1}").set_value(["Other", "Health"])
at.text_area(key=f"meeting_note_{C1}").set_value("Looks after a younger brother after school")
at.date_input(key=f"meeting_date_{C1}").set_value(labels.college_today())
next(b for b in at.button if b.label == "Save the meeting record").click().run()
action, payload, success = at.session_state["calls"][-1]
assert action == "experience_command", action
assert payload == {
    "action": "record-meeting",
    "studentId": S1,
    "supportCaseId": C1,
    "metOn": labels.college_today().isoformat(),
    "reasons": ["Health", "Other"],
    "note": "Looks after a younger brother after school",
    "followupId": F1,
}, payload
assert success == "Meeting with Asha Rao recorded.", success
# Without a check-in the Core finds or creates one, so none is named.
at = run("import views.mentor as mentor\nmentor.today_page()")
next(b for b in at.button if b.key == f"record_meeting_{C4}").click().run()
at.multiselect(key=f"meeting_reasons_{C4}").set_value(["Transport or distance"])
next(b for b in at.button if b.label == "Save the meeting record").click().run()
assert at.session_state["calls"][-1][1]["supportCaseId"] == C4
assert "followupId" not in at.session_state["calls"][-1][1]
# A date before the AI report is refused with the report's date.
from views.meetings import meeting_payload  # noqa: E402

assert meeting_payload(LATE, date(2026, 9, 30), ["Health"], "") == (
    None,
    "The meeting date is before the AI report of 1 Oct 2026.",
)

# 4. Nothing pending: the empty state.
at = run("import views.mentor as mentor\nmentor.today_page()", overview=EMPTY)
assert "No students to meet" in text_of(at)
assert "Record the meeting" not in [b.label for b in at.button]

# 5. Profile (mentor and department head): the line and the Meeting column use the card's words.
PLAN = {"id": P3, "case_id": C3, "visible": True, "evidence_current": True, "created_at": "2026-10-06T08:00:00Z",
        "plan": {"summary": "Two tutorials a week", "actions": []}, "meeting": MEETING,
        "meeting_due": {k: MET[k] for k in ("report_on", "meet_by", "deadline", "days_since", "stage", "days_left", "days_overdue")}}
DETAIL = {"student": {"id": S3, "name": "CHITRA NAIK", "register_number": "01FE23BCI040", "semester": 5},
          "mentor": {"name": "DR MIRA SEN"}, "courses": [], "followups": [], "support": [PLAN], "meeting": MET,
          "grants": ["attendance", "marks", "fees", "support", "private"]}
QUEUE_PLAN = {"id": P3, "student_id": S3, "display_name": "CHITRA NAIK", "visible_to_student": True,
              "plan": PLAN["plan"], "decision": "approved", "status": "planned", "revision": 0, "outcome": "",
              "decided_by": "DR MIRA SEN", "decided_at": "2026-10-06T08:00:00Z", "evidence_current": True,
              "meeting": MEETING, "meeting_due": PLAN["meeting_due"]}
PROFILE_DATA = (
    f"DATA['student'] = {data(DETAIL)}\n"
    f"DATA['review_queue'] = {data({'drafts': [], 'plans': [QUEUE_PLAN]})}\n"
)
for role in ("faculty", "hod"):
    at = run(f"ns['render_profile']({S3!r}, {role!r})", extra=PROFILE_DATA, actor={"role": role})
    assert "Met on 15 Oct 2026: Health, Course difficulty (AI report of 5 Oct 2026)" in text_of(at), (role, text_of(at))
    choose(at, "Section", "Plans and outcomes" if role == "faculty" else "Support plans").run()
    assert not at.exception, [e.message for e in at.exception]
    plans = next(df.value for df in at.dataframe if "Meeting" in df.value.columns)
    assert list(plans["Meeting"]) == ["Met on 15 Oct 2026: Health, Course difficulty"], list(plans["Meeting"])
LATE_DETAIL = {**DETAIL, "meeting": LATE}
for role, ending in (("faculty", "Past the deadline; the department head can see this."), ("hod", "Past the deadline.")):
    at = run(f"ns['render_profile']({S1!r}, {role!r})", extra=f"DATA['student'] = {data(LATE_DETAIL)}\n", actor={"role": role})
    line = (
        "AI report on 1 Oct 2026. Meet the student by 8 Oct 2026 and submit the conversation by 15 Oct 2026. " + ending
    )
    assert line in text_of(at), (role, text_of(at))

# 6. Outcomes: the Meeting column.
LATE_DUE = {k: LATE[k] for k in ("report_on", "meet_by", "deadline", "days_since", "stage", "days_left", "days_overdue")}
OUTCOME_PLANS = {"plans": [QUEUE_PLAN, {**QUEUE_PLAN, "id": P1, "meeting": None, "meeting_due": LATE_DUE}]}
at = run(f"ns['render_outcomes']({data(OUTCOME_PLANS)}, {{'role': 'faculty'}})")
log = next(df.value for df in at.dataframe if "Meeting" in df.value.columns)
assert list(log["Meeting"])[:2] == [
    "Met on 15 Oct 2026: Health, Course difficulty",
    "Past the deadline; the department head can see this.",
], list(log["Meeting"])

# 7. Student and parent: only the day they met, never the reasons; a meeting check-in
# shows its date without the note (the Core sends it empty).
FAMILY_PLAN = {"id": P3, "visible": True, "created_at": "2026-10-06T08:00:00Z", "met_on": "2026-10-15",
               "plan": {"summary": "Two tutorials a week", "actions": []}}
CHECKIN = {"id": F2, "mentor_name": "DR MIRA SEN", "due_on": "2026-10-21", "note": "", "status": "planned"}
FAMILY = {"student": {"id": S3, "name": "CHITRA NAIK"}, "support": [FAMILY_PLAN], "followups": [CHECKIN],
          "grants": ["attendance", "marks", "support"]}
at = run(
    "import views.student as student\nstudent.support_page()",
    extra=f"DATA['student'] = {data(FAMILY)}\n",
    actor={"role": "student", "studentId": S3},
)
text = text_of(at)
assert "Your mentor met you on 15 Oct 2026." in text, text
assert "21 Oct 2026" in text, "the check-in's date"
assert "Health" not in text and "Course difficulty" not in text and "AI report" not in text
at = run(
    "import views.parent as parent\nparent.support_page()",
    extra=f"DATA['student'] = {data(FAMILY)}\nDATA['overview'] = {data({'children': [{'id': S3, 'name': 'CHITRA NAIK'}]})}\n",
    actor={"role": "parent"},
)
text = text_of(at)
assert "Chitra's mentor met them on 15 Oct 2026." in text, text
assert "Health" not in text and "Course difficulty" not in text and "AI report" not in text

print(json.dumps({"status": "passed", "checks": [
    "reasons and the 7 and 14 days match the Core", "Today: students to meet above check-ins",
    "card wording for due, meet by now and past the deadline", "open the draft or the plan",
    "form: no What was agreed, Other needs a note, record-meeting sent for the case",
    "date before the report refused", "empty state", "profile line and column in the card's words",
    "Outcomes Meeting column", "student and parent see only the day, check-in without the note",
]}))
