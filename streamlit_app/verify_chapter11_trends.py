"""Read-only database-backed cycle counts, the department head's aggregate-only
view (no per-student risk) and HoD chart rendering."""

import json
from pathlib import Path

from bridge import Client
from streamlit.testing.v1 import AppTest

root = Path(__file__).resolve().parent.parent
accounts = json.loads((root / "runtime/project-final/accounts.json").read_text())
account = next(a for a in accounts if a["email"] == "hod@aura.project.test")
mentor = next(a for a in accounts if a["email"] == "mentor2@aura.project.test")
c = Client()
# The assigned mentor sees their own students' scores: cycle counts and band
# averages must agree with the job rows they come from.
login = c.login(mentor["email"], mentor["password"], "faculty")
try:
    data = c.request("review_overview", token=login["token"])
    assert data["trends"]
    for cycle in data["trends"]:
        jobs = [j for j in data["jobs"] if j["plan_id"] == cycle["cycle_id"]]
        assert cycle["reviewed"] == sum(j["risk"] is not None for j in jobs)
        assert cycle["flagged"] == sum(
            bool((j["risk"] or {}).get("flagged")) for j in jobs
        )
        assert cycle["awaiting_approval"] == sum(
            j["status"] == "awaiting_faculty" for j in jobs
        )
        assert not any(
            k in cycle for k in ("student_id", "display_name", "register_number")
        )
        for band in ("low", "medium", "high"):
            scores = [
                j["risk"]["score"]
                for j in jobs
                if j["risk"] and j["risk"]["band"] == band
            ]
            assert cycle["average_" + band] == (
                sum(scores) / len(scores) if scores else None
            )
            assert cycle["count_" + band] == len(scores)
finally:
    c.logout(login["token"])
# The department head gets aggregates only (E2E log #8): no per-student score,
# band or signals, and no band average over fewer than three students.
login = c.login(account["email"], account["password"], "hod")
try:
    data = c.request("review_overview", token=login["token"])
    assert data["trends"]
    assert data["riskView"] == []
    assert data["jobs"] and all(j["risk"] is None for j in data["jobs"])
    for cycle in data["trends"]:
        assert cycle["reviewed"] >= cycle["flagged"] >= 0
        for band in ("low", "medium", "high"):
            if cycle["count_" + band] < 3:
                assert cycle["average_" + band] is None, (cycle["cycle_id"], band)
    queue = c.request("review_queue", token=login["token"])
    shown = {
        "id",
        "student_id",
        "display_name",
        "register_number",
        "revision",
        "status",
        "mode",
        "model_id",
        "drafted_at",
    }
    assert all(set(row) <= shown for row in queue["drafts"] + queue["legacyDrafts"])
    assert all(row["mode"] == "model" for row in queue["drafts"])
    assert all(row["mode"] != "model" for row in queue["legacyDrafts"])
finally:
    c.logout(login["token"])
    c.close()
at = AppTest.from_file(str(root / "streamlit_app/app.py"), default_timeout=30).run()
at.segmented_control[0].set_value("hod")
at.text_input[0].set_value(account["email"])
at.text_input[1].set_value(account["password"])
next(b for b in at.button if b.label == "Sign in").click().run()
assert not at.exception and not at.error
assert sum("vega" in node.type for node in at) == 2, [node.type for node in at]
next(b for b in at.button if b.label == "Sign out").click().run()
print(
    "Brief 2: cycle counts, band averages, aggregate-only HoD scope and two HoD charts passed."
)
