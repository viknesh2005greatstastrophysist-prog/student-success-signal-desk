"""Actual-account Streamlit AppTest checks, without exporting secrets or identities."""

import json
import sys
from pathlib import Path

from streamlit.testing.v1 import AppTest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apptest_util import open_page, page_registry  # noqa: E402

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
# URL path of every page each workspace offers ("" is the landing page).
EXPECTED_PAGES = {
    "student": ["", "courses", "learning", "support-plan", "profile"],
    "parent": ["", "support-plan", "fees", "profile"],
    "faculty": ["", "mentees", "reviews", "classroom"],
    "hod": ["", "students", "mentors", "policies"],
    "governance": ["", "agent-graph", "evaluation", "audit"],
    "lms": [""],
}
checks = []

# Source records are evidence for staff: the engine refuses them to students and
# parents (their workspaces do not offer the page either), and serves staff.
from bridge import BridgeError, Client  # noqa: E402

client = Client()
try:
    for portal in ("student", "parent", "faculty"):
        account = next(a for a in accounts if a["id"] == ids[portal])
        session = client.login(account["email"], account["password"], portal)
        try:
            if portal == "faculty":
                assert client.request("sources", token=session["token"])["counts"]["students"] > 0
                continue
            try:
                client.request("sources", token=session["token"])
            except BridgeError as error:
                assert error.status == 403, (portal, error.status)
            else:
                raise AssertionError(f"{portal} was served source records")
        finally:
            client.logout(session["token"])
finally:
    client.close()
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
    registry = page_registry(at)
    assert set(registry) == set(EXPECTED_PAGES[portal]), (portal, sorted(registry))
    pages = []
    for url_path, info in registry.items():
        open_page(at, url_path)
        assert not at.exception, [e.message for e in at.exception]
        assert not at.error, [e.value for e in at.error]
        pages.append(info.get("page_name") or url_path)
    # Fees are the parent's concern; source records are evidence for staff only.
    if portal in {"student", "parent"}:
        assert not {"source-records", "sources"} & set(registry), (portal, sorted(registry))
    if portal == "student":
        assert "fees" not in registry, sorted(registry)
        for blocked in ("fees", "source-records"):
            try:
                open_page(at, blocked)
            except ValueError:
                pass
            else:
                raise AssertionError(f"student reached /{blocked}")
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
