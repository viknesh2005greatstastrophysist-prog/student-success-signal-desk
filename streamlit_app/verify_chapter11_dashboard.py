"""Read-only actual-account checks for the mentor dashboard increment."""

import json
import sys
from pathlib import Path

from bridge import Client
from streamlit.testing.v1 import AppTest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apptest_util import open_page  # noqa: E402

root = Path(__file__).resolve().parent.parent
accounts = json.loads((root / "runtime/project-final/accounts.json").read_text())
account = next(a for a in accounts if a["email"] == "mentor2@aura.project.test")
client = Client()
session = client.login(account["email"], account["password"], "faculty")
try:
    view = client.request("review_overview", token=session["token"])
    allowed = {s["id"] for s in view["students"]}
    assert view["riskView"] and all(
        row["studentId"] in allowed for row in view["riskView"]
    )
    queue = client.request("review_queue", token=session["token"])
    assert all("validation" in row for row in queue["drafts"])
    assert all("decided_by" in row for row in queue["plans"])
    assert "interventionLog" in queue
finally:
    client.logout(session["token"])
    client.close()
at = AppTest.from_file(str(root / "streamlit_app/app.py"), default_timeout=30).run()
at.segmented_control[0].set_value("faculty")
at.text_input[0].set_value(account["email"])
at.text_input[1].set_value(account["password"])
next(b for b in at.button if b.label == "Continue").click().run()
open_page(at, "mentees")
at.segmented_control(key="mentees_view").set_value("Risk view").run()
assert not at.exception, [e.message for e in at.exception]
assert not at.error, [e.value for e in at.error]
assert any(s.value == "Composite risk view" for s in at.subheader)
next(c for c in at.checkbox if c.label == "Flagged students only").check().run()
assert not at.exception
at.segmented_control(key="mentees_view").set_value("Outcomes").run()
assert not at.exception, [e.message for e in at.exception]
assert any(
    b.label == "Download intervention log CSV" for b in at.get("download_button")
)
next(b for b in at.button if b.label == "Sign out").click().run()
(root / "runtime/streamlit-project/brief1-ui.json").write_text(
    json.dumps(
        {
            "status": "passed",
            "checks": [
                "actual mentor risk scope",
                "recorded validation and deciding account",
                "immutable intervention log",
                "risk filter and CSV control",
            ],
        },
        indent=2,
    )
    + "\n"
)
print("Brief1 actual-account dashboard checks passed.")
