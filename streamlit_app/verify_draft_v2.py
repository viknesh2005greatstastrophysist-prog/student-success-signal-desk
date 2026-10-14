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
    ]}
    return f"""
import json, sys
import streamlit as st
sys.path.insert(0, {str(APP)!r})
source = open({str(APP / "app.py")!r}).read().rsplit("\\nmain()", 1)[0]
ns = {{"__name__": "draft_v2_check", "__file__": {str(APP / "app.py")!r}}}
exec(compile(source, "app.py", "exec"), ns)
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
print(json.dumps({"status": "passed", "checks": ["packet-v2 rationale and chips", "escaped model text", "provenance panel", "v1 draft unchanged"]}))
