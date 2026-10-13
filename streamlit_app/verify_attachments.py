"""Actual-runtime attachment round trip and owner-scope acceptance."""

import base64
import json
from pathlib import Path

from bridge import BridgeError, Client

root = Path(__file__).resolve().parent.parent
accounts = json.loads((root / "runtime/project-final/accounts.json").read_text())
cohort = json.loads((root / "runtime/project-final/cohort.json").read_text())
client = Client()
sessions = []
try:
    for index in [52, 53]:
        student = cohort["students"][index]
        a = next(a for a in accounts if a["id"] == student["personId"])
        sessions.append(client.login(a["email"], a["password"], "lms"))

    def call(action, p=None, i=0):
        return client.request(action, p, token=sessions[i]["token"])

    overview = call("lms_overview")
    course = overview["courses"][0]
    detail = call("lms_course", {"courseId": course["id"]})
    assignment = detail["assignments"][0]
    existing = next(
        (s for s in detail["submissions"] if s["assignment_id"] == assignment["id"]),
        None,
    )
    attachment = {
        "name": "support-reasoning.txt",
        "data": base64.b64encode(
            b"A worked example and a counterexample verify the conclusion."
        ).decode(),
    }
    call(
        "lms_command",
        {
            "action": "submit-assignment",
            "assignmentId": assignment["id"],
            "expectedRevision": existing["revision"] if existing else -1,
            "answer": "Attachment round-trip acceptance.",
            "attachment": attachment,
        },
    )
    detail = call("lms_course", {"courseId": course["id"]})
    submission = next(
        s for s in detail["submissions"] if s["assignment_id"] == assignment["id"]
    )
    assert (
        call("lms_attachment", {"kind": "submissions", "id": submission["id"]})
        == attachment
    )
    try:
        call("lms_attachment", {"kind": "submissions", "id": submission["id"]}, 1)
    except BridgeError as e:
        assert e.status == 404
    else:
        raise AssertionError("Peer attachment exposed")
    result = {
        "status": "passed",
        "checks": [
            "upload persists",
            "download bytes match",
            "peer submission download denied",
        ],
    }
    (root / "runtime/streamlit-project/attachment-acceptance.json").write_text(
        json.dumps(result, indent=2) + "\n"
    )
    print(json.dumps({"status": "passed", "checks": 3}))
finally:
    for s in sessions:
        client.logout(s["token"])
    client.close()
