"""Offline check for the department head's main job (owner decisions, 17 Oct): see whether
mentors have talked to their students about the AI report, and message the mentor when
they have not. Fictional data; no server, database, model or network.

The department head's Overview leads with "Conversations not submitted (N)": grouped by
mentor (the mentor with the most past-deadline students first), past-deadline students
first in each group; each row gives the student, mentor, AI report date, days since,
status (due, meet by now, past the deadline) and the last reminder sent ("Reminder sent
<date>", then "Read <date>" once the mentor has read it). Only past-deadline rows offer
"Message the mentor", which opens a short form with the standard reminder and an
optional note; sending stores it with send-message. Nothing is sent automatically. The
mentor's Today shows "Messages from the department head (N)" at the top, each with the
student, a "Record the meeting" shortcut that opens the meeting form, and "Mark as read"
(mark-message-read). The Core's reminder text matches the screens'."""

import json
import sys
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent
ROOT = APP.parent
sys.path.insert(0, str(APP))
import labels  # noqa: E402

M1, M2 = "aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002"
S1, S2, S3, S4, S5 = (f"00000000-0000-4000-8000-00000000000{i}" for i in (1, 2, 3, 4, 5))
C1, C2, C3, C4, C5 = (f"cccccccc-cccc-4ccc-8ccc-cccccccccc0{i}" for i in (1, 2, 3, 4, 5))
MSG = "99999999-9999-4999-8999-999999999991"


def status(case, student, name, mentor_id, mentor, report, since, stage, *, left=None, overdue=None, reminder=None,
           meeting=None):
    return {
        "case_id": case, "plan_id": None, "case_status": "awaiting_faculty", "student_id": student,
        "student_name": name, "register_number": "01FE23BCI0" + case[-2:], "mentor_id": mentor_id,
        "mentor_name": mentor, "report_on": report, "meet_by": "", "deadline": "", "days_since": since,
        "stage": stage, "days_left": left, "days_overdue": overdue, "checkin": None, "meeting": meeting,
        "reminder": reminder,
    }


READ = {"sent_at": "2026-10-16T05:00:00Z", "read_at": "2026-10-16T20:00:00Z", "from_name": "DR HEAD"}
SENT = {"sent_at": "2026-10-17T04:00:00Z", "read_at": None, "from_name": "DR HEAD"}
# Dr Arun Desai has one student due; Dr Mira Sen has two past the deadline and one meet-by-now.
ROWS = [
    status(C1, S1, "ASHA RAO", M1, "DR MIRA SEN", "2026-09-28", 19, "past_deadline", overdue=12, reminder=READ),
    status(C5, S5, "EKTA SHAH", M2, "DR ARUN DESAI", "2026-10-14", 3, "due", left=4),
    status(C2, S2, "BHARAT KULKARNI", M1, "DR MIRA SEN", "2026-10-01", 16, "past_deadline", overdue=9, reminder=SENT),
    status(C3, S3, "CHITRA NAIK", M1, "DR MIRA SEN", "2026-10-08", 9, "meet_now", overdue=2),
    status(C4, S4, "DEV PATIL", M1, "DR MIRA SEN", "2026-10-05", 12, "met",
           meeting={"met_on": "2026-10-10", "reasons": ["Health"], "id": "m", "followup_id": "f"}),
]
HEAD_OVERVIEW = {"meetings": ROWS, "students": [], "faculty": [], "followups": [], "counts": {"students": 5}}
MESSAGE = {
    "id": MSG, "from_name": "DR HEAD", "to_name": "DR MIRA SEN", "student_id": S2, "student_name": "BHARAT KULKARNI",
    "support_case_id": C2, "sent_at": "2026-10-17T04:00:00Z", "read_at": None,
    "body": "The conversation with Bharat Kulkarni about the AI report of 1 Oct 2026 has not been submitted. "
            "Please meet the student and record it, or tell me why not.\n\nPlease do it this week.",
}
DONE_MESSAGE = {**MESSAGE, "id": "99999999-9999-4999-8999-999999999992", "read_at": "2026-10-17T06:00:00Z"}
MENTOR_OVERVIEW = {
    "meetings": [r for r in ROWS if r["mentor_id"] == M1], "messages": [MESSAGE, DONE_MESSAGE],
    "students": [], "faculty": [], "followups": [], "counts": {},
}


def data(value: object) -> str:
    return f"json.loads({json.dumps(json.dumps(value))})"


def run(body: str, overview: dict, actor: dict) -> AppTest:
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
DATA = {{"overview": {data(overview)}, "review_queue": {{"drafts": []}}, "review_overview": {{"jobs": [], "students": []}}}}
ns["load"] = lambda action, payload=None: DATA.get(action, {{}})
ns["load_many"] = lambda requests: [DATA.get(a, {{}}) for a, _ in requests]
st.session_state["actor"] = {data(actor)}
{body}
"""
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception, [e.message for e in at.exception]
    return at


def text_of(at: AppTest) -> str:
    parts = [h.value for h in at.subheader] + [m.value for m in at.markdown] + [c.value for c in at.caption]
    parts += [e.value for e in at.error] + [df.value.to_csv(index=False) for df in at.dataframe]
    parts += [str(el.proto.body) for el in at.get("html")]
    return "\n".join(str(p) for p in parts)


HOD = {"role": "hod", "displayName": "Dr Head"}
FACULTY = {"role": "faculty", "displayName": "Dr Mira Sen"}

# 1. The Overview leads with "Conversations not submitted (4)", above the flagged students.
at = run("import views.hod as hod\nhod.overview_page()", HEAD_OVERVIEW, HOD)
text = text_of(at)
headings = [h.value for h in at.subheader]
assert headings.index("Conversations not submitted (4)") < headings.index("Flagged students (0)"), headings
assert "2 are past the deadline; you can message the mentor." in text, text
assert "Dev Patil" not in text, "a submitted conversation is not listed"

# 2. Grouped by mentor (most past-deadline first), past-deadline students first in each group.
tables = [df.value for df in at.dataframe if "Last reminder" in df.value.columns]
assert len(tables) == 2, "one table per mentor"
sen, desai = tables
assert list(sen.columns) == ["Student", "Mentor", "AI report", "Days since", "Status", "Last reminder"], list(sen.columns)
assert list(sen["Student"]) == ["Asha Rao", "Bharat Kulkarni", "Chitra Naik"], list(sen["Student"])
assert set(sen["Mentor"]) == {"Dr Mira Sen"} and list(desai["Mentor"]) == ["Dr Arun Desai"]
assert list(sen["AI report"]) == ["28 Sep 2026", "1 Oct 2026", "8 Oct 2026"]
assert list(sen["Days since"]) == [19, 16, 9]
assert list(sen["Status"]) == ["Past the deadline", "Past the deadline", "Meet by now (2 days overdue)"], list(sen["Status"])
assert list(sen["Last reminder"]) == [
    "Reminder sent 16 Oct 2026 · Read 17 Oct 2026",  # read at 01:30 IST on the 17th
    "Reminder sent 17 Oct 2026",
    "None sent",
], list(sen["Last reminder"])
assert list(desai["Status"]) == ["Due in 4 days"], list(desai["Status"])
assert "**Dr Mira Sen** · 3 not submitted, 2 past the deadline" in text, text

# 3. Only past-deadline rows offer "Message the mentor"; the form holds the standard reminder.
buttons = [b for b in at.button if b.label == "Message the mentor"]
assert sorted(b.key for b in buttons) == sorted([f"message_mentor_{C1}", f"message_mentor_{C2}"]), [b.key for b in buttons]
next(b for b in at.button if b.key == f"message_mentor_{C2}").click().run()
reminder = (
    "The conversation with Bharat Kulkarni about the AI report of 1 Oct 2026 has not been submitted. "
    "Please meet the student and record it, or tell me why not."
)
assert reminder in text_of(at), text_of(at)
assert "Nothing is sent automatically." in text_of(at)
assert "calls" not in at.session_state, "opening the form sends nothing"
at.text_area(key=f"message_note_{C2}").set_value("  Please do it this week.  ")
next(b for b in at.button if b.label == "Send the message").click().run()
action, payload, success = at.session_state["calls"][-1]
assert action == "experience_command"
assert payload == {"action": "send-message", "supportCaseId": C2, "note": "Please do it this week."}, payload
assert success == "Message sent to Dr Mira Sen.", success
# The note is optional.
at = run("import views.hod as hod\nhod.overview_page()", HEAD_OVERVIEW, HOD)
next(b for b in at.button if b.key == f"message_mentor_{C1}").click().run()
next(b for b in at.button if b.label == "Send the message").click().run()
assert at.session_state["calls"][-1][1] == {"action": "send-message", "supportCaseId": C1, "note": ""}

# 4. The Core stores the same reminder words.
core = (ROOT / "platform/services/core-api/lib/staff-messages.ts").read_text(encoding="utf-8")
assert "about the AI report of ${dayLabel(reportOn)} has not been submitted. " in core
assert '"Please meet the student and record it, or tell me why not."' in core
assert labels.reminder_text(ROWS[2]) == reminder

# 5. Nothing pending: the empty state, and no button.
at = run("import views.hod as hod\nhod.overview_page()", {**HEAD_OVERVIEW, "meetings": [ROWS[4]]}, HOD)
assert "Every conversation is submitted" in text_of(at)
assert not [b for b in at.button if b.label == "Message the mentor"]

# 6. The mentor's Today: "Messages from the department head (1)" at the top, unread only.
at = run("import views.mentor as mentor\nmentor.today_page()", MENTOR_OVERVIEW, FACULTY)
headings = [h.value for h in at.subheader]
assert headings[0] == "Messages from the department head (1)", headings
text = text_of(at)
assert "Please do it this week." in text and "About Bharat Kulkarni" in text, text
assert "**Dr Head** · 17 Oct 2026" in text, text
next(b for b in at.button if b.key == f"message_read_{MSG}").click().run()
assert at.session_state["calls"][-1] == [
    "experience_command", {"action": "mark-message-read", "messageId": MSG}, "Message marked as read."
]
# "Record the meeting" opens the meeting form for that student's report, under the message.
at = run("import views.mentor as mentor\nmentor.today_page()", MENTOR_OVERVIEW, FACULTY)
next(b for b in at.button if b.key == f"message_record_{MSG}").click().run()
reasons = at.multiselect(key=f"meeting_reasons_msg_{MSG}_{C2}")
reasons.set_value(["Part-time work"])
next(b for b in at.button if b.label == "Save the meeting record").click().run()
action, payload, _ = at.session_state["calls"][-1]
assert payload["action"] == "record-meeting" and payload["supportCaseId"] == C2, payload
# No unread message: no section.
at = run("import views.mentor as mentor\nmentor.today_page()", {**MENTOR_OVERVIEW, "messages": [DONE_MESSAGE]}, FACULTY)
assert not any(h.value.startswith("Messages from the department head") for h in at.subheader)
# A message about a conversation already submitted offers no shortcut.
at = run(
    "import views.mentor as mentor\nmentor.today_page()",
    {**MENTOR_OVERVIEW, "messages": [{**MESSAGE, "support_case_id": C4}]},
    FACULTY,
)
assert "The conversation with this student is already submitted." in text_of(at)
assert not [b for b in at.button if b.key == f"message_record_{MSG}"]

print(json.dumps({"status": "passed", "checks": [
    "Overview leads with conversations not submitted", "grouped by mentor, past-deadline first",
    "report date, days since, status and last reminder", "Message the mentor only for past-deadline rows",
    "message form sends send-message with an optional note", "Core reminder words match",
    "empty state", "mentor Today messages at the top with mark as read", "Record the meeting shortcut",
]}))
