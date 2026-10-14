"""Actual local UI: the AI planner asks, the mentor answers, the same plan is revised,
locked, paused and resumed. Creates a technical planning record, no execution or mentor
decision.

The planner is a scripted model on a local loopback port (a temporary environment file
points the worker at it and carries no Groq or Gemini key), so no live model is called.
"""

import json
import os
import shutil
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

QUESTIONS = [
    "Which students should this technical verification cover?",
    "Which focus should the technical verification take first?",
]
# Same meaning as the first question, in other words: an answered question must stay answered.
REPHRASED = "Which students should this technical verification cover, as you specified?"
requests_seen: list[dict] = []


class ScriptedPlanner(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence the access log
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        requests_seen.append(body)
        if "tools" in body:
            content = "ready"
        else:
            brief = json.loads(
                next(m for m in body["messages"] if m["role"] == "user")["content"]
            )
            content = json.dumps(
                {
                    "domain": None,
                    "policy": None,
                    "allMine": False,
                    "basis": "fresh",
                    "filter": {
                        "semesterMin": None,
                        "semesterMax": None,
                        "attendanceBelowPct": None,
                        "markBelowPct": None,
                        "exclude": [],
                    },
                    "steps": [
                        "Check the technical verification students against the approved policy.",
                        "Prepare the plan for the mentor to lock.",
                    ],
                    "questions": [REPHRASED] if brief.get("feedback") else QUESTIONS,
                }
            )
        reply = json.dumps(
            {
                "choices": [{"message": {"content": content}}],
                "usage": {"total_tokens": 10},
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)


server = ThreadingHTTPServer(("127.0.0.1", 0), ScriptedPlanner)
threading.Thread(target=server.serve_forever, daemon=True).start()
root = Path(__file__).resolve().parent.parent
# The worker reads this file instead of .env: same local database, planner model = the
# loopback script above, no provider keys of any kind.
scratch = tempfile.mkdtemp(prefix="aura-planning-verify-")
environment = json.loads((root / "runtime/project-final/environment.json").read_text())
environment.update(
    CH11_MODEL="scripted-planner",
    CH11_MODEL_BASE_URL=f"http://127.0.0.1:{server.server_port}/v1",
)
for key in ("CH11_MODEL_API_KEY", "GROQ_API_KEY"):
    environment.pop(key, None)
env_file = Path(scratch) / "environment.json"
env_file.write_text(json.dumps(environment))
env_file.chmod(0o600)
os.environ["AURA_STREAMLIT_ENV_FILE"] = str(env_file)
os.environ.pop("GROQ_API_KEY", None)

from bridge import Client  # after the environment is set
from streamlit.testing.v1 import AppTest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apptest_util import choose, open_page, picker  # noqa: E402

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
open_page(at, "reviews")
at.segmented_control(key="reviews_section").set_value("Start a review").run()
next(t for t in at.text_area if t.label == "Review request").set_value(
    "Technical clarify and revise verification"
)
next(b for b in at.button if b.label == "Save review plan").click().run()
assert not at.exception
plan_id = picker(at, "Plan").value
assert any(QUESTIONS[0] in w.value and QUESTIONS[1] in w.value for w in at.warning)
next(m for m in at.multiselect if m.label == "Revised students in scope").set_value(
    [student]
)
choose(at, "Revised focus", "academic")
choose(at, "Revised policy", policy)
assert not any("mode" in e.label.lower() for e in at.selectbox), "no execution mode"
note = "Technical verification: the first student, academic focus, current cycle."
next(t for t in at.text_area if t.label == "Revision feedback").set_value(note)
next(b for b in at.button if b.label == "Save revised plan").click().run()
assert picker(at, "Plan").value == plan_id
assert not at.exception and not at.error
# The paraphrased question was answered by the note: it is not asked again, the
# feedback box opens empty and the note is kept above it, never mixed into it.
assert not any("Complete these details" in w.value for w in at.warning), [
    w.value for w in at.warning
]
assert next(t for t in at.text_area if t.label == "Revision feedback").value == ""
next(b for b in at.button if b.label == "Lock review plan").click().run()
assert picker(at, "Plan").value == plan_id, (
    "after lock",
    plan_id,
    picker(at, "Plan").value,
    [s.value for s in at.success],
)
next(t for t in at.text_input if t.label == "Pause or resume reason").set_value(
    "Pause technical planning verification"
)
next(b for b in at.button if b.label == "Pause review").click().run()
assert not at.error, [e.value for e in at.error]
assert picker(at, "Plan").value == plan_id, (
    plan_id,
    picker(at, "Plan").value,
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
# This record is never executed. Leave it paused, with an audited reason, so its
# queued review is not mistaken for work that is stuck (E2E log #11).
next(t for t in at.text_input if t.label == "Pause or resume reason").set_value(
    "Verification record: this plan is never run"
)
next(b for b in at.button if b.label == "Pause review").click().run()
assert not at.exception and not at.error
next(b for b in at.button if b.label == "Sign out").click().run()
c = Client()
login = c.login(account["email"], account["password"], "faculty")
try:
    saved = c.request("plan_export", {"planId": plan_id}, token=login["token"])
    body = saved["plan"]["body"]
    assert body["domain"] == "academic"
    assert body["mode"] == "model" and body["feedback"] == note
    assert body["studentIds"] == [student], "the mentor's selection is authoritative"
    assert body["scope"]["basis"] == "selected" and "scopeConflict" not in body
    assert body["answeredQuestions"] == QUESTIONS
    assert saved["plan"]["revision"] == 5 and saved["plan"]["paused"] is True
    assert saved["jobs"][0]["status"] == "queued"
    assert any(e["event_type"] == "plan.revised" for e in saved["events"])
finally:
    c.logout(login["token"])
    c.close()
# The scripted planner saw the selection (as an alias) and the resolved questions.
final = [r for r in requests_seen if "tools" not in r][-1]
brief = json.loads(next(m for m in final["messages"] if m["role"] == "user")["content"])
assert brief["fixed"]["students"] == 1 and brief["fixed"]["studentAliases"], brief
assert brief["resolved"] == QUESTIONS and student not in json.dumps(final)
server.shutdown()
shutil.rmtree(scratch, ignore_errors=True)
print(
    "Brief 7: AI planner questions, answered questions kept resolved, same-plan revision, selection authority, lock and UI pause/resume passed; no execution, approval or live model."
)
