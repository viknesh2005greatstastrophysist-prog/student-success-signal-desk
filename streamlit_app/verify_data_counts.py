"""Offline check (E2E log fix pass B): the pure helpers behind the headline
counts and badges. No server, database or credential is involved."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import labels  # noqa: E402

# #3: a pass is only claimed when the acceptance checks were recorded.
ALL = {name: True for name in labels.CHECK_NAMES}
assert labels.validation_headline({"valid": True, "checks": ALL})[0] == "Passed every check"
assert labels.validation_headline({"valid": True})[0] == "Checks not recorded for this version"
assert labels.validation_headline({"valid": True, "checks": {}})[1] == "gray"
assert labels.validation_headline({"valid": False, "checks": ALL})[0] == "Did not pass"
assert labels.validation_headline({"valid": True, "checks": {**ALL, "privacy_scope_enforced": False}})[0] == "Did not pass"
assert "3 recorded of 4" in labels.validation_headline(
    {"valid": True, "checks": {k: True for k in list(ALL)[:3]}}
)[0]
assert labels.validation_headline(None)[0] == "Checks not recorded for this version"

# #10: a failure is never rounded up to 100%.
assert labels.percent_text(649, 650) == "99.8%"
assert labels.percent_text(9999, 10000) == "99.9%"
assert labels.percent_text(650, 650) == "100%"
assert labels.percent_text(0, 5) == "0%" and labels.percent_text(0, 0) == "—"

# #6: rows are student x cycle; counts are students.
def row(student, plan, latest, score=None, flagged=False, band="not evaluated"):
    return {"studentId": student, "planId": plan, "latest": latest, "score": score,
            "flagged": flagged, "band": band}

rows = [
    row("a", "p2", True, 80, True, "high"), row("a", "p1", False, 70, True, "high"),
    row("b", "p2", True), row("b", "p1", False, 55, True, "medium"),
]
every = labels.risk_scope(rows)
assert [r["planId"] for r in every] == ["p2", "p2"], "all cycles: each student's latest row"
assert labels.risk_counts(every) == {"students": 2, "evaluated": 1, "flagged": 1, "high": 1, "medium": 0}
assert len(labels.risk_scope(rows, "p1")) == 2 and len(labels.risk_scope(rows, "p1", True)) == 2
assert len(labels.risk_scope(rows, None, True)) == 1

# #14: each plan counted once by current status, nothing lost.
plans = [{"status": "planned"}, {"status": "planned"}, {"status": "withdrawn"}, {"status": None}]
counts = labels.outcome_counts(plans)
assert counts == {"plans": 4, "planned": 3, "in_progress": 0, "completed": 0, "withdrawn": 1}
assert counts["plans"] == sum(v for k, v in counts.items() if k != "plans")

# #30: after the due time is late; the Core's flag wins when present.
assert labels.is_late("2026-10-09 15:53:00+00", "2026-10-12 17:43:00+00") is True
assert labels.is_late("2026-10-09 15:53:00+00", "2026-10-09 15:53:00+00") is False
assert labels.is_late("2026-10-09 15:53:00+00", "2026-10-09 10:00:00+00") is False
assert labels.is_late("2026-10-09 15:53:00+00", "2026-10-12 17:43:00+00", False) is False
assert labels.is_late(None, "2026-10-12 17:43:00+00") is False

print("Fix pass B: validation headline, percent rounding, student counts, outcome counts and late submissions passed.")
