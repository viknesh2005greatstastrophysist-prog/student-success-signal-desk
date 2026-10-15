"""Offline check (final loop F1): every "Drafted by" names the model that wrote the draft,
or says plainly why there is none; run outcomes read as one plain sentence. No server,
database or credential is involved."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import labels  # noqa: E402

# Model ids as stored on agent runs.
assert labels.drafted_by("model", "groq:qwen/qwen3.8-27b") == "Qwen3.8 27B on Groq"
assert labels.drafted_by("model", "gemini-3.1-flash-lite") == "Gemini 3.1 Flash-Lite"
assert labels.drafted_by("model", "qwen3.8:27b-mlx") == "Qwen3.8 27B (local)"
assert labels.drafted_by("model", "qwen3.8:27b-mlx; shared action profiles") == "Qwen3.8 27B (local), shared bulk draft"
# A packet's provider and model, joined the same way, give the same name.
assert labels.model_name("groq:qwen/qwen3.8-27b") == labels.drafted_by("model", "groq:qwen/qwen3.8-27b")
# No model wrote these, and the label says why instead of a dash.
assert labels.drafted_by("deterministic", None) == "Rules (retired, no AI model)"
assert labels.drafted_by(None, None, "not_flagged") == "No draft needed"
assert labels.drafted_by(None, None, "queued") == "Not drafted yet"
assert labels.drafted_by("unavailable", None) == "No model answered"
for case in [("model", None), (None, None), ("model", "odd_model-id")]:
    text = labels.drafted_by(*case)
    assert text and text != "—" and "_" not in text, (case, text)

# Run outcomes replace the Status / Stage / Issue columns.
assert labels.run_outcome("not_flagged") == "Checked, no support needed"
assert labels.run_outcome("awaiting_faculty") == "Plan drafted, waiting for the mentor"
assert labels.run_outcome("failed", None) == "Stopped before a draft"
assert labels.run_outcome("failed", "AI_UNAVAILABLE").startswith("Stopped: ")

print("verify_drafted_by: ok")
