"""Read-only database-backed cycle counts and HoD chart rendering."""

import json
from pathlib import Path

from bridge import Client
from streamlit.testing.v1 import AppTest

root = Path(__file__).resolve().parent.parent
accounts = json.loads((root / "runtime/project-final/accounts.json").read_text())
account = next(a for a in accounts if a["email"] == "hod@aura.project.test")
c = Client()
login = c.login(account["email"], account["password"], "hod")
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
    "Brief 2: cycle counts, band averages, aggregate schema and two HoD charts passed."
)
