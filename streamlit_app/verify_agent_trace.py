"""Offline AppTest check (Brief 12): the tool-using agents are visible. The AI Activity
trace, the mentor's "How this draft was produced" panel and the plan view show tool calls
(name, aliased arguments, result size), turns, provider/model and any fallback reason; every
dynamic value is escaped; planner questions stay in one st.warning. Fictional data, no database."""

import json
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent
HOSTILE = "<script>alert(1)</script>"
AGENT = {
    "role": "investigator",
    "mode": "tools",
    "turns": 2,
    "modelCalls": 3,
    "budget": {"maxTurns": 2, "maxToolCalls": 4},
    "toolCalls": [
        {
            "seq": 1,
            "turn": 1,
            "tool": "get_attendance_breakdown",
            "args": {"case": "case-8262", "by": "course"},
            "status": "ok",
            "resultBytes": 412,
            "resultHash": "ab" * 32,
        },
        {
            "seq": 2,
            "turn": 1,
            "tool": "get_lms_timeline",
            "args": {"case": "case-8262", "weeks": 4},
            "status": "ok",
            "resultBytes": 329,
            "resultHash": "cd" * 32,
        },
        {
            "seq": 3,
            "turn": 2,
            "tool": "get_policy" + HOSTILE,
            "args": {"case": HOSTILE},
            "status": "refused",
            "code": "BUDGET_EXCEEDED",
        },
        {
            "seq": 4,
            "turn": 2,
            "tool": "get_policy",
            "args": {"case": "case-0000"},
            "status": "refused",
            "code": "OUT_OF_SCOPE",
        },
    ],
    "provider": "groq",
    "model": "qwen/qwen3.8-27b",
    "tokens": 5219,
    "latencyMs": 900,
    "fallbackReason": None,
    "evidenceValues": 9,
    "fallbacks": [],
}
FALLBACK = {
    **AGENT,
    "mode": "standard-evidence",
    "toolCalls": [],
    "turns": 0,
    "provider": None,
    "model": None,
    "evidenceValues": 0,
    "fallbackReason": "TOOLS_UNSUPPORTED: groq MODEL_HTTP_400",
}
PLANNER = {
    **AGENT,
    "role": "planner",
    "questionSource": "model",
    "toolCalls": AGENT["toolCalls"][:2],
}
QUESTIONS = [
    "Does 'this month' mean the last 30 days?",
    "What should 'dropped' be measured against?",
]
BODY = {
    "request": "check my mentees whose attendance dropped this month",
    "mode": "model",
    "domain": "attendance",
    "questions": QUESTIONS,
    "steps": ["Collect four sources"],
    "agent": PLANNER,
    "filter": {"allMine": True, "semesterMax": 6},
    "agentSteps": ["Check attendance against the approved minimum " + HOSTILE],
    "studentIds": [],
    "policyId": None,
}
VALIDATION = {
    "valid": True,
    "checks": {},
    "packetSchema": "packet-v2",
    "repairs": [],
    "provenance": {
        "provider": "groq",
        "model": "qwen/qwen3.8-27b",
        "specialist": "attendance",
        "repairs": 0,
        "fallbackReason": None,
        "fallbacks": [],
        "egress": [],
        "agent": AGENT,
    },
}


def script(call: str) -> str:
    return f"""
import json, sys
import streamlit as st
sys.path.insert(0, {str(APP)!r})
source = open({str(APP / "app.py")!r}).read().rsplit("\\nmain()", 1)[0]
ns = {{"__name__": "agent_trace_check", "__file__": {str(APP / "app.py")!r}}}
exec(compile(source, "app.py", "exec"), ns)
{call}
"""


def render(call: str) -> AppTest:
    at = AppTest.from_string(script(call), default_timeout=30).run()
    assert not at.exception, [e.message for e in at.exception]
    return at


def frames(at: AppTest) -> str:
    return " ".join(df.value.to_csv(index=False) for df in at.dataframe)


# 1. plan view: planner trace, steps escaped, questions untouched
at = render(f"ns['render_planner_trace'](json.loads({json.dumps(json.dumps(BODY))}))")
labels_seen = [e.label for e in at.status] + [e.label for e in at.expander]
assert "How the planner read this request" in labels_seen, labels_seen
text = frames(at)
for expected in (
    "get_attendance_breakdown",
    "by=course",
    "412",
    "Groq",
    "qwen/qwen3.8-27b",
    "the planner model, about this request",
    "all my mentees, up to semester 6",
):
    assert expected in text, (expected, text)
assert "Understood" not in text and any(
    "What the planner understood" in m.value for m in at.markdown
)
assert not any("<script>" in el.proto.body for el in at.get("html"))

# 2. mentor draft panel: the investigator rows and every call, refused ones included
at = render(
    f"ns['render_draft_provenance']({{'mode': 'model'}}, json.loads({json.dumps(json.dumps(VALIDATION))}))"
)
text = frames(at)
assert "Used tools" in text and "2 of 4 tool calls ran, 2 refused" in text, text
assert (
    "Refused · Budget exceeded" in text
    and "Refused · Out of scope" in text
    and "329" in text
)
assert "9 tool values appended" in text

# 3. labelled fallback is shown, with its reason
at = render(
    "ns['render_draft_provenance']({'mode': 'model'}, json.loads("
    + json.dumps(
        json.dumps(
            {
                **VALIDATION,
                "provenance": {**VALIDATION["provenance"], "agent": FALLBACK},
            }
        )
    )
    + "))"
)
text = frames(at)
assert (
    "Standard evidence set (tools not used)" in text
    and "TOOLS_UNSUPPORTED: groq MODEL_HTTP_400" in text
), text

# 4. AI Activity trace: node strip shows the InvestigatorAgent, tool calls follow the model-call table
review = {
    "jobs": [
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "status": "awaiting_faculty",
            "mode": "model",
            "validation": VALIDATION,
            "node_trace": {
                "Coordinator": {"status": "completed", "visits": 1, "elapsedMs": 1},
                "InvestigatorAgent": {
                    "status": "completed",
                    "visits": 1,
                    "elapsedMs": 900,
                },
                "RecommendationAgent": {
                    "status": "completed",
                    "visits": 1,
                    "elapsedMs": 1200,
                },
            },
        }
    ],
    "graph": {"edges": []},
}
at = render(f"ns['render_agent_graph'](json.loads({json.dumps(json.dumps(review))}))")
markup = " ".join(el.proto.body for el in at.get("html"))
assert "Investigator" in markup, "pipeline strip shows the investigator node"
assert "get_lms_timeline" in frames(at)

# 5. a plan without an agent trace renders no planner panel (rule-based plans unchanged)
at = render("ns['render_planner_trace']({'request': 'x', 'questions': []})")
assert not [e for e in at.status] + [e for e in at.expander]

print(
    json.dumps(
        {
            "status": "passed",
            "checks": [
                "plan view planner trace",
                "mentor draft tool calls",
                "labelled fallback",
                "AI Activity node + tool calls",
                "escaping",
                "rule-based plans unchanged",
            ],
        }
    )
)
