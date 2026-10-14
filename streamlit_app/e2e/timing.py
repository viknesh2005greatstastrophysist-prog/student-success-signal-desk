#!/usr/bin/env python3
"""Page timing for the AURA Streamlit app (Playwright, headless Chromium, READ-ONLY).

For every role it signs in through the real form and times each sidebar page from the click
(navigation) until Streamlit has finished the rerun and nothing is stale or spinning:

  * first visit: the first time that page is opened in the session (cold read cache),
  * revisit: opening the same page again after visiting the others (warm page switch).

It also counts the engine calls each navigation made, by reading the opt-in request log the
server writes when AURA_REQUEST_LOG is set. Nothing is submitted; no model is called.

Usage (from the repo root; the server must be started with the log path set):
    AURA_REQUEST_LOG=runtime/streamlit-project/e2e/timing-requests.log \
      .venv/bin/streamlit run streamlit_app/app.py --server.port 8503 --server.headless true \
      --server.address 127.0.0.1 &
    .venv/bin/python streamlit_app/e2e/timing.py --label before --base-url http://127.0.0.1:8503

Hosted app (public, in an iframe on *.streamlit.app): add --hosted. The script first opens the site
root once (Streamlit's cookie bootstrap redirect) and then drives the app document itself
(`<root>/~/+/`), so no iframe handling is needed. The engine-call counts are empty there (no
server log); everything else is the same, measured from this machine.

    .venv/bin/python streamlit_app/e2e/timing.py --hosted --label hosted-before --roles mentor1,student001

Output: runtime/streamlit-project/e2e/timing-<label>.json (git-ignored) and a table on stdout.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from playwright.sync_api import Page, sync_playwright  # noqa: E402
from walk import DESKTOP, ROLES, ROOT, Walk  # noqa: E402

DEFAULT_ROLES = "mentor1,hod,operations,student001,parent001,lms-student001"
NAV_JS = r"""
() => {
  const side = document.querySelector('[data-testid="stSidebar"]');
  if (!side) return {kind: 'none', items: []};
  const links = [...side.querySelectorAll('[data-testid="stSidebarNavLink"]')];
  if (links.length) return {kind: 'nav', items: links.map((a) => a.innerText.trim().replace(/\s+/g, ' '))};
  const radios = [...side.querySelectorAll('[data-testid="stRadioOption"]')];
  return {kind: 'radio', items: radios.map((r) => r.innerText.trim().replace(/\s+/g, ' '))};
}
"""
ARM_JS = r"""
() => {
  const app = document.querySelector('[data-testid="stApp"]');
  window.__t = {runs: 0};
  if (window.__tObs) window.__tObs.disconnect();
  window.__tObs = new MutationObserver(() => {
    if (app.getAttribute('data-test-script-state') === 'running') window.__t.runs++;
  });
  window.__tObs.observe(app, {attributes: true, attributeFilter: ['data-test-script-state']});
}
"""
DONE_JS = r"""
() => {
  const app = document.querySelector('[data-testid="stApp"]');
  return window.__t && window.__t.runs > 0
    && app.getAttribute('data-test-script-state') !== 'running'
    && !document.querySelector('[data-testid="stStatusWidget"]')
    && !document.querySelector('[data-stale="true"]')
    && !document.querySelector('[data-testid="stSpinner"]');
}
"""


DONE_JS_IDLE = r"""
() => {
  const app = document.querySelector('[data-testid="stApp"]');
  return app && app.getAttribute('data-test-script-state') !== 'running'
    && !document.querySelector('[data-testid="stStatusWidget"]')
    && !document.querySelector('[data-stale="true"]');
}
"""


def read_log(path: Path) -> list[str]:
    return path.read_text().splitlines() if path.exists() else []


def go(page: Page, kind: str, index: int, log: Path) -> tuple[float, list[str]]:
    """Click navigation item `index`; return (seconds until rendered, engine calls made)."""
    before = len(read_log(log))
    page.evaluate(ARM_JS)
    side = page.locator('[data-testid="stSidebar"]')
    item = side.locator('[data-testid="stSidebarNavLink"]' if kind == "nav" else '[data-testid="stRadioOption"]').nth(index)
    start = time.perf_counter()
    item.click()
    page.wait_for_function(DONE_JS, timeout=90000, polling=15)
    page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
    elapsed = time.perf_counter() - start
    calls = read_log(log)[before:]
    return round(elapsed, 3), calls


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--label", default="run")
    parser.add_argument("--base-url", default="http://127.0.0.1:8503")
    parser.add_argument("--roles", default=DEFAULT_ROLES)
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--log", default="runtime/streamlit-project/e2e/timing-requests.log")
    parser.add_argument("--pass-no", default="timing")
    parser.add_argument("--hosted", action="store_true", help="time the public hosted app (https://aura-college-workspace.streamlit.app)")
    parser.add_argument("--hosted-url", default="https://aura-college-workspace.streamlit.app/")
    args = parser.parse_args()
    args.pass_no = f"timing-{args.label}"
    if args.hosted:
        args.base_url = args.hosted_url.rstrip("/") + "/~/+/"
        args.timeout = max(args.timeout, 120)
    log = ROOT / args.log
    log.parent.mkdir(parents=True, exist_ok=True)
    walk = Walk(args)
    wanted = [r.strip() for r in args.roles.split(",") if r.strip()]
    specs = [r for r in ROLES if r["key"] in wanted]
    results: list[dict[str, Any]] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for spec in specs:
            ctx, page = walk.new_context(browser, DESKTOP)
            record: dict[str, Any] = {"role": spec["key"], "pages": []}
            try:
                if args.hosted:
                    ctx.set_default_timeout(args.timeout * 1000)
                    page.goto(args.hosted_url, wait_until="domcontentloaded")  # cookie bootstrap only
                    page.wait_for_timeout(1500)
                load_start = time.perf_counter()
                page.goto(args.base_url, wait_until="domcontentloaded")
                page.wait_for_selector('[data-testid="stForm"]', timeout=args.timeout * 1000)
                page.wait_for_function(DONE_JS_IDLE, timeout=90000, polling=15)
                record["cold_load_s"] = round(time.perf_counter() - load_start, 3)  # request until the sign-in card is drawn and idle
                walk.choose_portal(page, spec["portal"])
                email, password = walk.creds(spec)
                page.locator("input[aria-label=Email]").fill(email)
                page.locator("input[type=password]").fill(password)
                page.evaluate(ARM_JS)
                mark = len(read_log(log))
                start = time.perf_counter()
                page.get_by_role("button", name="Continue", exact=True).click()
                page.wait_for_selector('[data-testid="stSidebar"]', state="attached", timeout=args.timeout * 1000)
                page.wait_for_function(DONE_JS, timeout=90000, polling=15)
                page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
                record["sign_in_s"] = round(time.perf_counter() - start, 3)
                record["sign_in_calls"] = [c.split("\t")[0] for c in read_log(log)[mark:]]
                nav = page.evaluate(NAV_JS)
                items = nav["items"] or ["(single page)"]
                rows = [{"page": name} for name in items]
                if nav["items"]:
                    # first visit of each page, in order; the landing page was timed by sign-in
                    rows[0].update(first_s=record["sign_in_s"], first_calls=record["sign_in_calls"], first_includes="sign-in")
                    for i in range(1, len(items)):
                        secs, calls = go(page, nav["kind"], i, log)
                        rows[i].update(first_s=secs, first_calls=[c.split("\t")[0] for c in calls])
                    # revisit each page (warm page switch), starting from the last one
                    for i in range(len(items)):
                        secs, calls = go(page, nav["kind"], i, log)
                        rows[i].update(revisit_s=secs, revisit_calls=[c.split("\t")[0] for c in calls])
                else:
                    rows[0].update(first_s=record["sign_in_s"], first_calls=record["sign_in_calls"], first_includes="sign-in")
                record["pages"] = rows
                walk.sign_out(page)
            except Exception as error:  # keep timing the other roles
                record["error"] = walk.scrub(str(error))[:300]
            finally:
                ctx.close()
            results.append(record)
            print(f"== {spec['key']}: load {record.get('cold_load_s')}s, sign-in {record.get('sign_in_s')}s", flush=True)
            for row in record["pages"]:
                print(
                    f"   {row['page'][:34]:34} first {row.get('first_s', '-')}s ({len(row.get('first_calls', []))} calls)"
                    f"  revisit {row.get('revisit_s', '-')}s ({len(row.get('revisit_calls', []))} calls)",
                    flush=True,
                )
        browser.close()
    first = [r["first_s"] for rec in results for r in rec["pages"] if "first_s" in r and r.get("first_includes") != "sign-in"]
    revisit = [r["revisit_s"] for rec in results for r in rec["pages"] if "revisit_s" in r]
    summary = {
        "label": args.label,
        "base_url": args.base_url,
        "first_visit": {"n": len(first), "median": statistics.median(first) if first else None, "max": max(first) if first else None},
        "revisit": {"n": len(revisit), "median": statistics.median(revisit) if revisit else None, "max": max(revisit) if revisit else None},
        "sign_in": {rec["role"]: rec.get("sign_in_s") for rec in results},
        "cold_load": {rec["role"]: rec.get("cold_load_s") for rec in results},
        "roles": results,
    }
    out = ROOT / "runtime" / "streamlit-project" / "e2e" / f"timing-{args.label}.json"
    out.write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({k: summary[k] for k in ("first_visit", "revisit", "sign_in", "cold_load")}, indent=2))
    print(f"wrote {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
