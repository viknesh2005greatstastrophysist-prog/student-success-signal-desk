"""Offline check: attendance derived from the college report is labelled as such.

The draft provenance panel adds an "Attendance figures" row only when the frozen evidence
carries `attendanceBasis` (set by the Core for students whose attendance was rebuilt in
data generation realistic-v3); older evidence and student 021 get no such row.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import labels  # noqa: E402
from views.reviews import provenance_rows  # noqa: E402

VALIDATION = {"valid": True, "packetSchema": "packet-v2", "provenance": {"provider": "groq", "model": "m", "repairs": 0}}

labelled = provenance_rows(
    VALIDATION, "model", "m", {"academic": {"attendancePct": 61.2, "attendanceBasis": "college_attendance_report"}}
)
row = [r for r in labelled if r["Step"] == "Attendance figures"]
assert len(row) == 1, labelled
assert "college attendance report" in row[0]["Detail"].lower() and "not raw" in row[0]["Detail"].lower(), row

for evidence in (None, {}, {"academic": {"attendancePct": 61.2}}, {"academic": None}):
    assert not [r for r in provenance_rows(VALIDATION, "model", "m", evidence) if r["Step"] == "Attendance figures"], evidence

legacy = provenance_rows({"valid": True}, "model", "m", {"academic": {"attendanceBasis": "college_attendance_report"}})
assert [r for r in legacy if r["Step"] == "Attendance figures"], legacy
assert "college attendance report" in labels.ATTENDANCE_BASIS_NOTE and "not raw" in labels.ATTENDANCE_BASIS_NOTE
assert labels.attendance_basis_label("college_attendance_report").startswith("College attendance report")

print(json.dumps({"status": "passed", "checks": ["provenance row only with the evidence flag", "legacy packet", "note text"]}))
