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
    "Get attendance breakdown",  # tool names are shown humanised (labels.tool_label)
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
assert "Get lms timeline" in frames(at)  # humanised tool name

# 4b. Brief 16-lite: the trace shows each repair attempt's diagnosis and the latest open one;
# a run recorded before diagnoses existed falls back to the standard wording per failed check.
DIAGNOSED = {
    **VALIDATION,
    "valid": False,
    "failures": [{"field": "actions", "code": "OUTPUT_PII", "path": "actions[0]"}],
    "diagnoses": [
        {
            "code": "OUTPUT_PII",
            "path": "actions[0]",
            "diagnosis": "Personal details in the draft text (action 1)",
            "instruction": "rewrite action a1 (actions[0]) without names, register numbers, emails, dates or phone numbers",
        }
    ],
    "repairs": [
        {
            "attempt": 1,
            "failures": [{"field": "rationale", "code": "UNSUPPORTED_NUMBER", "path": "rationale[1]"}],
            "diagnoses": [
                {
                    "code": "UNSUPPORTED_NUMBER",
                    "path": "rationale[1]",
                    "diagnosis": "A number not found in the evidence (rationale sentence 2)",
                    "instruction": "rewrite rationale r2 (rationale[1]) so every number equals a cited value or a policy threshold, citing only ev-4",
                }
            ],
        }
    ],
}
for validation, expected, absent in (
    (DIAGNOSED, ("rationale r2 (rationale[1])", "Latest", "without names, register numbers", "Attempt"), "Recorded before targeted"),
    (
        {**VALIDATION, "valid": False, "failures": [{"field": "rationale", "code": "UNSUPPORTED_NUMBER"}], "repairs": [{"attempt": 1, "failures": [{"field": "rationale", "code": "UNSUPPORTED_NUMBER"}]}]},
        ("A number not found in the evidence",),
        "rewrite",
    ),
):
    job = {**review["jobs"][0], "validation": validation}
    at = render(f"ns['render_agent_graph'](json.loads({json.dumps(json.dumps({**review, 'jobs': [job]}))}))")
    assert "Diagnosis and repairs for this run" in [e.label for e in at.status] + [e.label for e in at.expander]
    text = frames(at)
    for token in expected:
        assert token in text, (token, text)
    assert absent not in text
    assert ("Recorded before targeted" in " ".join(c.value for c in at.caption)) == (validation is not DIAGNOSED)
# a clean run (no repairs, no failures) adds no diagnosis panel
at = render(f"ns['render_agent_graph'](json.loads({json.dumps(json.dumps(review))}))")
assert "Diagnosis and repairs for this run" not in [e.label for e in at.status] + [e.label for e in at.expander]

# 4c. Judge agent (#35): scores and reasons in the provenance rows, a compact cobalt chip,
# a Judge node in the strip, the reached flag (#36), an injected fault and an unavailable judge.
JUDGE = {
    "status": "scored", "round": 2, "threshold": 2, "passed": True, "mean": 4.0, "min": 3,
    "low": [], "provider": "groq", "model": "openai/gpt-oss-120b", "tokens": 1500, "latencyMs": 800,
    "scores": {"grounding": 4, "specificity": 3, "actionability": 5, "tone": 4},
    "reasons": {
        "grounding": "Each sentence cites its value.", "specificity": "Names course CS401 and its figure.",
        "actionability": "Practical mentor steps.", "tone": "Neutral and supportive.",
    },
    "fallbacks": [],
    "previous": {
        "status": "scored", "round": 1, "threshold": 2, "passed": False, "mean": 2.8, "min": 2, "low": ["grounding"],
        "repair": "applied", "injected": True, "provider": "groq", "model": "openai/gpt-oss-120b",
        "scores": {"grounding": 2, "specificity": 3, "actionability": 4, "tone": 4},
        "reasons": {"grounding": "injected for testing: the grounding score was forced low", "specificity": "x", "actionability": "y", "tone": "z"},
        "fallbacks": [],
    },
}
JUDGED = {
    **VALIDATION,
    "judge": JUDGE,
    "provenance": {
        **VALIDATION["provenance"],
        "judge": JUDGE,
        "injected": [{"kind": "judge", "note": "injected for testing"}],
        "egress": [
            {"provider": "groq", "model": "m", "payloadHash": "ab" * 32, "fields": ["case"], "bytes": 900, "outcome": "sent", "reached": True},
            {"provider": "groq", "model": "m", "payloadHash": "cd" * 32, "fields": ["case"], "bytes": 900, "outcome": "sent", "reached": False},
        ],
    },
}
at = render(f"ns['render_draft_provenance']({{'mode': 'model'}}, json.loads({json.dumps(json.dumps(JUDGED))}))")
text = frames(at)
for token in (
    "2 passed the privacy guard, 1 reached the model", "mean 4.0 of 5", "Grounding 4",
    "Names course CS401", "Judge first look", "repair applied", "Injected for testing",
):
    assert token in text, (token, text)
at = render(f"ns['ui'].judge_chip_block(json.loads({json.dumps(json.dumps(JUDGE))}))")
markup = " ".join(el.proto.body for el in at.get("html"))
assert "judge" in markup and "4.0/5 · G4 S3 A5 T4" in markup, markup
assert "repaired once after a low score" in markup and "injected for testing" in markup
at = render(f"ns['ui'].judge_chip_block(json.loads({json.dumps(json.dumps({'status': 'unavailable', 'unavailableReason': 'MODEL_HTTP_503'}))}))")
assert "unavailable; the draft was not blocked" in " ".join(el.proto.body for el in at.get("html"))
unavailable = {**VALIDATION, "judge": {"status": "unavailable", "round": 1, "threshold": 2, "unavailableReason": "MODEL_HTTP_503", "fallbacks": []}}
at = render(f"ns['render_draft_provenance']({{'mode': 'model'}}, json.loads({json.dumps(json.dumps(unavailable))}))")
assert "the draft was not blocked" in frames(at)
judged_job = {**review["jobs"][0], "validation": JUDGED}
judged_job["node_trace"] = {**judged_job["node_trace"], "JudgeAgent": {"status": "completed", "visits": 2, "elapsedMs": 1500}}
at = render(f"ns['render_agent_graph'](json.loads({json.dumps(json.dumps({**review, 'jobs': [judged_job]}))}))")
markup = " ".join(el.proto.body for el in at.get("html"))
assert "Judge" in markup and "4.0/5 · G4 S3 A5 T4" in markup, "the strip shows the judge node and its score"

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
                "AI Activity repair diagnoses and ISSUES fallback",
                "judge rows, chip, node and unavailable state",
                "reached flag and injected fault rows",
                "escaping",
                "rule-based plans unchanged",
            ],
        }
    )
)
