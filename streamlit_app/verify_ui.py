"""Actual-account Streamlit AppTest checks, without exporting secrets or identities."""

import json
from pathlib import Path

from streamlit.testing.v1 import AppTest

root = Path(__file__).resolve().parent.parent
accounts = json.loads((root / "runtime/project-final/accounts.json").read_text())
cohort = json.loads((root / "runtime/project-final/cohort.json").read_text())
s = cohort["students"][32]
ids = {
    "student": s["personId"],
    "parent": s["parentId"],
    "faculty": s["mentorId"],
    "hod": next(a["id"] for a in accounts if a["role"] == "hod"),
    "governance": next(a["id"] for a in accounts if a["role"] == "governance"),
}
ids["lms"] = ids["student"]
checks = []
for portal, id in ids.items():
    account = next(a for a in accounts if a["id"] == id)
    at = AppTest.from_file(str(root / "streamlit_app/app.py"), default_timeout=30).run()
    assert not at.exception, [e.message for e in at.exception]
    at.segmented_control[0].set_value(portal)
    at.text_input[0].set_value(account["email"])
    at.text_input[1].set_value(account["password"])
    next(b for b in at.button if b.label == "Sign in").click().run()
    assert not at.exception, [e.message for e in at.exception]
    assert not at.error, [e.value for e in at.error]
    assert at.session_state["actor"]["role"] == account["role"]
    radios = [r for r in at.radio if r.label == "Workspace"]
    pages = []
    if radios:
        for shown in radios[0].options:
            # Options render as ":material/icon: Page"; the value is the page name.
            label = shown.split(": ", 1)[1] if shown.startswith(":material/") else shown
            next(r for r in at.radio if r.label == "Workspace").set_value(label).run()
            assert not at.exception, [e.message for e in at.exception]
            assert not at.error, [e.value for e in at.error]
            pages.append(label)
    assert not any(w.label == "Password" and w.value for w in at.text_input)
    checks.append(
        {"portal": portal, "actualPasswordLogin": True, "pages": pages, "exceptions": 0}
    )
    next(b for b in at.button if b.label == "Sign out").click().run()
    assert not at.exception
    assert "token" not in at.session_state
(root / "runtime/streamlit-project/ui-acceptance.json").write_text(
    json.dumps({"status": "passed", "checks": checks}, indent=2) + "\n"
)
print(
    json.dumps(
        {
            "status": "passed",
            "actualLogins": len(checks),
            "pages": sum(len(c["pages"]) for c in checks),
        }
    )
)
