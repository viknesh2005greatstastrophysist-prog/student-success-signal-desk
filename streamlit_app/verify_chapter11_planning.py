"""Actual local UI: clarify, revise the same plan, lock, pause and resume.
Creates a technical planning record, no execution or mentor decision.
"""

import json
from pathlib import Path

from bridge import Client
from streamlit.testing.v1 import AppTest

root = Path(__file__).resolve().parent.parent
account = next(
    a
    for a in json.loads((root / "runtime/project-final/accounts.json").read_text())
    if a["email"] == "mentor2@aura.project.test"
)
c = Client()
login = c.login(account["email"], account["password"], "faculty")
try:
    review = c.request("review_overview", token=login["token"])
    # Pick a student by status: never one whose review is awaiting a mentor decision.
    pending = {
        j["student_id"] for j in review["jobs"] if j["status"] == "awaiting_faculty"
    }
    student = next(s["id"] for s in review["students"] if s["id"] not in pending)
    policy = review["policies"][0]["id"]
finally:
    c.logout(login["token"])
    c.close()
at = AppTest.from_file(str(root / "streamlit_app/app.py"), default_timeout=30).run()
at.segmented_control[0].set_value("faculty")
at.text_input[0].set_value(account["email"])
at.text_input[1].set_value(account["password"])
next(b for b in at.button if b.label == "Sign in").click().run()
next(r for r in at.radio if r.label == "Workspace").set_value("Support reviews").run()
next(t for t in at.text_area if t.label == "Review request").set_value(
    "Technical clarify and revise verification"
)
next(b for b in at.button if b.label == "Save review plan").click().run()
assert not at.exception
plan_id = next(s for s in at.selectbox if s.label == "Plan").value
assert any(
    "Which students" in w.value and "Which mentor" in w.value for w in at.warning
)
next(m for m in at.multiselect if m.label == "Revised students in scope").set_value(
    [student]
)
next(s for s in at.selectbox if s.label == "Revised focus").select("academic")
next(s for s in at.selectbox if s.label == "Revised policy").select(policy)
next(t for t in at.text_area if t.label == "Revision feedback").set_value(
    "focus: attendance"
)
next(b for b in at.button if b.label == "Save revised plan").click().run()
assert next(s for s in at.selectbox if s.label == "Plan").value == plan_id
assert not at.exception and not at.error
next(b for b in at.button if b.label == "Lock review plan").click().run()
assert next(s for s in at.selectbox if s.label == "Plan").value == plan_id, (
    "after lock",
    plan_id,
    next(s for s in at.selectbox if s.label == "Plan").value,
    [s.value for s in at.success],
)
next(t for t in at.text_input if t.label == "Pause or resume reason").set_value(
    "Pause technical planning verification"
)
next(b for b in at.button if b.label == "Pause review").click().run()
assert not at.error, [e.value for e in at.error]
assert next(s for s in at.selectbox if s.label == "Plan").value == plan_id, (
    plan_id,
    next(s for s in at.selectbox if s.label == "Plan").value,
    [s.value for s in at.success],
)
assert next(b for b in at.button if b.label == "Run review").disabled, [
    (b.label, b.disabled) for b in at.button
]
next(t for t in at.text_input if t.label == "Pause or resume reason").set_value(
    "Resume technical planning verification"
)
next(b for b in at.button if b.label == "Resume review").click().run()
assert not next(b for b in at.button if b.label == "Run review").disabled
assert not at.exception and not at.error
next(b for b in at.button if b.label == "Sign out").click().run()
c = Client()
login = c.login(account["email"], account["password"], "faculty")
try:
    saved = c.request("plan_export", {"planId": plan_id}, token=login["token"])
    assert saved["plan"]["body"]["domain"] == "attendance"
    assert saved["plan"]["revision"] == 4
    assert saved["jobs"][0]["status"] == "queued"
    assert any(e["event_type"] == "plan.revised" for e in saved["events"])
finally:
    c.logout(login["token"])
    c.close()
print(
    "Brief 7: clarify, same-plan revision, feedback focus, lock and UI pause/resume passed; no execution or approval."
)
