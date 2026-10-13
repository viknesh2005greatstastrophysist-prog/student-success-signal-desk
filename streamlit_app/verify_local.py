"""Stateful acceptance on a separate project case; private outputs, no credentials."""

import copy
import json
import os
from pathlib import Path

from bridge import BridgeError, Client

ROOT = Path(__file__).resolve().parent.parent
FOLDER = ROOT / "runtime/streamlit-project"
accounts = json.loads((ROOT / "runtime/project-final/accounts.json").read_text())
cohort = json.loads((ROOT / "runtime/project-final/cohort.json").read_text())
student_index = int(os.environ.get("AURA_ACCEPTANCE_STUDENT_INDEX", "32"))
assert 24 <= student_index < len(cohort["students"]) and student_index % 4 == 0, (
    "Choose a fresh flagged project case, outside the presentation cohort"
)
student = cohort["students"][student_index]
ids = {
    "student": student["personId"],
    "parent": student["parentId"],
    "faculty": student["mentorId"],
    "hod": next(a["id"] for a in accounts if a["role"] == "hod"),
    "governance": next(a["id"] for a in accounts if a["role"] == "governance"),
}
ids["lms"] = ids["student"]
client = Client()
sessions = {}
checks = []


def call(role, action, data=None):
    return client.request(action, data, token=sessions[role]["token"])


def deny(role, action, data=None, statuses=(401, 403, 404)):
    try:
        call(role, action, data)
    except BridgeError as e:
        assert e.status in statuses, (e.code, e.status)
        return e.status
    raise AssertionError("Unauthorized action succeeded")


try:
    for role, id in ids.items():
        a = next(a for a in accounts if a["id"] == id)
        sessions[role] = client.login(a["email"], a["password"], role)
        view = call(role, "sources")
        expected = (
            107 if role == "faculty" else 321 if role in ["hod", "governance"] else 1
        )
        assert view["counts"]["students"] == expected
        if role == "governance":
            assert view["students"] == []
        checks.append(
            {"portal": role, "actualPasswordLogin": True, "sourceScope": expected}
        )
    assert deny("student", "student", {"studentId": cohort["students"][1]["id"]}) == 403
    assert deny("student", "review_overview") == 403
    assert (
        call("student", "overview", {"role": "faculty"})["actor"]["role"] == "student"
    )
    checks.append({"guard": "peer, staff operations and supplied-role spoofing denied"})
    lms = call("lms", "lms_overview")
    course = lms["courses"][0]
    details = call("lms", "lms_course", {"courseId": course["id"]})
    lesson = details["lessons"][0]
    assignment = details["assignments"][0]
    call("lms", "lms_command", {"action": "open-lesson", "lessonId": lesson["id"]})
    submission = next(
        (s for s in details["submissions"] if s["assignment_id"] == assignment["id"]),
        None,
    )
    call(
        "lms",
        "lms_command",
        {
            "action": "submit-assignment",
            "assignmentId": assignment["id"],
            "expectedRevision": submission["revision"] if submission else -1,
            "answer": "A worked example followed by a counterexample tests the reasoning.",
        },
    )
    checks.append({"journey": "LMS activity and submission persist"})
    queue = call("faculty", "review_queue")
    draft = next(d for d in queue["drafts"] if d["student_id"] == student["id"])
    packet = copy.deepcopy(draft["recommendation"])
    packet["actions"][0]["dueInDays"] = 6
    call(
        "faculty",
        "draft_edit",
        {
            "caseId": draft["id"],
            "expectedRevision": draft["revision"],
            "artifactId": draft["artifact_id"],
            "packet": packet,
            "rationale": "Streamlit acceptance: refine the mentor check-in date after evidence review.",
        },
    )
    assert (
        deny(
            "faculty",
            "case_decide",
            {
                "caseId": draft["id"],
                "expectedRevision": draft["revision"],
                "artifactId": draft["artifact_id"],
                "contentHash": draft["content_hash"],
                "decision": "approved",
                "rationale": "A stale artifact must not be approved.",
            },
            (409,),
        )
        == 409
    )
    fresh = next(
        d for d in call("faculty", "review_queue")["drafts"] if d["id"] == draft["id"]
    )
    call(
        "faculty",
        "case_decide",
        {
            "caseId": fresh["id"],
            "expectedRevision": fresh["revision"],
            "artifactId": fresh["artifact_id"],
            "contentHash": fresh["content_hash"],
            "decision": "approved",
            "rationale": "Streamlit acceptance: confirm the reviewed support actions and check-in.",
        },
    )
    for role in ["student", "parent"]:
        assert "faculty-check-in" in json.dumps(
            call(role, "student", {"studentId": student["id"]})
        )
    plan = next(
        p
        for p in call("faculty", "review_queue")["plans"]
        if p["student_id"] == student["id"]
    )
    assert plan["visible_to_student"]
    call(
        "faculty",
        "outcome",
        {
            "planId": plan["id"],
            "expectedRevision": plan["revision"],
            "status": "withdrawn",
            "outcome": "Streamlit acceptance: temporarily withdraw publication while reviewing support.",
        },
    )
    hidden = next(
        p for p in call("faculty", "review_queue")["plans"] if p["id"] == plan["id"]
    )
    assert not hidden["visible_to_student"]
    call(
        "faculty",
        "outcome",
        {
            "planId": plan["id"],
            "expectedRevision": hidden["revision"],
            "status": "planned",
            "outcome": "Streamlit acceptance: restore the approved support version after review.",
        },
    )
    assert (
        deny(
            "governance",
            "draft_edit",
            {
                "caseId": fresh["id"],
                "expectedRevision": fresh["revision"],
                "artifactId": fresh["artifact_id"],
                "packet": packet,
                "rationale": "An observer cannot edit a mentor recommendation.",
            },
        )
        == 403
    )
    checks.append(
        {
            "journey": "draft edit, stale denial, exact approval, publication, withdrawal, restore and observer denial"
        }
    )
    detail = call("parent", "student", {"studentId": student["id"]})
    invoice = next(i for i in detail["invoices"] if i["status"] != "paid")
    paid = call(
        "parent",
        "payment",
        {
            "invoiceId": invoice["id"],
            "expectedRevision": invoice["revision"],
            "scenario": "success",
        },
    )
    receipt = call("parent", "receipt", {"transactionId": paid["transaction"]["id"]})
    assert receipt["amountPaise"] > 0
    checks.append({"journey": "project payment record and receipt"})
    overview = call("governance", "review_overview")
    job = next(j for j in overview["jobs"] if j.get("run_id"))
    replay = call("governance", "replay", {"runId": job["run_id"]})
    assert replay["replay"]["matched"]
    checks.append({"journey": "recorded-run verification"})
    selected = next(
        s
        for i, s in enumerate(cohort["students"])
        if i >= 40 and i % 4 == 0 and s["mentorId"] == student["mentorId"]
    )
    overview = call("faculty", "review_overview")
    policy = next(
        p for p in overview["policies"] if p["faculty_person_id"] == student["mentorId"]
    )
    new = call(
        "faculty",
        "plan_save",
        {
            "request": "Streamlit review of scoped academic support evidence",
            "studentIds": [selected["id"]],
            "domain": "academic",
            "policyId": policy["id"],
            "mode": "model" if overview["modelConfigured"] else "deterministic",
            "feedback": "Keep source definitions unknown and retain mentor authority.",
        },
    )
    call(
        "faculty",
        "plan_lock",
        {"planId": new["id"], "expectedRevision": new["revision"]},
    )
    ran = call("faculty", "plan_execute", {"planId": new["id"]})
    assert all(not r.get("error") for r in ran["results"])
    export = call("faculty", "plan_export", {"planId": new["id"]})
    job = export["jobs"][0]
    assert job["status"] == "awaiting_faculty"
    assert sorted(job["checkpoint"]["evidence"]) == [
        "academic",
        "internship",
        "lms",
        "placement",
    ]
    assert job["checkpoint"]["composed"]["validation"]["valid"]
    assert call("faculty", "plan_execute", {"planId": new["id"]})["results"] == []
    checks.append(
        {
            "journey": "new locked four-source review and duplicate execution",
            "actualMode": job["checkpoint"]["composed"]["mode"],
        }
    )
    client.logout(sessions["hod"]["token"])
    assert deny("hod", "overview") == 401
    checks.append({"journey": "logout invalidates worker session"})
    result = {
        "status": "passed",
        "checks": checks,
        "studentIndex": student_index,
        "presentationStudentIndex": 20,
        "newPlanId": new["id"],
    }
    (FOLDER / "local-acceptance.json").write_text(json.dumps(result, indent=2) + "\n")
    print(
        json.dumps(
            {
                "status": "passed",
                "checks": len(checks),
                "actualLogins": 6,
                "newReviewMode": job["checkpoint"]["composed"]["mode"],
            }
        )
    )
finally:
    for s in sessions.values():
        try:
            client.logout(s["token"])
        except BridgeError:
            pass
    client.close()
