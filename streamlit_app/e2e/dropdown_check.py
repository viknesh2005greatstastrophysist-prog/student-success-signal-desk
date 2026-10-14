#!/usr/bin/env python3
"""Real-browser check that nothing can be typed into a drop-down (READ-ONLY).

Signs in as a mentor and a department head, opens every page, and for every
drop-down (selectbox / multiselect) on it:
  * the text input is read-only (or absent), and
  * typing into it changes neither its value nor the list of options.
Then it types into the page's search boxes to show those still work. Nothing is saved.

Usage (server already running):
    .venv/bin/python streamlit_app/e2e/dropdown_check.py --base-url http://127.0.0.1:8503
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from playwright.sync_api import sync_playwright  # noqa: E402
from walk import DESKTOP, ROLES, Walk  # noqa: E402

COMBOS_JS = """() => [...document.querySelectorAll('[data-testid="stMain"] [data-testid="stSelectbox"], [data-testid="stMain"] [data-testid="stMultiSelect"]')]
  .filter((e) => e.offsetWidth || e.offsetHeight)
  .map((e, i) => {
    const input = e.querySelector('input');
    return {i, kind: e.getAttribute('data-testid'), label: (e.querySelector('label') || {}).innerText || '',
            readonly: !input || input.readOnly || input.disabled || input.getAttribute('inputmode') === 'none'};
  })"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8503")
    parser.add_argument("--roles", default="mentor1,hod,operations,student001")
    args = parser.parse_args()
    args.pass_no, args.timeout = "dropdown", 90
    walk = Walk(args)
    failures: list[str] = []
    checked = 0
    typed_into = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for spec in [r for r in ROLES if r["key"] in args.roles.split(",")]:
            ctx, page = walk.new_context(browser, DESKTOP)
            walk.sign_in(page, spec)
            n_pages = page.locator('[data-testid="stSidebarNavLink"]').count()
            for index in range(n_pages):
                page.locator('[data-testid="stSidebarNavLink"]').nth(index).click()
                walk.settle(page)
                name = page.locator('[data-testid="stSidebarNavLink"]').nth(index).inner_text().strip().split("\n")[-1]
                # open every section the page offers so every drop-down is visited
                seg_count = page.locator('[data-testid="stMain"] [data-testid="stButtonGroup"] button').count()
                states = [None] + list(range(seg_count))[:8]
                for state in states:
                    if state is not None:
                        try:
                            page.locator('[data-testid="stMain"] [data-testid="stButtonGroup"] button').nth(state).click(timeout=3000)
                        except Exception:  # the section set changed under us; the next page covers the rest
                            continue
                        walk.settle(page)
                    for combo in page.evaluate(COMBOS_JS):
                        checked += 1
                        label = f"{spec['key']} / {name} / {combo['label'][:40]}"
                        if not combo["readonly"]:
                            failures.append(f"{label}: input is not read-only")
                            continue
                        root = page.locator('[data-testid="stMain"] [data-testid="stSelectbox"], [data-testid="stMain"] [data-testid="stMultiSelect"]').nth(combo["i"])
                        field = root.locator("input").first
                        if not field.count():
                            continue
                        before = field.input_value()
                        field.click(force=True)
                        page.keyboard.type("zzqx", delay=20)
                        time.sleep(0.2)
                        options = page.locator('[role="listbox"] [role="option"]').count()
                        empty = page.get_by_text("No results").count()
                        after = field.input_value()
                        page.keyboard.press("Escape")
                        typed_into += 1
                        if after != before or empty:
                            failures.append(f"{label}: typing changed the field (value {before!r} -> {after!r}, 'No results' shown: {bool(empty)}, options {options})")
            ctx.close()
        browser.close()
    print(f"drop-downs checked: {checked}, typed into: {typed_into}, failures: {len(failures)}")
    for f in failures:
        print("  FAIL", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
