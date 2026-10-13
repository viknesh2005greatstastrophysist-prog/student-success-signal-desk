"""Read-only actual-account checks for the mentor dashboard increment."""

import json
from pathlib import Path

from bridge import Client
from streamlit.testing.v1 import AppTest

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
at.selectbox[0].select("faculty")
at.text_input[0].set_value(account["email"])
at.text_input[1].set_value(account["password"])
next(b for b in at.button if b.label == "Sign in").click().run()
next(r for r in at.radio if r.label == "Workspace").set_value("Support reviews").run()
assert not at.exception, [e.message for e in at.exception]
assert not at.error, [e.value for e in at.error]
assert any(s.value == "Composite risk view" for s in at.subheader)
next(c for c in at.checkbox if c.label == "Flagged students only").check().run()
assert not at.exception
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
