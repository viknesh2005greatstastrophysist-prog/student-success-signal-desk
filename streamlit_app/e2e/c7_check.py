#!/usr/bin/env python3
"""Live check of C7 (remembered devices, password-manager form, local test accounts).

Run against your own local server (never a shared one):
    .venv/bin/streamlit run streamlit_app/app.py --server.port 8503 --server.headless true \
        --server.address 127.0.0.1 &
    .venv/bin/python streamlit_app/e2e/c7_check.py --base-url http://127.0.0.1:8503

It signs in with the mentor and department-head fixtures from the root .env (inside this
process only; nothing secret is printed, cookie values are never printed). It never
touches student 021. Needs the local Postgres the app uses; zero model calls.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "streamlit_app"))
from bridge import read_environment_file  # noqa: E402

COOKIE = "aura_dev_faculty"
results: list[str] = []


def check(ok: bool, what: str) -> None:
    results.append(("PASS  " if ok else "FAIL  ") + what)
    print(results[-1], flush=True)


def cookie(ctx, name: str) -> dict | None:
    return next((c for c in ctx.cookies() if c["name"] == name), None)


def form_ready(page: Page, timeout: int = 60) -> bool:
    try:
        page.wait_for_selector('[data-testid="stForm"]', timeout=timeout * 1000)
        return True
    except Exception:  # noqa: BLE001
        return False


def signed_in(page: Page, timeout: int = 90) -> bool:
    try:
        page.wait_for_selector('[data-testid="stSidebar"] button:has-text("Sign out")', timeout=timeout * 1000)
        return True
    except Exception:  # noqa: BLE001
        return False


def sign_in(page: Page, workspace: str, email: str, password: str, remember: bool = True) -> None:
    page.get_by_role("radio", name=re.compile(re.escape(workspace))).first.click()
    page.locator("input[aria-label=Email]").fill(email)
    page.locator("input[type=password]").fill(password)
    box = page.get_by_label("Keep me signed in on this device")
    if box.is_checked() != remember:
        box.click(force=True)
    page.get_by_role("button", name="Continue", exact=True).click()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8503")
    args = parser.parse_args()
    env = read_environment_file(ROOT / ".env")
    mentor = env["AURA_LOGIN_MENTOR1_EMAIL"], env["AURA_LOGIN_MENTOR1_PASSWORD"]
    secrets = [v for v in (*mentor, env["AURA_LOGIN_HOD_PASSWORD"]) if v]

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        console_errors: list[str] = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        # 1. Password-manager form and the checkbox.
        page.goto(args.base_url)
        check(form_ready(page), "sign-in form renders")
        check(page.locator("input[aria-label=Email]").get_attribute("autocomplete") == "username", "email field has autocomplete=username")
        check(page.locator("input[type=password]").get_attribute("autocomplete") == "current-password", "password field has autocomplete=current-password")
        check(page.get_by_label("Keep me signed in on this device").is_checked(), "'Keep me signed in on this device' is ticked by default")
        check(page.evaluate("document.querySelector('[data-testid=stForm]').tagName") in {"FORM", "DIV"}, "form element present")
        check(page.get_by_text("Test accounts", exact=True).count() == 1, "Test accounts panel shows on 127.0.0.1")
        check(page.get_by_role("button", name=re.compile(r"021")).count() == 0 and "021" not in page.locator(".st-key-login_local").inner_text(), "no 021 account is offered")
        check(not any(s in page.content() for s in secrets), "no password or fixture email appears in the page")

        # 2. Sign in with the form; the cookie is set with the required attributes.
        sign_in(page, "Mentor", *mentor)
        check(signed_in(page), "form sign-in reaches the mentor workspace")
        deadline = time.time() + 15
        while time.time() < deadline and not cookie(ctx, COOKIE):
            time.sleep(0.3)
        first = cookie(ctx, COOKIE)
        check(first is not None, "device cookie aura_dev_faculty is set")
        if first:
            ttl_days = (first["expires"] - time.time()) / 86400
            check(first["sameSite"] == "Strict" and first["secure"] is True and first["path"] == "/" and not first["httpOnly"], "cookie is Secure, SameSite=Strict, Path=/ (not HttpOnly: set from script)")
            check(6.9 < ttl_days <= 7.01, f"cookie lives 7 days ({ttl_days:.2f})")
            check(len(first["value"]) == 43, "cookie holds a 43-character random token, not a password")
            check(not any(s in first["value"] for s in secrets), "cookie does not contain a password")

        # 3. Reload: no form, straight back in, token rotated.
        page.reload()
        check(signed_in(page), "reload: back in without the form")
        time.sleep(2)
        second = cookie(ctx, COOKIE)
        check(second is not None and first is not None and second["value"] != first["value"], "token rotated on use")

        # 4. New tab: same.
        tab = ctx.new_page()
        tab.goto(args.base_url)
        check(signed_in(tab), "new tab: back in without the form")
        time.sleep(2)
        tab.close()

        # 5. Sign out clears it; a reload shows the form.
        page.locator('[data-testid="stSidebar"] button').filter(has_text="Sign out").first.click()
        check(form_ready(page), "sign out returns to the form")
        deadline = time.time() + 15
        while time.time() < deadline and cookie(ctx, COOKIE):
            time.sleep(0.3)
        check(cookie(ctx, COOKIE) is None, "sign out clears the device cookie")
        page.reload()
        check(form_ready(page) and not signed_in(page, 3), "reload after sign out shows the form")

        # 6. Not remembered when unticked.
        sign_in(page, "Mentor", *mentor, remember=False)
        check(signed_in(page), "sign in with 'keep me signed in' unticked")
        time.sleep(2)
        check(cookie(ctx, COOKIE) is None, "no cookie when unticked")
        page.locator('[data-testid="stSidebar"] button').filter(has_text="Sign out").first.click()
        form_ready(page)

        # 7. Local panel: one click signs in; Switch workspace keeps the device.
        page.reload()
        form_ready(page)
        page.get_by_role("button", name="Department head", exact=True).click()
        check(signed_in(page), "test account button signs in (Department head)")
        page.locator('[data-testid="stSidebar"] button').filter(has_text="Switch workspace").first.click()
        check(form_ready(page), "Switch workspace returns to the sign-in page")
        chip = page.get_by_role("button", name=re.compile(r"Department head"))
        check(chip.count() >= 1 and page.get_by_text("Continue where you left off").count() == 1, "the remembered workspace is offered")
        page.locator(".st-key-login_panel").get_by_role("button", name=re.compile(r"·\s*Department head")).click()
        check(signed_in(page), "remembered workspace opens in one click")
        page.locator('[data-testid="stSidebar"] button').filter(has_text="Sign out").first.click()
        form_ready(page)
        page.reload()
        form_ready(page)
        check(page.get_by_text("Continue where you left off").count() == 0 and not signed_in(page, 3), "after Sign out nothing is remembered for that workspace")

        check(not any("aura_dev" in m for m in console_errors), "no cookie-related console errors")
        browser.close()
    failed = [r for r in results if r.startswith("FAIL")]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
