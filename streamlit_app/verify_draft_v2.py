"""Offline AppTest check (Brief 11): packet-v2 and v1 drafts render in the mentor
review, citation chips show value and threshold, the provenance panel appears,
and model-written text is escaped. Uses fictional data only; no database."""

import json
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent
PATH = "evidence.academic.values.attendancePct"
COURSE = "evidence.academic.values.attendancePct@21CS501"
SIGNALS = [{"code": "ATTENDANCE_LOW", "path": PATH, "value": 64, "threshold": 75}]
EVIDENCE = {"academic": {"attendancePct": 64, "attendancePct@21CS501": 58}}
V2 = {
    "schema": "packet-v2",
    "specialist": "attendance",
    "summary": "Mentor review requested: attendance low.",
    "rationale": [
        {"text": "Attendance in 21CS501 is 58% against the 75% minimum <script>alert(1)</script>", "citations": [COURSE, PATH]},
        {"text": "The mentor should confirm this reading with the student first.", "citations": [PATH]},
    ],
    "actions": [
        {"code": "attendance-review", "label": "Review attendance barriers and agree an attendance plan with the mentor", "owner": "assigned_faculty",
         "personalisation": "Start with 21CS501, where attendance is lowest.", "talkingPoints": ["What makes 21CS501 hard to attend? [link](http://x)"], "dueInDays": 5, "citations": [COURSE]},
    ],
    "citations": [{"evidencePath": PATH, "statement": "attendancePct is 64; policy threshold is below 75."}],
    "prohibited": [],
}
V1 = {
    "summary": "Mentor review requested: attendance low.",
    "actions": [{"code": "faculty-check-in", "label": "Schedule a 20-minute academic check-in with the assigned mentor", "owner": "assigned_faculty", "dueInDays": 7}],
    "citations": V2["citations"],
    "prohibited": [],
}
PROVENANCE = {
    "provider": "groq", "model": "qwen/qwen3.8-27b", "specialist": "attendance", "repairs": 0, "fallbackReason": None, "tokens": 1800,
    "fallbacks": [{"provider": "local", "model": "qwen3.8:27b-mlx", "reason": "MODEL_UNAVAILABLE"}],
    "egress": [{"provider": "groq", "model": "qwen/qwen3.8-27b", "payloadHash": "ab" * 32, "fields": ["case", "signals[].value"], "bytes": 1520, "outcome": "sent"}],
}


DIAGNOSES = [
    {
        "code": "UNSUPPORTED_NUMBER",
        "path": "rationale[1]",
        "diagnosis": "A number not found in the evidence (rationale sentence 2)",
        "instruction": "rewrite rationale r2 (rationale[1]) so every number equals a cited value or a policy threshold, citing only ev-4",
    }
]
# Brief 16-lite: one repaired draft (diagnosis stored with the attempt), one escalated
# with a latest diagnosis, and one recorded before diagnoses existed (falls back to ISSUES).
REPAIRED = {
    "valid": True, "checks": {}, "packetSchema": "packet-v2", "provenance": PROVENANCE, "diagnoses": [],
    "repairs": [{"attempt": 1, "failures": [{"field": "rationale", "code": "UNSUPPORTED_NUMBER", "path": "rationale[1]"}], "diagnoses": DIAGNOSES}],
}
OPEN = {
    "valid": False, "checks": {}, "packetSchema": "packet-v2", "provenance": PROVENANCE,
    "failures": [{"field": "actions", "code": "OUTPUT_PII", "path": "actions[0]"}],
    "diagnoses": [{
        "code": "OUTPUT_PII", "path": "actions[0]", "diagnosis": "Personal details in the draft text (action 1)",
        "instruction": "rewrite action a1 (actions[0]) without names, register numbers, emails, dates or phone numbers <script>alert(1)</script>",
    }],
    "repairs": [{"attempt": 1, "failures": [{"field": "actions", "code": "OUTPUT_PII", "path": "actions[0]"}], "diagnoses": []}],
}
OLD = {
    "valid": False, "checks": {}, "packetSchema": "packet-v2",
    "failures": [{"field": "rationale", "code": "UNSUPPORTED_NUMBER"}],
    "repairs": [{"attempt": 1, "failures": [{"field": "rationale", "code": "UNSUPPORTED_NUMBER"}]}],
}


def row(draft_id: str, packet: dict, validation: dict) -> dict:
    return {
        "id": draft_id, "student_id": "s-" + draft_id, "revision": 0, "status": "awaiting_faculty", "artifact_id": "a-" + draft_id,
        "recommendation": packet, "content_hash": "h", "validation": validation, "mode": "model", "model_id": "groq:qwen/qwen3.8-27b",
        "display_name": "Fictional Student " + draft_id, "evidence_values": EVIDENCE, "signals": SIGNALS, "policy": {"attendanceMinimum": 75},
    }


def script(selected: int) -> str:
    queue = {"drafts": [
        row("v2", V2, {"valid": True, "checks": {}, "packetSchema": "packet-v2", "provenance": PROVENANCE, "repairs": []}),
        row("v1", V1, {"valid": True, "checks": {}, "repairs": []}),
        row("fixed", V2, REPAIRED),
        row("open", V2, OPEN),
        row("old", V2, OLD),
    ]}
    return f"""
import json, sys
import streamlit as st
sys.path.insert(0, {str(APP)!r})
from apptest_util import namespace
ns = namespace()
queue = json.loads({json.dumps(json.dumps(queue))})
st.session_state["support_draft"] = queue["drafts"][{selected}]
ns["render_draft_reviews"](queue, {{"role": "faculty"}}, {{}})
"""


def html_text(at: AppTest) -> str:
    return " ".join(el.proto.body for el in at.get("html"))


at = AppTest.from_string(script(0), default_timeout=30).run()
assert not at.exception, [e.message for e in at.exception]
# st.expander with an icon is reported as a status container by AppTest.
labels_seen = [e.label for e in at.status] + [e.label for e in at.expander]
assert "How this draft was produced" in labels_seen, labels_seen
markup = html_text(at)
assert "Why this draft" in " ".join(m.value for m in at.markdown)
assert "&lt;script&gt;" in markup and "<script>alert" not in markup
assert "threshold 75" in markup and "21CS501" in markup
assert "What makes 21CS501 hard to attend?" in markup
provenance = " ".join(str(df.value) for df in at.dataframe)
assert "Groq" in provenance and "qwen/qwen3.8-27b" in provenance and "abababab" in provenance

at = AppTest.from_string(script(1), default_timeout=30).run()
assert not at.exception, [e.message for e in at.exception]
assert "Why this draft" not in " ".join(m.value for m in at.markdown)
assert "Recorded before provider tracing" in " ".join(str(df.value) for df in at.dataframe)


def frames(at: AppTest) -> str:
    return " ".join(df.value.to_csv(index=False) for df in at.dataframe)


def captions(at: AppTest) -> str:
    return " ".join(c.value for c in at.caption)


# Brief 16-lite: the stored diagnosis and the fix requested show in the validation report.
at = AppTest.from_string(script(2), default_timeout=30).run()
assert not at.exception, [e.message for e in at.exception]
text = frames(at)
assert "A number not found in the evidence (rationale sentence 2)" in text, text
assert "rewrite rationale r2 (rationale[1])" in text and "citing only ev-4" in text, text
assert "Repair history" in [e.label for e in at.status] + [e.label for e in at.expander]
assert "Only the failing parts were rewritten" in captions(at)
assert "Open issues" not in [e.label for e in at.status] + [e.label for e in at.expander]

at = AppTest.from_string(script(3), default_timeout=30).run()
assert not at.exception, [e.message for e in at.exception]
text = frames(at)
assert "Personal details in the draft text (action 1)" in text, text
assert "without names, register numbers, emails, dates or phone numbers" in text
assert "Open issues" in [e.label for e in at.status] + [e.label for e in at.expander]
assert not any("<script>" in el.proto.body for el in at.get("html"))

# Older record: no stored diagnoses, so the standard wording per failed check is shown.
at = AppTest.from_string(script(4), default_timeout=30).run()
assert not at.exception, [e.message for e in at.exception]
text = frames(at)
assert "A number not found in the evidence" in text and "rewrite" not in text, text
assert "Recorded before targeted diagnoses were stored" in captions(at)

print(json.dumps({"status": "passed", "checks": ["packet-v2 rationale and chips", "escaped model text", "provenance panel", "v1 draft unchanged", "stored diagnosis in repair history", "open issue diagnosis", "older record falls back to ISSUES wording"]}))
