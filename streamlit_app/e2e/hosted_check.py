#!/usr/bin/env python3
"""One student end to end on the HOSTED app (public, Streamlit Community Cloud), through the real UI.

mentor1 opens Today, follows "Next decision" (or an "Also waiting" row) to the gate, approves and publishes the
draft that is already waiting there (drafted earlier by the real agent pipeline on the hosted database), then
the same student and the parent sign in and must see the approved plan. It makes no model call itself.

Student 021 (NAYAN KALAL, 01FE23BCI103, case d398bbc3) is skipped and never touched. Credentials come from the
root .env inside this process only. This WRITES to the hosted database (one approved plan), as the owner
authorised for the final verification; screenshots go to runtime/streamlit-project/e2e/hosted/ (git-ignored).

    .venv/bin/python streamlit_app/e2e/hosted_check.py
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

from playwright.sync_api import sync_playwright  # noqa: E402

import live_run  # noqa: E402
from live_run import Live  # noqa: E402
from walk import ROOT  # noqa: E402

ROOT_URL = "https://aura-college-workspace.streamlit.app/"
APP_URL = ROOT_URL + "~/+/"
PROTECTED_NAME = "NAYAN KALAL"
OUT = ROOT / "runtime" / "streamlit-project" / "e2e" / "hosted"
DECISION = "Claude final verification on the hosted app: figures and actions checked, approved."


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    live_run.OUT = OUT
    live = Live(APP_URL)
    live.walk.out = OUT
    live.walk.args.timeout = 120
    result: dict[str, object] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            # 1. mentor1: Today -> the gate -> approve and publish
            ctx, page = live.open(browser)
            ctx.set_default_timeout(120000)
            try:
                page.goto(ROOT_URL, wait_until="domcontentloaded")  # Streamlit's cookie bootstrap
                page.wait_for_timeout(1500)
                start = time.time()
                live.sign_in(page, live.spec("mentor1", "Mentor", "MENTOR1"))
                result["mentor_sign_in_s"] = round(time.time() - start, 1)
                text = live.main_text(page)
                result["today_next_decision"] = "Next decision" in text
                live.shot(page, "01-hosted-mentor-today", tall=True)
                card = page.locator('[class*="st-key-card_next"]').first
                lines = [ln.strip() for ln in card.inner_text().splitlines() if ln.strip()] if card.count() else []
                name = lines[lines.index("Next decision") + 1] if "Next decision" in lines else ""
                if name.upper() == PROTECTED_NAME:  # never student 021: take the first other waiting row
                    rows = page.get_by_role("button", name=re.compile(r"^Review ")).all()
                    rows = [r for r in rows if PROTECTED_NAME.title() not in r.inner_text() and PROTECTED_NAME not in r.inner_text().upper()]
                    assert rows, "no waiting draft other than student 021"
                    name = re.sub(r"^Review\s+", "", rows[0].inner_text().strip())
                    rows[0].click()
                else:
                    live.button(page, "Review").first.click()
                live.wait(page, 120, 1.0)
                gate = live.main_text(page)
                result["student_chosen"] = name
                result["gate_shown"] = "Approve this plan?" in gate
                assert result["gate_shown"] and PROTECTED_NAME not in gate.upper(), "not at the gate for an allowed student"
                live.shot(page, "02-hosted-gate", tall=True)
                page.get_by_label("Decision rationale", exact=True).fill(DECISION)
                start = time.time()
                live.button(page, "Approve and publish").click()
                live.wait(page, 180, 1.5)
                result["approve_s"] = round(time.time() - start, 1)
                after = live.main_text(page)
                # the success notice is a flash; the lasting proof is that the draft left the queue
                result["decision_saved"] = name.upper() not in after.upper().split("APPROVE THIS PLAN?", 1)[-1][:200]
                live.shot(page, "03-hosted-after-approve", tall=True)
                result["mentor_errors"] = live.errors_on_page(page)
            finally:
                ctx.close()
            # 2. that student's view, then the parent's
            keys = live_run.login_keys_for({"x": name.upper()})
            student_key = keys.get(name.upper())
            assert student_key and student_key != live_run.PROTECTED_ENV, "no student login for the chosen name"
            parent_key = student_key.replace("STUDENT", "PARENT")
            for label, portal, key, heading in (
                ("student", "Student", student_key, "Your support plan"),
                ("parent", "Parent", parent_key, "Approved support plan"),
            ):
                ctx, page = live.open(browser)
                ctx.set_default_timeout(120000)
                try:
                    page.goto(ROOT_URL, wait_until="domcontentloaded")
                    page.wait_for_timeout(1500)
                    live.sign_in(page, live.spec(label, portal, key))
                    text = live.main_text(page)
                    result[f"{label}_sees_plan"] = heading in text
                    result[f"{label}_provenance"] = "Drafted by AI" in text
                    live.shot(page, f"04-hosted-{label}-overview", tall=True)
                    result[f"{label}_errors"] = live.errors_on_page(page)
                finally:
                    ctx.close()
        finally:
            browser.close()
    print(json.dumps(result, indent=2, default=str))
    ok = all(result.get(k) for k in ("gate_shown", "decision_saved", "student_sees_plan", "parent_sees_plan"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
