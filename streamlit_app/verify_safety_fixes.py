"""Offline checks for fix batch A (16 Oct review). Fictional data; no server, database,
model or network.

R-01: the judge's written reasons quote draft sentences and student figures, so only
the assigned mentor (role faculty) sees them; the department head and AI activity see
the scores.
R-02: a search that matches nothing keeps a selection instead of stopping the page, and
a cleared "Due in days" cell in "Edit the draft" gives a plain error, not a crash."""

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
assert "Cites 61% attendance" in details(judge_rows(JUDGE, "faculty"))
for role in ("hod", "governance", None):
    shown = details(judge_rows(JUDGE, role))
    assert "Cites 61% attendance" not in shown, (role, shown)
    assert "mean 4.5 of 5" in shown and "Grounding 4" in shown, (role, shown)
validation = {"valid": True, "provenance": {"provider": "groq", "model": "qwen", "judge": JUDGE}}
assert "Cites 61%" not in details(provenance_rows(validation, "model", "groq:qwen", role="hod"))
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
    st.session_state.setdefault("calls", []).append([action, data])
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

print("verify_safety_fixes: ok")
