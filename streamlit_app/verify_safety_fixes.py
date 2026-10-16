"""Offline checks for fix batch A (16 Oct review). Fictional data; no server, database,
model or network.

R-01: the judge's written reasons quote draft sentences and student figures, so only
the assigned mentor (role faculty) sees them; the department head and AI activity see
the scores."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
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

print("verify_safety_fixes: ok")
