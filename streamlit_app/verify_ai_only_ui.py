"""Offline AppTest check (fix pass A): the AI-only review workspace. Fictional data, no
database, no model, no network.

Covers: no execution-mode choice anywhere; the plan card lists who is in scope and
names the policy instead of showing its UUID; a scope conflict is shown with a
keep/switch choice that sends the mentor's answer; the revise form opens empty after
a save and keeps earlier notes read-only; the department head and AI-activity roles see
no plan controls and no risk figures; reviews that no model answered show the audited
reasons and a retry; retired rule-based drafts sit in a collapsed read-only section."""

import html
import json
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent
A, B, C = (f"00000000-0000-4000-8000-00000000000{i}" for i in (1, 2, 3))
POLICY = "7ba9aaf6-9a6e-40eb-bc11-600257503a31"
PLAN = "11111111-1111-4111-8111-111111111111"
NOTE = "Use the current cycle's attendance figures."
CONFLICT = {"selected": 1, "implied": 2, "impliedStudentIds": [B, C]}
BODY = {
    "request": "Check my mentees whose attendance is below the policy threshold.",
    "domain": "attendance",
    "policyId": POLICY,
    "studentIds": [A],
    "feedback": NOTE,
    "questions": [
        "Your request describes 2 students but you selected 1. Keep your 1 or switch to the 2?"
    ],
    "steps": [
        f"Compute faculty-approved policy {POLICY}",
        "Draft attendance support options",
    ],
    "scope": {"basis": "selected", "selected": 1},
    "scopeConflict": CONFLICT,
}
REVIEW = {
    "modelConfigured": True,
    "students": [
        {"id": A, "register_number": "01FE23BCI024", "display_name": "ASHA RAO"},
        {"id": B, "register_number": "01FE23BCI031", "display_name": "BHARAT KULKARNI"},
        {"id": C, "register_number": "01FE23BCI040", "display_name": "CHITRA NAIK"},
    ],
    "policies": [
        {
            "id": POLICY,
            "policy": {"version": "PROJECT-SUPPORT-V1"},
            "rationale": "Approved for the project cycle.",
        }
    ],
    "plans": [
        {
            "id": PLAN,
            "revision": 3,
            "status": "clarifying",
            "paused": False,
            "body": BODY,
        }
    ],
    "jobs": [],
}
FACULTY = {"role": "faculty", "displayName": "Mentor One"}
HOD = {"role": "hod", "displayName": "Department Head"}
GOVERNANCE = {"role": "governance", "displayName": "Operations"}


def script(call: str) -> str:
    return f"""
import json, sys
import streamlit as st
sys.path.insert(0, {str(APP)!r})
from apptest_util import namespace
ns = namespace()
def fake_save(action, data, success):
    st.session_state.setdefault("calls", []).append([action, data])
    return {{}}
ns["save_action"] = fake_save
{call}
"""


def render(call: str) -> AppTest:
    at = AppTest.from_string(script(call), default_timeout=30).run()
    assert not at.exception, [e.message for e in at.exception]
    return at


def workbench(review: dict, actor: dict) -> AppTest:
    return render(
        f"ns['render_plan_workbench'](json.loads({json.dumps(json.dumps(review))}), "
        f"json.loads({json.dumps(json.dumps(actor))}))"
    )


def text_of(at: AppTest) -> str:
    parts = [m.value for m in at.markdown] + [c.value for c in at.caption]
    parts += [w.value for w in at.warning] + [i.value for i in at.info]
    parts += [df.value.to_csv(index=False) for df in at.dataframe]
    parts += [html.unescape(el.proto.body) for el in at.get("html")]
    return "\n".join(str(p) for p in parts)


def labels_of(at: AppTest) -> list[str]:
    return (
        [s.label for s in at.selectbox]
        + [t.label for t in at.text_area]
        + [m.label for m in at.multiselect]
        + [b.label for b in at.button]
        + [
            e.label for e in list(at.status) + list(at.expander)
        ]  # an expander is a status block under AppTest
    )


# 1. the mentor's plan card
at = workbench(REVIEW, FACULTY)
seen = labels_of(at)
assert not any("mode" in label.lower() for label in seen), seen
assert "Create a review plan" in seen and "Answer questions or revise this plan" in seen
text = text_of(at)
assert POLICY not in text, "the policy UUID must not be shown"
assert "Compute faculty-approved policy PROJECT-SUPPORT-V1" in text, text
assert "Students in scope (1)" in seen, seen
scope_frame = next(
    df.value for df in at.dataframe if "Register number" in df.value.columns
)
assert list(scope_frame["Register number"]) == ["01FE23BCI024"] and list(
    scope_frame["Student"]
) == ["Asha Rao"]
assert "Your selection" in text
# the conflict is shown with both answers and nothing has changed yet
assert "Your selection and your request describe different students" in text
assert "You selected **1**; your request describes **2**" in text
assert "Keep my 1" in seen and "Use the 2 from my request" in seen, seen
next(b for b in at.button if b.label == "Keep my 1").click().run()
assert at.session_state["calls"] == [
    [
        "plan_revise",
        {
            "planId": PLAN,
            "expectedRevision": 3,
            "input": {"request": BODY["request"], "scopeChoice": "keep"},
        },
    ]
], at.session_state["calls"]
next(b for b in at.button if b.label == "Use the 2 from my request").click().run()
assert at.session_state["calls"][-1][1]["input"]["scopeChoice"] == "switch"

# 2. the revise form: new notes only, earlier notes read-only, fields show the saved values
feedback = next(t for t in at.text_area if t.label == "Revision feedback")
assert feedback.value == "", "the feedback box starts empty after every save"
assert NOTE in text_of(at), "earlier notes stay visible, outside the box"
assert (
    next(t for t in at.text_area if t.label == "Revised review request").value
    == BODY["request"]
)
assert next(
    m for m in at.multiselect if m.label == "Revised students in scope"
).value == [A]
feedback.set_value("The current evaluation cycle.")
next(b for b in at.button if b.label == "Save revised plan").click().run()
sent = at.session_state["calls"][-1]
assert (
    sent[0] == "plan_revise"
    and sent[1]["input"]["feedback"] == "The current evaluation cycle."
)
assert "mode" not in sent[1]["input"], "no execution mode is sent"
# a new revision opens a fresh form even when the previous text was typed in
moved = {
    **REVIEW,
    "plans": [
        {
            **REVIEW["plans"][0],
            "revision": 4,
            "body": {
                **BODY,
                "feedback": f"{NOTE}\nThe current evaluation cycle.",
                "scopeConflict": {**CONFLICT, "resolution": "kept"},
            },
        }
    ],
}
at = workbench(moved, FACULTY)
assert next(t for t in at.text_area if t.label == "Revision feedback").value == ""
assert "The current evaluation cycle." in text_of(at)
assert "Your selection and your request describe different students" not in text_of(
    at
), "a kept choice is not asked again"

# 3. read-only roles: no plan controls, the conflict is shown without buttons
for actor in (HOD, GOVERNANCE):
    at = workbench(REVIEW, actor)
    seen = labels_of(at)
    for control in (
        "Create a review plan",
        "Answer questions or revise this plan",
        "Save revised plan",
        "Lock review plan",
        "Keep my 1",
        "Use the 2 from my request",
        "Retry AI review",
    ):
        assert control not in seen, (actor["role"], control, seen)
    assert "Students in scope (1)" in seen, "they can still see who is in scope"
    assert "can observe review plans but not create or change them" in text_of(at)
    assert "Only the assigned mentor can answer this" in text_of(at)

# 4. reviews that no model answered: the reasons, the retry, and no draft
locked = {
    **REVIEW["plans"][0],
    "status": "locked",
    "body": {
        **BODY,
        "scopeConflict": {**CONFLICT, "resolution": "kept"},
        "questions": [],
    },
}
jobs = [
    {
        "id": f"22222222-2222-4222-8222-22222222222{i}",
        "plan_id": PLAN,
        "student_id": sid,
        "status": "ai_unavailable",
        "stage": "recommend",
        "error_code": "AI_UNAVAILABLE",
        "mode": None,
        "failure_reasons": [
            "groq qwen/qwen3.8-27b: MODEL_HTTP_503",
            "gemini gemini-3.1-flash-lite: MODEL_HTTP_429: rate limited (HTTP 429, retry after 30s)",
        ],
    }
    for i, sid in enumerate((A, B))
]
waiting = {**REVIEW, "plans": [locked], "jobs": jobs}
at = workbench(waiting, FACULTY)
text = text_of(at)
assert "2 of 2 student reviews are waiting for an AI model" in text, text
assert "Nothing was drafted by rules" in text
reasons = next(df.value for df in at.dataframe if "What happened" in df.value.columns)
assert list(reasons["Provider"]) == ["Groq", "Gemini"], reasons
assert "MODEL_HTTP_503" in " ".join(reasons["What happened"])
assert "No AI model answered; waiting for a retry" in text
retry = next(b for b in at.button if b.label == "Retry AI review")
retry.click().run()
assert at.session_state["calls"][-1] == ["plan_execute", {"planId": PLAN}]
assert "Retry AI review" not in labels_of(workbench(waiting, HOD))
assert "Rule template offered" not in text_of(workbench(waiting, FACULTY))

# 5. the review queue: active drafts only; retired drafts collapsed and read-only; HoD sees no content
DRAFT = {
    "id": "33333333-3333-4333-8333-333333333333",
    "student_id": A,
    "display_name": "ASHA RAO",
    "register_number": "01FE23BCI024",
    "revision": 0,
    "status": "awaiting_faculty",
    "mode": "model",
    "model_id": "groq:qwen/qwen3.8-27b",
    "drafted_at": "2026-10-14T08:00:00.000Z",
    "artifact_id": "44444444-4444-4444-8444-444444444444",
    "content_hash": "h",
    "validation": {"valid": True},
    "recommendation": {
        "summary": "Mentor review requested: attendance low.",
        "actions": [],
    },
}
LEGACY = {
    **DRAFT,
    "id": "55555555-5555-4555-8555-555555555555",
    "student_id": B,
    "display_name": "BHARAT KULKARNI",
    "register_number": "01FE23BCI031",
    "mode": "deterministic",
    "model_id": None,
    "recommendation": {
        "summary": "Rule-based summary kept on record.",
        "actions": [{"label": "Schedule a check-in", "dueInDays": 7}],
    },
}
QUEUE = {"drafts": [DRAFT], "legacyDrafts": [LEGACY], "plans": []}


DECISION_LABELS = {"Approve and publish", "Edit", "Decline", "Save new draft version"}


def queue(actor: dict, data: dict) -> AppTest:
    return render(
        f"q = json.loads({json.dumps(json.dumps(data))}); a = json.loads({json.dumps(json.dumps(actor))})\n"
        "ns['render_draft_reviews'](q, a, {})\nns['render_legacy_drafts'](q, a)"
    )


at = queue(FACULTY, QUEUE)
legacy_box = next(
    e for e in list(at.status) + list(at.expander) if e.label == "Legacy drafts (1)"
)
assert legacy_box.proto.expanded is False, "legacy drafts start collapsed"
decision_forms = [
    b.label for b in at.button if b.label in DECISION_LABELS
]
assert decision_forms == ["Approve and publish", "Edit", "Decline", "Save new draft version"], decision_forms
text = text_of(at)
assert (
    "Mentor review requested: attendance low." in text
    and "Rule-based summary kept on record." in text
)
assert "Undecided, read-only" in text and "Rules (retired, no AI model)" in text
assert len([b for b in at.button if b.label == "Approve and publish"]) == 1, (
    "only the AI-written draft can be decided"
)
at = queue(FACULTY, {"drafts": [], "legacyDrafts": [LEGACY], "plans": []})
assert "Nothing is waiting for you" in text_of(at)
assert (
    "Older drafts from the retired rule-based path are kept below, read-only (1)"
    in text_of(at)
)
assert not [
    b for b in at.button if b.label in DECISION_LABELS
], "a legacy draft has no decision controls"
at = queue(HOD, QUEUE)
text = text_of(at)
assert "Awaiting the assigned mentor" in text and "01FE23BCI024" in text
assert "Mentor review requested" not in text, (
    "draft content stays with the assigned mentor"
)
assert (
    "Draft contents, risk scores and evidence are visible only to the student's assigned mentor"
    in text
)
assert not [
    b for b in at.button if b.label in DECISION_LABELS
]
assert "Legacy drafts (1)" in labels_of(at)
assert "Rule-based summary kept on record." not in text_of(at), (
    "HoD sees the legacy list, never the content"
)

print(
    json.dumps(
        {
            "status": "passed",
            "checks": [
                "no execution mode",
                "policy named, not a UUID",
                "students in scope listed",
                "scope conflict keep and switch",
                "revise form opens empty, notes kept",
                "HoD and governance read-only",
                "AI unavailable reasons and retry",
                "legacy drafts collapsed and read-only",
                "HoD queue without scores or content",
            ],
        }
    )
)
