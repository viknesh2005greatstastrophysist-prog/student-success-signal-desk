"""Offline checks for fix batch A (16 Oct review). Fictional data; no server, database,
model or network.

R-01: the judge's written reasons quote draft sentences and student figures, so only
the mentor and (owner decision, 17 Oct) the department head see them; AI activity sees
the scores.
R-02: a search that matches nothing keeps a selection instead of stopping the page, and
a cleared "Due in days" cell in "Edit the draft" gives a plain error, not a crash.
R-03: a frozen record (the Core marks the queue row frozen) is shown read-only at the
gate and is never offered for a new review.
R-05: a draft on earlier figures offers no Approve button, and the confirmation and the
success message name who can actually see an approved plan.
Batch B2: stop reasons (a blocked data check, a model that did not answer) stay with the
mentor and the department head; AI activity sees "N reasons, kept with the mentor and the
department head". A frozen record's card is headed "Kept unchanged", not a question.
P2-2: in "Edit the draft" the Action and Owner columns are read-only (the Core refuses any
other catalogue label or owner); the summary and the due days are what a mentor edits."""

import json
import sys
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
from views.reviews import judge_rows, provenance_rows  # noqa: E402

JUDGE = {
    "status": "scored",
    "scores": {"grounding": 4, "specificity": 4, "actionability": 5, "tone": 5},
    "reasons": {"grounding": "Cites 61% attendance in CS201"},
    "mean": 4.5,
    "min": 4,
    "passed": True,
    "provider": "groq",
    "model": "openai/gpt-oss-120b",
}


def details(rows: list[dict[str, str]]) -> str:
    return "\n".join(f"{row['Step']}: {row['Detail']}" for row in rows)


# R-01
for role in ("faculty", "hod"):
    assert "Cites 61% attendance" in details(judge_rows(JUDGE, role)), role
for role in ("governance", None):
    shown = details(judge_rows(JUDGE, role))
    assert "Cites 61% attendance" not in shown, (role, shown)
    assert "mean 4.5 of 5" in shown and "Grounding 4" in shown, (role, shown)
validation = {"valid": True, "provenance": {"provider": "groq", "model": "qwen", "judge": JUDGE}}
assert "Cites 61%" not in details(provenance_rows(validation, "model", "groq:qwen", role="governance"))
assert "Cites 61%" in details(provenance_rows(validation, "model", "groq:qwen", role="hod"))
assert "Cites 61%" in details(provenance_rows(validation, "model", "groq:qwen", role="faculty"))
# the shaped report the Core sends to other roles (repairCount, no repairs list) renders
shaped = {"valid": True, "repairCount": 2, "provenance": {"provider": "groq", "model": "qwen", "repairs": 2}}
assert "Repairs: 2" in details(provenance_rows(shaped, "model", "groq:qwen", role="governance"))



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
{body}
"""
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception, [e.message for e in at.exception]
    return at


def captions(at: AppTest) -> str:
    return "\n".join(c.value for c in at.caption)


def rerun(at: AppTest) -> AppTest:
    at.run()
    assert not at.exception, [e.message for e in at.exception]
    return at


# R-02 (a): pick() keeps a selection when the search matches nothing
ROWS = [{"id": f"r{i}", "name": f"Student {i:02d}"} for i in range(14)]
at = run(
    f"rows = json.loads({json.dumps(json.dumps(ROWS))})\n"
    "st.session_state['picked'] = ns['pick']('Draft', rows, format_func=lambda r: r['name'], key='p')"
)
at.text_input(key="p__search").set_value("Student 05")
rerun(at)
assert at.session_state["picked"]["id"] == "r5", at.session_state["picked"]
at.text_input(key="p__search").set_value("zzzz-no-match")
rerun(at)
assert at.session_state["picked"]["id"] == "r5", "the earlier choice stays"
assert "No match for \u201czzzz-no-match\u201d; showing Student 05." in captions(at), captions(at)

# the Agent graph run picker (more than 12 runs) with a query that matches nothing
JOBS = [
    {
        "id": f"00000000-0000-4000-8000-{i:012d}",
        "student_id": f"s{i}",
        "status": "not_flagged",
        "node_trace": {"Coordinator": {"status": "completed", "visits": 1, "elapsedMs": 1}},
    }
    for i in range(14)
]
GRAPH = {"jobs": JOBS, "students": [{"id": f"s{i}", "display_name": f"STUDENT {i}"} for i in range(14)], "graph": {"edges": []}}
at = run(f"ns['render_agent_graph'](json.loads({json.dumps(json.dumps(GRAPH))}))")
at.text_input(key="graph_job__search").set_value("zzzz-no-match")
rerun(at)
assert "No match for" in captions(at), captions(at)

# R-02 (b): a cleared "Due in days" cell is refused with a plain error
PACKET = {
    "summary": "Mentor review requested: attendance low.",
    "actions": [{"code": "faculty-check-in", "label": "Schedule a 20-minute check-in", "owner": "assigned_faculty", "dueInDays": 7}],
    "citations": [],
    "prohibited": [],
}
DRAFT = {
    "id": "case-1", "student_id": "s1", "revision": 0, "status": "awaiting_faculty", "artifact_id": "art-1",
    "recommendation": PACKET, "content_hash": "h", "validation": {"valid": True, "checks": {}, "repairs": []},
    "mode": "model", "model_id": "groq:qwen/qwen3.8-27b", "display_name": "FICTIONAL STUDENT", "evidence_current": True,
}
QUEUE = {"drafts": [DRAFT]}
CLEARED = """
_editor = st.data_editor
def cleared(data, **kwargs):
    frame = _editor(data, **kwargs)
    if "Due in days" in frame:
        frame.loc[0, "Due in days"] = float("nan")
    return frame
st.data_editor = cleared
"""
at = run(CLEARED + f"ns['render_draft_reviews'](json.loads({json.dumps(json.dumps(QUEUE))}), {{'role': 'faculty'}}, {{}})")
next(t for t in at.text_area if t.label == "Reason for this edit").set_value("Shorter deadline for this week.")
next(b for b in at.button if b.label == "Save new draft version").click()
rerun(at)
errors = " ".join(e.value for e in at.error)
assert "Enter the number of days (1 to 14) for every action" in errors, errors
assert "calls" not in at.session_state, "nothing was saved"

# P2-2: Action and Owner are read-only, and a save keeps the drafted code, label and owner
from common import ACTION_OWNER_LABELS  # noqa: E402

assert list(ACTION_OWNER_LABELS) == ["assigned_faculty"], "no owner the Core would refuse is offered"
TAMPERED = """
_editor = st.data_editor
def tampered(data, **kwargs):
    st.session_state["editor_disabled"] = sorted(kwargs.get("disabled") or [])
    frame = _editor(data, **kwargs)
    if "Due in days" in frame:
        frame.loc[0, "Action"] = "Call the parent today"
        frame.loc[0, "Owner"] = "Student"
        frame.loc[0, "Due in days"] = 3
    return frame
st.data_editor = tampered
"""
at = run(TAMPERED + f"ns['render_draft_reviews'](json.loads({json.dumps(json.dumps(QUEUE))}), {{'role': 'faculty'}}, {{}})")
assert at.session_state["editor_disabled"] == ["Action", "Owner"], at.session_state["editor_disabled"]
assert "Actions come from the policy catalogue; to change them, decline and start a new review." in captions(at), captions(at)
next(t for t in at.text_area if t.label == "Reason for this edit").set_value("Shorter deadline for this week.")
next(b for b in at.button if b.label == "Save new draft version").click()
rerun(at)
action, data, _ = at.session_state["calls"][-1]
assert action == "draft_edit", action
assert data["packet"]["actions"] == [
    {"code": "faculty-check-in", "label": "Schedule a 20-minute check-in", "owner": "assigned_faculty", "dueInDays": 3}
], data["packet"]["actions"]

# R-03: a frozen case at the gate is read-only, and no new review is offered for it
FROZEN = {**DRAFT, "frozen": True, "evidence_current": False}
at = run(f"ns['render_draft_reviews'](json.loads({json.dumps(json.dumps({'drafts': [FROZEN]}))}), {{'role': 'faculty'}}, {{}})")
buttons = [b.label for b in at.button]
for label in ("Approve and publish", "Edit", "Decline", "Save new draft version"):
    assert label not in buttons, (label, buttons)
assert any("kept unchanged for the project presentation" in i.value for i in at.info), [i.value for i in at.info]
assert not [b for b in buttons if b.startswith("Review ")], buttons
heads = " ".join(el.proto.body for el in at.get("html"))
assert "Kept unchanged" in heads and "Approve this plan?" not in heads, heads
# the same draft without the flag offers the re-review button (so the check above means something)
at = run(f"ns['render_draft_reviews'](json.loads({json.dumps(json.dumps({'drafts': [{**FROZEN, 'frozen': False}]}))}), {{'role': 'faculty'}}, {{}})")
assert any(b.label.startswith("Review ") for b in at.button), [b.label for b in at.button]

# R-05: a draft on earlier figures can be declined, not approved
EARLIER = {**DRAFT, "evidence_current": False}
at = run(f"ns['render_draft_reviews'](json.loads({json.dumps(json.dumps({'drafts': [EARLIER]}))}), {{'role': 'faculty'}}, {{}})")
buttons = [b.label for b in at.button]
assert "Approve and publish" not in buttons and "Decline" in buttons and "Edit" in buttons, buttons
assert any("Based on earlier figures: review again before approving" in w.value for w in at.warning), [w.value for w in at.warning]


def approve(draft: dict) -> AppTest:
    at = run(f"ns['render_draft_reviews'](json.loads({json.dumps(json.dumps({'drafts': [draft]}))}), {{'role': 'faculty'}}, {{}})")
    assert not any("earlier figures" in w.value for w in at.warning)
    next(t for t in at.text_area if t.label == "Decision rationale").set_value("Matches what I see in class.")
    next(b for b in at.button if b.label == "Approve and publish").click()
    rerun(at)
    assert "calls" not in at.session_state, "approval waits for the confirmation"
    return at


# the parent is named only when a parent holds the support grant
for access, audience in ((True, "Fictional Student and their parent"), (False, "Fictional Student and any parent with access")):
    at = approve({**DRAFT, "parent_support_access": access})
    confirm = " ".join(m.value for m in at.markdown)
    assert f"Share this plan with {audience}?" in confirm, confirm
    next(b for b in at.button if b.label == "Yes, approve and publish").click()
    rerun(at)
    action, data, success = at.session_state["calls"][-1]
    assert action == "case_decide" and data["decision"] == "approved", (action, data)
    assert success == f"Approved and published: {audience} can now see the plan.", success

# B2 fix 1: stop reasons. The Core sends other roles a count and an empty list.
PLAN_ID = "11111111-1111-4111-8111-111111111111"
STUDENTS = [{"id": "s1", "display_name": "FICTIONAL ONE"}, {"id": "s2", "display_name": "FICTIONAL TWO"}]
PLAN = {"id": PLAN_ID, "revision": 1, "status": "locked", "paused": False,
        "body": {"request": "Check my mentees", "domain": "attendance", "studentIds": ["s1", "s2"], "questions": []}}
REASONS = ["Attendance 61% in CS201 is below the threshold", "groq qwen/qwen3.8-27b: MODEL_HTTP_503"]


def stopped_jobs(shaped: bool) -> list[dict]:
    """One review no model answered, one handed to the mentor, as the Core sends them."""
    waiting = {"id": "j1", "plan_id": PLAN_ID, "student_id": "s1", "status": "ai_unavailable",
               "error_code": "AI_UNAVAILABLE", "failure_reasons": REASONS,
               "failure_diagnosis": {"code": "AI_UNAVAILABLE", "attempts": 0, "reasons": REASONS}}
    handed = {"id": "j2", "plan_id": PLAN_ID, "student_id": "s2", "status": "needs_human",
              "error_code": "DATA_BLOCKED", "failure_reasons": REASONS[:1],
              "failure_diagnosis": {"code": "DATA_BLOCKED", "attempts": 3, "reasons": REASONS[:1]}}
    if shaped:
        for job, count in ((waiting, 2), (handed, 1)):
            job.update(failure_reasons=[], failure_reason_count=count,
                       failure_diagnosis={**{k: job["failure_diagnosis"][k] for k in ("code", "attempts")}, "reasonCount": count})
    return [waiting, handed]


def workbench_text(jobs: list[dict], role: str) -> str:
    review = {"modelConfigured": True, "students": STUDENTS, "policies": [], "plans": [PLAN], "jobs": jobs}
    at = run(f"ns['render_plan_workbench'](json.loads({json.dumps(json.dumps(review))}), {{'role': {role!r}}})")
    parts = [c.value for c in at.caption] + [m.value for m in at.markdown] + [w.value for w in at.warning]
    parts += [df.value.to_csv(index=False) for df in at.dataframe] + [str(j.proto.body) for j in at.json]
    parts += [el.proto.body for el in at.get("html")]
    return "\n".join(parts)


for role in ("governance",):
    shown = workbench_text(stopped_jobs(shaped=True), role)
    assert "2 reasons, kept with the mentor and the department head." in shown, shown
    assert "1 reason, kept with the mentor and the department head." in shown, shown
    assert "CS201" not in shown and "MODEL_HTTP_503" not in shown, shown
# the mentor and the department head read the reasons themselves, and no withheld line
for role in ("faculty", "hod"):
    shown = workbench_text(stopped_jobs(shaped=False), role)
    assert "MODEL_HTTP_503" in shown and "CS201" in shown, (role, shown)
    assert "kept with the mentor" not in shown, shown

print("verify_safety_fixes: ok")
