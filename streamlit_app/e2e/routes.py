#!/usr/bin/env python3
"""Page-address check (final loop): every page address of every workspace, opened signed out,
then signed in from that address, then another workspace's address opened while signed in.

Pass criteria, per address:
  * signed out: the sign-in form shows, never Streamlit's "Page not found";
  * after signing in from the address: that page opens (same address; its title is recorded too),
    no "Page not found";
  * signed in, another workspace's address: a plain "another workspace" note, no "Page not found".

Read-only: it signs in through the real form and never clicks anything else. Credentials come
from the root .env exactly as in walk.py and are never printed. Student 021 is never used.

Usage (server already running):
    .venv/bin/python streamlit_app/e2e/routes.py --base-url http://127.0.0.1:8503
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from walk import ROOT, Walk  # noqa: E402

PAGES = {
    "Student": ("STUDENT001", [("overview", "Overview"), ("courses", "Courses"), ("learning", "Learning"),
                               ("support-plan", "My support plan"), ("profile", "Profile")]),
    "Parent": ("PARENT001", [("overview", "Overview"), ("support-plan", "Support plan and mentor updates"),
                             ("fees", "Fees and receipts"), ("profile", "Profile")]),
    "Mentor": ("MENTOR1", [("today", "Today"), ("mentees", "Mentees"), ("reviews", "Reviews"),
                           ("classroom", "Classroom")]),
    "Department head": ("HOD", [("overview", "Overview"), ("students", "Students"), ("reviews", "Reviews"),
                                ("mentors", "Mentors"), ("policies", "Policies")]),
    "AI activity": ("OPERATIONS", [("runs", "Runs"), ("agent-graph", "Agent graph"), ("evaluation", "Evaluation"),
                                   ("audit", "Audit and replay")]),
    "Learning (LMS)": ("STUDENT001", [("learning", "Learning")]),
}
NOT_FOUND = "Page not found"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8503")
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--only", default="", help="comma list of workspace labels")
    args = parser.parse_args()
    walk = Walk(argparse.Namespace(pass_no="routes", base_url=args.base_url, timeout=args.timeout))
    all_paths = sorted({path for _, pages in PAGES.values() for path, _ in pages})
    results: list[dict[str, object]] = []

    def body(page) -> str:
        return walk.scrub(page.locator("body").inner_text())

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for workspace, (env, pages) in PAGES.items():
            if args.only and workspace not in args.only.split(","):
                continue
            for index, (path, title) in enumerate(pages):
                ctx, page = walk.new_context(browser, {"width": 1280, "height": 900})
                row: dict[str, object] = {"workspace": workspace, "path": f"/{path}"}
                page.goto(f"{args.base_url}/{path}", wait_until="domcontentloaded")
                page.wait_for_selector('[data-testid="stForm"]', timeout=args.timeout * 1000)
                walk.settle(page)
                row["signed_out_not_found"] = NOT_FOUND in body(page)
                email, password = walk.creds({"env": env, "key": workspace})
                walk.choose_portal(page, workspace)
                page.locator("input[aria-label=Email]").fill(email)
                page.locator("input[type=password]").fill(password)
                page.get_by_role("button", name="Continue", exact=True).click()
                page.wait_for_selector('[data-testid="stSidebar"]', state="attached", timeout=args.timeout * 1000)
                walk.settle(page)
                time.sleep(1.0)
                walk.settle(page)
                text = body(page)
                main_text = walk.scrub(page.locator('[data-testid="stMain"]').inner_text())
                row["after_sign_in_not_found"] = NOT_FOUND in text
                row["landed_on_title"] = title in main_text.split("\n", 6)[0:6] or main_text.lstrip().startswith(title)
                row["url_after"] = page.url.replace(args.base_url, "") or "/"
                if index == 0:
                    # Signed in: another workspace's address, opened in-app (keeps the session).
                    foreign = next(p for p in all_paths if p not in {q for q, _ in pages})
                    page.evaluate(
                        "(p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }",
                        f"/{foreign}",
                    )
                    walk.settle(page)
                    time.sleep(1.0)
                    walk.settle(page)
                    text = body(page)
                    row["foreign_path"] = f"/{foreign}"
                    row["foreign_not_found"] = NOT_FOUND in text
                    row["foreign_note"] = "This page is in another workspace" in text
                ctx.close()
                ok = (
                    not row["signed_out_not_found"]
                    and not row["after_sign_in_not_found"]
                    and row["url_after"] == f"/{path}"
                    and not row.get("foreign_not_found", False)
                    and row.get("foreign_note", True)
                )
                row["ok"] = bool(ok)
                results.append(row)
                print(("OK  " if ok else "FAIL"), json.dumps(row), flush=True)
        browser.close()
    out = ROOT / "runtime" / "streamlit-project" / "e2e" / "routes.json"
    out.write_text(json.dumps(results, indent=2))
    failed = [r for r in results if not r["ok"]]
    print(f"{len(results) - len(failed)}/{len(results)} addresses passed; details in {out}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
