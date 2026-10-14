#!/usr/bin/env python3
"""Repeatable, READ-ONLY end-to-end walk of the AURA Streamlit app (Playwright, headless Chromium).

For every role it signs in through the real form, visits every sidebar page, clicks every tab
(nested tabs too), opens every expander, flips read-only selectors (selectbox, radio, segmented
control, toggle, checkbox) to a couple of other options, and records on every view:

  * Streamlit exceptions and error alerts, browser console errors, failed requests
  * horizontal overflow (page and main area) and ellipsis-truncated text
  * raw technical strings in the UI (snake_case, None/nan/undefined, ISO timestamps, UUIDs, ...)
  * empty states, broken charts/images, page load time
  * a 1280x900 desktop screenshot per page and tab (plus a tall capture), and a 390x844 mobile
    screenshot of each role's home page

Safety: it never submits a form and never clicks a button other than the allow-list below
(sign-in, sign-out, "View receipt"). Anything inside a Streamlit form is left alone, so nothing
that approves, saves, records, runs a plan or calls a model is triggered. Credentials are read
from the root .env (AURA_LOGIN_<ROLE>_EMAIL / _PASSWORD) inside this process only and are
scrubbed from anything written to disk or printed. Student 021 is refused.

Usage (from the repo root, with a server already running):
    .venv/bin/streamlit run streamlit_app/app.py --server.port 8503 --server.headless true \
        --server.address 127.0.0.1 &
    .venv/bin/python streamlit_app/e2e/walk.py --pass 1 --base-url http://127.0.0.1:8503
    .venv/bin/python streamlit_app/e2e/walk.py --pass 2 --roles mentor1,hod   # a subset

Output: runtime/streamlit-project/e2e/pass<N>/ (git-ignored): PNGs, summary.json, issues.txt.
Setup once: uv pip install --python .venv/bin/python playwright && .venv/bin/python -m playwright install chromium
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright
from playwright.sync_api import Error as PlaywrightError

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = {"width": 1280, "height": 900}
MOBILE = {"width": 390, "height": 844}

# (key, workspace label shown on the sign-in page, .env prefix). Order matters: the student
# runs before the parent so the parent walk can confirm it shows the same child.
ROLES: list[dict[str, str]] = [
    {"key": "mentor1", "portal": "Mentor", "env": "MENTOR1"},
    {"key": "mentor2", "portal": "Mentor", "env": "MENTOR2"},
    {"key": "hod", "portal": "Department head", "env": "HOD"},
    {"key": "hod-ai-activity", "portal": "AI activity", "env": "HOD"},
    {"key": "operations", "portal": "AI activity", "env": "OPERATIONS"},
    {"key": "student001", "portal": "Student", "env": "STUDENT001"},
    {"key": "parent001", "portal": "Parent", "env": "PARENT001"},
    {"key": "lms-student001", "portal": "Learning (LMS)", "env": "STUDENT001"},
    {"key": "lms-mentor1", "portal": "Learning (LMS)", "env": "MENTOR1"},
]
FORBIDDEN_ENV = ("STUDENT021",)  # never sign in as, or touch, student 021
ALLOWED_BUTTONS = ("Sign in", "Sign out", "View receipt")
RISKY_LABEL = re.compile(
    r"approve|decline|save|record|submit|lock|run |delete|send|publish|restore|attest|confirm|generate|draft it",
    re.I,
)

LEAK_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("snake_case", re.compile(r"\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b")),
    ("raw_null", re.compile(r"\b(?:None|nan|NaN|NaT|null|undefined|Infinity)\b")),
    ("object_object", re.compile(r"\[object Object\]")),
    ("python_bool", re.compile(r"\b(?:True|False)\b")),
    (
        "iso_timestamp",
        re.compile(r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b"),
    ),
    ("iso_date", re.compile(r"\b\d{4}-\d{2}-\d{2}\b")),
    ("uuid", re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")),
    ("material_icon_text", re.compile(r":material/[a-z0-9_]+:?")),
    ("camelCase", re.compile(r"\b[a-z]+(?:[A-Z][a-z0-9]+)+\b")),
    ("python_repr", re.compile(r"\{'|<class |datetime\.|Decimal\(|\bTraceback\b")),
    ("empty_brackets", re.compile(r"\(\s*\)|\[\s*\]|\{\s*\}")),
    ("double_separator", re.compile(r"·\s*·|—\s*—|,\s*,|\s·\s*$")),
]
STRIP_BEFORE_SCAN = re.compile(r"\S+@\S+|https?://\S+")
EMPTY_STATE = re.compile(
    r"^(no |nothing |there (is|are) no |not (recorded|available|yet)|none |no records)", re.I
)

# Helpers injected into every page. Icons (Material ligatures) are stripped from text so that
# only what a person reads is scanned.
INIT_JS = r"""
(() => {
  const ICON = '[translate="no"], [data-testid="stIconMaterial"], [data-testid="stExpanderIcon"]';
  const SKIP = 'code, pre, script, style, svg, canvas, [data-testid="stCodeBlock"], [data-testid="stJson"]';
  const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const clean = (el) => {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll(ICON).forEach((n) => n.remove());
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const ctxOf = (node) => {
    const ex = node.closest('[data-testid="stExpander"]');
    if (!ex) return '';
    const s = ex.querySelector('summary');
    return 'expander:' + (s ? clean(s).slice(0, 60) : '');
  };
  function textsOf(root, area) {
    const out = [];
    if (!root) return out;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n = 0;
    while (walker.nextNode() && n < 8000) {
      const node = walker.currentNode;
      const p = node.parentElement;
      if (!p) continue;
      const t = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (p.closest(ICON) || p.closest(SKIP) || !visible(p)) continue;
      out.push({ t, c: ctxOf(p), a: area });
      n++;
    }
    return out;
  }
  window.__e2e = {
    clean, visible,
    collect() {
      const main = document.querySelector('[data-testid="stMain"]');
      const side = document.querySelector('[data-testid="stSidebar"]');
      const iw = window.innerWidth;
      const texts = textsOf(main, 'main').concat(textsOf(side, 'sidebar'));
      // dataframes render on a canvas; their accessible grid holds the visible cells
      const dataframes = [];
      document.querySelectorAll('[data-testid="stDataFrame"]').forEach((d) => {
        const t = d.querySelector('table[role="grid"]');
        if (!t) return;
        const headers = [...t.querySelectorAll('th')].map((h) => clean(h));
        const cells = [...t.querySelectorAll('td')].map((c) => clean(c));
        dataframes.push({
          headers, rows: Math.max(0, parseInt(t.getAttribute('aria-rowcount') || '1') - 1),
          cols: parseInt(t.getAttribute('aria-colcount') || '0'), sample: cells.slice(0, 60),
        });
        headers.forEach((h) => texts.push({ t: h, c: 'df-header', a: 'main' }));
        cells.forEach((c) => c && texts.push({ t: c, c: 'df-cell:' + (headers[0] || ''), a: 'main' }));
      });
      document.querySelectorAll('[data-testid="stSelectbox"] input[role="combobox"]').forEach((i) => {
        if (i.value) texts.push({ t: i.value, c: 'selectbox-value', a: 'main' });
      });
      const alerts = [];
      document.querySelectorAll('[data-testid="stAlert"]').forEach((a) => {
        const k = a.querySelector('[data-testid^="stAlertContent"]');
        const kind = (k ? k.getAttribute('data-testid') : 'stAlertContentUnknown').replace('stAlertContent', '').toLowerCase();
        alerts.push({ kind, text: clean(a).slice(0, 400) });
      });
      document.querySelectorAll('[data-testid="stToast"]').forEach((a) => alerts.push({ kind: 'toast', text: clean(a).slice(0, 300) }));
      const exceptions = [...document.querySelectorAll('[data-testid="stException"]')].map((e) => clean(e).slice(0, 500));
      // horizontal overflow
      const offenders = [];
      if (main) {
        for (const el of main.querySelectorAll('*')) {
          if (offenders.length >= 5) break;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= iw + 1 || !visible(el)) continue;
          if (el.closest('[data-testid="stDataFrame"], pre, code, [data-testid="stSidebar"]')) continue;
          offenders.push({ tag: el.tagName.toLowerCase(), testid: el.getAttribute('data-testid') || '', right: Math.round(r.right), text: clean(el).slice(0, 60) });
        }
      }
      const de = document.documentElement;
      const overflow = {
        docScrollWidth: de.scrollWidth, innerWidth: iw,
        mainScrollWidth: main ? main.scrollWidth : 0, mainClientWidth: main ? main.clientWidth : 0,
        horizontal: de.scrollWidth > iw || (main ? main.scrollWidth > main.clientWidth + 1 : false),
        offenders,
      };
      const truncated = [];
      if (main) {
        for (const el of main.querySelectorAll('*')) {
          if (truncated.length >= 12) break;
          if (el.scrollWidth > el.clientWidth + 1 && visible(el) && getComputedStyle(el).textOverflow === 'ellipsis') {
            const t = clean(el).slice(0, 90);
            if (t) truncated.push(t);
          }
        }
      }
      const charts = [...document.querySelectorAll('[data-testid="stVegaLiteChart"], [data-testid="stArrowVegaLiteChart"], [data-testid="stGraphVizChart"]')].map((c) => {
        const r = c.getBoundingClientRect();
        return { kind: c.getAttribute('data-testid'), w: Math.round(r.width), h: Math.round(r.height), drawn: !!c.querySelector('canvas, svg') };
      });
      const brokenImages = [...(main ? main.querySelectorAll('img') : [])].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.src.slice(0, 80));
      const metrics = [...document.querySelectorAll('[data-testid="stMetric"]')].map((m) => ({
        label: clean(m.querySelector('[data-testid="stMetricLabel"]')), value: clean(m.querySelector('[data-testid="stMetricValue"]')),
      }));
      const headings = [...(main ? main.querySelectorAll('h1, h2, h3') : [])].filter(visible).map((h) => clean(h)).slice(0, 12);
      return {
        texts, dataframes, alerts, exceptions, overflow, truncated, charts, brokenImages, metrics, headings,
        scrollHeight: main ? main.scrollHeight : 0,
        sidebarPages: side ? [...side.querySelectorAll('[data-testid="stRadioOption"]')].map((o) => clean(o)) : [],
      };
    },
    mark(panelId) {
      // tag read-only controls outside forms and the sidebar so Python can address them;
      // only those that belong directly to the given tab panel ('' = the page itself)
      // drop tags left by an earlier call (another tab panel or page state): a stale
      // data-e2e="select-0" on a hidden element would otherwise win `.first` and time out
      document.querySelectorAll('[data-e2e]').forEach((el) => el.removeAttribute('data-e2e'));
      const own = (el) => { const p = el.closest('[role="tabpanel"]'); return (p ? p.id : '') === (panelId || ''); };
      // a control inside a collapsed expander (details:not([open])) is in the DOM but cannot be driven
      const ok = (el) => !el.closest('[data-testid="stForm"], [data-testid="stSidebar"], details:not([open])') && visible(el) && own(el);
      const out = [];
      const add = (sel, kind, mapper) => {
        let n = 0;
        document.querySelectorAll('[data-testid="stMain"] ' + sel).forEach((el) => {
          if (!ok(el)) return;
          const id = kind + '-' + n++;
          el.setAttribute('data-e2e', id);
          out.push({ id, kind, label: clean(el.querySelector('label, [data-testid="stWidgetLabel"]')).slice(0, 80), ...(mapper ? mapper(el) : {}) });
        });
      };
      add('[data-testid="stSelectbox"]', 'select');
      add('[data-testid="stRadio"]', 'radio', (el) => ({ n: el.querySelectorAll('[data-testid="stRadioOption"]').length }));
      add('[data-testid="stButtonGroup"]', 'seg', (el) => ({ n: el.querySelectorAll('button').length }));
      add('[data-testid="stToggle"]', 'toggle');
      add('[data-testid="stCheckbox"]', 'toggle');
      return out;
    },
    expanders(panelId) {
      const own = (el) => { const p = el.closest('[role="tabpanel"]'); return (p ? p.id : '') === (panelId || ''); };
      return [...document.querySelectorAll('[data-testid="stMain"] [data-testid="stExpander"] > details')]
        .map((d, i) => ({ i, d }))
        .filter(({ d }) => visible(d) && own(d) && !d.closest('[data-testid="stForm"]'))
        .map(({ i, d }) => ({ i, open: d.open, title: clean(d.querySelector('summary')).slice(0, 70) }));
    },
    tablists() {
      return [...document.querySelectorAll('[data-testid="stMain"] [role="tablist"]')].map((t, i) => {
        const panel = t.closest('[role="tabpanel"]');
        return { index: i, visible: visible(t), parentPanel: panel ? panel.id : '', labels: [...t.querySelectorAll('[role="tab"]')].map((x) => clean(x)) };
      });
    },
  };
})();
"""


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    path = ROOT / ".env"
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw = line.split("=", 1)
        key = key.replace("export ", "").strip()
        if key.startswith("AURA_LOGIN_"):
            values[key] = raw.strip().strip('"').strip("'")
    return values


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48] or "x"


class Walk:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.env = load_env()
        self.out = ROOT / "runtime" / "streamlit-project" / "e2e" / f"pass{args.pass_no}"
        self.out.mkdir(parents=True, exist_ok=True)
        self.secrets = [v for k, v in self.env.items() if v and (k.endswith("_PASSWORD") or k.endswith("_EMAIL"))]
        self.events: list[dict[str, str]] = []
        self.names: dict[str, str] = {}
        self.shots = 0

    # ------------------------------------------------------------------ safety
    def scrub(self, text: str) -> str:
        for secret in self.secrets:
            if secret and secret in text:
                text = text.replace(secret, "***")
        return text

    def creds(self, spec: dict[str, str]) -> tuple[str, str]:
        if spec["env"] in FORBIDDEN_ENV:
            raise SystemExit("refusing to sign in as student 021")
        email = self.env.get(f"AURA_LOGIN_{spec['env']}_EMAIL")
        password = self.env.get(f"AURA_LOGIN_{spec['env']}_PASSWORD")
        if not email or not password:
            raise SystemExit(f"missing AURA_LOGIN_{spec['env']}_EMAIL/_PASSWORD in .env")
        return email, password

    # ------------------------------------------------------------------ browser plumbing
    def new_context(self, browser: Browser, viewport: dict[str, int], mobile: bool = False) -> tuple[BrowserContext, Page]:
        ctx = browser.new_context(
            viewport=viewport, device_scale_factor=1, is_mobile=mobile, has_touch=mobile, reduced_motion="reduce"
        )
        ctx.add_init_script(INIT_JS)
        ctx.set_default_timeout(15000)
        page = ctx.new_page()
        page.on("console", lambda m: self.events.append({"type": "console", "text": self.scrub(m.text)[:300]}) if m.type == "error" else None)
        page.on("pageerror", lambda e: self.events.append({"type": "pageerror", "text": self.scrub(str(e))[:300]}))
        page.on("requestfailed", lambda r: self.events.append({"type": "requestfailed", "text": f"{r.method} {r.url.split('?')[0]} {r.failure}"[:300]}))
        page.on(
            "response",
            lambda r: self.events.append({"type": "http", "text": f"{r.status} {r.request.method} {r.url.split('?')[0]}"[:300]})
            if r.status >= 400
            else None,
        )
        return ctx, page

    def drain(self) -> list[dict[str, str]]:
        events, self.events = self.events, []
        seen: set[tuple[str, str]] = set()
        unique = []
        for e in events:
            k = (e["type"], e["text"])
            if k not in seen:
                seen.add(k)
                unique.append(e)
        return unique

    def settle(self, page: Page, grace: float = 0.35, quiet: float = 0.5) -> float:
        """Wait until Streamlit has finished its rerun; returns elapsed seconds."""
        start = time.time()
        time.sleep(grace)
        calm_since: float | None = None
        while time.time() - start < self.args.timeout:
            busy = page.evaluate(
                """() => {
                  const app = document.querySelector('[data-testid="stApp"]');
                  return (app && app.getAttribute('data-test-script-state') === 'running')
                    || !!document.querySelector('[data-testid="stStatusWidget"]')
                    || !!document.querySelector('[data-stale="true"]');
                }"""
            )
            now = time.time()
            if busy:
                calm_since = None
            elif calm_since is None:
                calm_since = now
            elif now - calm_since >= quiet:
                return round(now - start - grace - quiet, 2)
            time.sleep(0.15)
        return round(time.time() - start, 2)

    # ------------------------------------------------------------------ sign in / out
    def open_login(self, page: Page) -> None:
        page.goto(self.args.base_url, wait_until="domcontentloaded")
        page.wait_for_selector('[data-testid="stForm"]', timeout=self.args.timeout * 1000)
        self.settle(page)

    def choose_portal(self, page: Page, portal: str) -> None:
        page.get_by_role("radio", name=re.compile(re.escape(portal))).first.click()
        time.sleep(0.4)

    def sign_in(self, page: Page, spec: dict[str, str]) -> float:
        email, password = self.creds(spec)
        try:
            self.open_login(page)
            self.choose_portal(page, spec["portal"])
            page.locator("input[aria-label=Email]").fill(email)
            page.locator("input[type=password]").fill(password)
            start = time.time()
            page.get_by_role("button", name="Sign in", exact=True).click()
            page.wait_for_selector('[data-testid="stSidebar"]', state="attached", timeout=self.args.timeout * 1000)  # collapsed on phones (#19)
            self.settle(page)
            return round(time.time() - start, 2)
        except PlaywrightError as error:
            raise RuntimeError(f"sign-in failed for {spec['key']}: {self.scrub(str(error))[:200]}") from None

    def sign_out(self, page: Page) -> bool:
        try:
            page.locator('[data-testid="stSidebar"] button').filter(has_text="Sign out").first.click()
            page.wait_for_selector('[data-testid="stForm"]', timeout=30000)
            return True
        except PlaywrightError:
            return False

    # ------------------------------------------------------------------ inspection
    def scan_text(self, texts: list[dict[str, str]]) -> tuple[list[dict[str, str]], list[str]]:
        leaks: list[dict[str, str]] = []
        empties: list[str] = []
        seen: set[tuple[str, str]] = set()
        for item in texts:
            text = item["t"]
            if len(text) <= 200 and EMPTY_STATE.match(text) and text not in empties:
                empties.append(text)
            scanned = STRIP_BEFORE_SCAN.sub(" ", text)
            for kind, pattern in LEAK_PATTERNS:
                for match in pattern.finditer(scanned):
                    key = (kind, match.group(0))
                    if key in seen:
                        continue
                    seen.add(key)
                    start = max(0, match.start() - 40)
                    leaks.append(
                        {
                            "kind": kind,
                            "match": match.group(0),
                            "context": scanned[start : match.end() + 40],
                            "where": item.get("c") or item.get("a", ""),
                        }
                    )
        return leaks, empties

    def screenshot(self, page: Page, name: str, *, tall: bool = False) -> str:
        path = self.out / f"{name}.png"
        if tall:
            height = page.evaluate("() => (document.querySelector('[data-testid=\"stMain\"]') || document.body).scrollHeight")
            target = min(max(int(height) + 40, DESKTOP["height"]), self.args.full_cap)
            if target <= DESKTOP["height"] + 60:
                return ""
            page.set_viewport_size({"width": DESKTOP["width"], "height": target})
            time.sleep(0.6)
            page.screenshot(path=str(path))
            page.set_viewport_size(DESKTOP)
            time.sleep(0.4)
        else:
            page.screenshot(path=str(path))
        self.shots += 1
        return str(path.relative_to(ROOT))

    def inspect(
        self,
        page: Page,
        role: str,
        label: str,
        *,
        kind: str,
        load_s: float | None,
        shot: str | None,
        tall: bool = False,
        extra_texts: list[str] | None = None,
    ) -> dict[str, Any]:
        data = page.evaluate("() => window.__e2e.collect()")
        texts = data.pop("texts")
        for option in extra_texts or []:
            texts.append({"t": option, "c": "dropdown-option", "a": "main"})
        leaks, empties = self.scan_text(texts)
        events = self.drain()
        view: dict[str, Any] = {
            "role": role,
            "label": label,
            "kind": kind,
            "load_s": load_s,
            "headings": data["headings"],
            "exceptions": data["exceptions"],
            "alerts": data["alerts"],
            "error_alerts": [a for a in data["alerts"] if a["kind"] == "error"],
            "console": [e for e in events if e["type"] in ("console", "pageerror")],
            "network": [e for e in events if e["type"] in ("http", "requestfailed")],
            "overflow": data["overflow"],
            "truncated": data["truncated"],
            "leaks": leaks,
            "empty_states": empties,
            "charts": data["charts"],
            "broken_images": data["brokenImages"],
            "dataframes": [{"headers": d["headers"], "rows": d["rows"], "cols": d["cols"]} for d in data["dataframes"]],
            "metrics": data["metrics"],
            "scroll_height": data["scrollHeight"],
            "text_nodes": len(texts),
            "screenshot": "",
            "screenshot_full": "",
        }
        if shot:
            view["screenshot"] = self.screenshot(page, shot)
            if tall:
                view["screenshot_full"] = self.screenshot(page, shot + "__full", tall=True)
        flags = []
        if view["exceptions"]:
            flags.append(f"EXC={len(view['exceptions'])}")
        if view["error_alerts"]:
            flags.append(f"ERR={len(view['error_alerts'])}")
        if view["console"]:
            flags.append(f"CON={len(view['console'])}")
        if view["overflow"]["horizontal"]:
            flags.append("OVERFLOW")
        if leaks:
            flags.append(f"LEAK={len(leaks)}")
        if view["truncated"]:
            flags.append(f"TRUNC={len(view['truncated'])}")
        print(f"    [{role}] {label} ({load_s if load_s is not None else '-'}s) {' '.join(flags)}", flush=True)
        return view

    # ------------------------------------------------------------------ exploring one state
    def open_expanders(self, page: Page, panel_id: str = "") -> int:
        opened = 0
        for _ in range(3):
            try:
                items = page.evaluate("(p) => window.__e2e.expanders(p)", panel_id)
                closed = [e["i"] for e in items if not e["open"]]
                if not closed or opened >= self.args.max_expanders:
                    break
                for index in closed[: self.args.max_expanders - opened]:
                    page.locator('[data-testid="stMain"] [data-testid="stExpander"] > details').nth(index).locator("summary").first.click(timeout=5000)
                    opened += 1
                time.sleep(0.4)
            except PlaywrightError:
                break
        return opened

    def close_expanders(self, page: Page, panel_id: str = "") -> None:
        for _ in range(2):
            try:
                items = page.evaluate("(p) => window.__e2e.expanders(p)", panel_id)
                for e in reversed(items):  # inner expanders first
                    if e["open"]:
                        page.locator('[data-testid="stMain"] [data-testid="stExpander"] > details').nth(e["i"]).locator("summary").first.click(timeout=5000)
                time.sleep(0.2)
            except PlaywrightError:
                break

    def run_controls(self, page: Page, role: str, path: str, shot_base: str, views: list[dict[str, Any]], panel_id: str = "") -> None:
        try:
            controls = page.evaluate("(p) => window.__e2e.mark(p)", panel_id)
        except PlaywrightError:
            return
        seen: dict[tuple[str, str], int] = {}
        for control in controls[: self.args.max_controls]:
            key = (control["kind"], control.get("label") or "")
            control["panel"] = panel_id
            control["ordinal"] = seen.get(key, 0)
            seen[key] = control["ordinal"] + 1
            label = control.get("label") or control["kind"]
            if RISKY_LABEL.search(label):
                continue
            try:
                self.run_control(page, role, path, shot_base, control, label, views)
            except PlaywrightError as error:
                views.append({"role": role, "label": f"{path} › {label}", "kind": "walk-error", "error": self.scrub(str(error))[:240]})
                self.drain()
                page.keyboard.press("Escape")

    def resolve(self, page: Page, control: dict[str, Any]) -> str | None:
        """Re-tag the controls; return a selector for the same one (kind + label + ordinal), or None if it went away."""
        wanted = control.get("label") or ""
        matches = [c for c in page.evaluate("(p) => window.__e2e.mark(p)", control.get("panel", "")) if c["kind"] == control["kind"] and (c.get("label") or "") == wanted]
        ordinal = control.get("ordinal", 0)
        return f'[data-e2e="{matches[ordinal]["id"]}"]' if len(matches) > ordinal else None

    def open_select(self, page: Page, sel: str) -> list[str]:
        """Open a selectbox popover with the keyboard (a click does not reopen an already focused combobox)."""
        combo = page.locator(sel).first.locator('input[role="combobox"]')
        page.keyboard.press("Escape")
        combo.focus()
        for attempt in ("ArrowDown", "click"):
            combo.press("ArrowDown") if attempt == "ArrowDown" else combo.click()
            try:
                page.wait_for_selector('[role="listbox"] [role="option"]', timeout=3500)
                break
            except PlaywrightError:
                continue
        else:
            raise PlaywrightError("selectbox did not open")
        # the list is virtualised: only the rendered options are visible here
        return [o.strip() for o in page.locator('[role="listbox"] [role="option"]').all_inner_texts()]

    def run_control(self, page: Page, role: str, path: str, shot_base: str, control: dict[str, Any], label: str, views: list[dict[str, Any]]) -> None:
        shot = f"{shot_base}__{slug(label)}" if self.args.shots == "all" else None
        sel = self.resolve(page, control)
        if not sel:
            return
        if control["kind"] == "select":
            before = page.locator(sel).first.locator('input[role="combobox"]').input_value()
            options = self.open_select(page, sel)
            targets = [i for i, o in enumerate(options) if o and o != before][: self.args.options]
            options_view = self.inspect(page, role, f"{path} › {label} [options shown: {len(options)}]", kind="dropdown", load_s=None, shot=None, extra_texts=options[:80])
            options_view["options_rendered"] = len(options)
            options_view["options_sample"] = options[:8]
            views.append(options_view)
            page.keyboard.press("Escape")
            time.sleep(0.2)
            for index in targets:
                sel = self.resolve(page, control)
                if not sel:
                    return
                self.open_select(page, sel)
                chosen = page.locator('[role="listbox"] [role="option"]').nth(index)
                name = (chosen.inner_text() or "").strip()
                chosen.click()
                load = self.settle(page)
                views.append(self.inspect(page, role, f"{path} › {label} = {name[:50]}", kind="control", load_s=load, shot=shot))
            if targets:  # put the original choice back so later checks see the default state
                sel = self.resolve(page, control)
                if sel:
                    texts = self.open_select(page, sel)
                    if before not in texts and before:
                        page.locator(sel).first.locator('input[role="combobox"]').fill(before)
                        time.sleep(0.5)
                        texts = [o.strip() for o in page.locator('[role="listbox"] [role="option"]').all_inner_texts()]
                    page.locator('[role="listbox"] [role="option"]').nth(texts.index(before) if before in texts else 0).click()
                    self.settle(page)
                    self.drain()
        elif control["kind"] in ("radio", "seg"):
            item = '[data-testid="stRadioOption"]' if control["kind"] == "radio" else "button"
            n = int(control.get("n", 0))
            indices = list(range(1, min(n, self.args.options + 1))) if control["kind"] == "radio" else list(range(n))
            for index in indices:
                sel = self.resolve(page, control)
                if not sel:
                    return
                option = page.locator(sel).first.locator(item).nth(index)
                name = option.inner_text().strip()
                option.click()
                load = self.settle(page)
                views.append(self.inspect(page, role, f"{path} › {label} = {name[:50]}", kind="control", load_s=load, shot=shot))
            sel = self.resolve(page, control)
            if sel and indices and control["kind"] == "radio":
                page.locator(sel).first.locator(item).first.click()
                self.settle(page)
                self.drain()
        elif control["kind"] == "toggle":
            page.locator(sel).first.locator("label").first.click()
            load = self.settle(page)
            views.append(self.inspect(page, role, f"{path} › {label} (toggled)", kind="control", load_s=load, shot=shot))
            sel = self.resolve(page, control)
            if sel:
                page.locator(sel).first.locator("label").first.click()
                self.settle(page)
                self.drain()

    def explore_state(self, page: Page, role: str, path: str, shot_base: str, views: list[dict[str, Any]], depth: int, panel_id: str = "") -> None:
        """Expanders, controls, then every tab (recursively) of the current page state."""
        opened = self.open_expanders(page, panel_id)
        if opened:
            views.append(
                self.inspect(page, role, f"{path} › expanders open ({opened})", kind="expanders", load_s=None, shot=f"{shot_base}__expanded" if self.args.shots != "page" else None)
            )
            self.close_expanders(page, panel_id)
        self.run_controls(page, role, path, shot_base, views, panel_id)
        if depth >= 3:
            return
        tablists = [t for t in page.evaluate("() => window.__e2e.tablists()") if t["visible"] and t["parentPanel"] == panel_id]
        for tablist in tablists:
            for index, tab_label in enumerate(tablist["labels"]):
                tab_path = f"{path} › {tab_label}"
                tab = page.locator('[data-testid="stMain"] [role="tablist"]').nth(tablist["index"]).locator('[role="tab"]').nth(index)
                try:
                    tab.click(timeout=10000)
                    load = self.settle(page, grace=0.25, quiet=0.35)
                    controls_id = tab.get_attribute("aria-controls") or ""
                except PlaywrightError as error:
                    views.append({"role": role, "label": tab_path, "kind": "walk-error", "error": self.scrub(str(error))[:240]})
                    continue
                shot = f"{shot_base}__tab-{slug(tab_label)}" if self.args.shots != "page" else None
                views.append(self.inspect(page, role, tab_path, kind="tab", load_s=load, shot=shot, tall=bool(shot)))
                self.explore_state(page, role, tab_path, f"{shot_base}__tab-{slug(tab_label)}", views, depth + 1, controls_id)
            # leave the first tab selected so the next check starts from the default state
            if tablist["labels"]:
                try:
                    page.locator('[data-testid="stMain"] [role="tablist"]').nth(tablist["index"]).locator('[role="tab"]').first.click(timeout=5000)
                    self.settle(page, grace=0.2, quiet=0.3)
                    self.drain()
                except PlaywrightError:
                    pass

    # ------------------------------------------------------------------ one role
    def walk_role(self, browser: Browser, spec: dict[str, str]) -> dict[str, Any]:
        role = spec["key"]
        print(f"== {role} ({spec['portal']})", flush=True)
        result: dict[str, Any] = {"role": role, "portal": spec["portal"], "views": [], "errors": []}
        ctx, page = self.new_context(browser, DESKTOP)
        started = time.time()
        try:
            login_s = self.sign_in(page, spec)
            result["sign_in_s"] = login_s
            identity = page.evaluate(
                "() => { const s = document.querySelector('[data-testid=\"stSidebar\"]'); return s ? window.__e2e.clean(s) : ''; }"
            )
            result["sidebar_identity"] = identity[:200]
            pages = page.evaluate("() => window.__e2e.collect().sidebarPages")
            result["pages"] = pages or ["(single page)"]
            self.drain()
            for index, name in enumerate(result["pages"]):
                load = login_s if index == 0 else None
                if index > 0:
                    page.locator('[data-testid="stSidebar"] [data-testid="stRadioOption"]').nth(index).click()
                    load = self.settle(page)
                base = f"{role}__{index + 1:02d}-{slug(name)}"
                try:
                    result["views"].append(self.inspect(page, role, name, kind="page", load_s=load, shot=base, tall=True))
                    self.explore_state(page, role, name, base, result["views"], 0)
                except PlaywrightError as error:
                    result["errors"].append(f"{name}: {self.scrub(str(error))[:240]}")
            if role == "student001" and result["views"]:
                result["student_name"] = (identity.split(" ")[0:3])
            result["sign_out_ok"] = self.sign_out(page)
        except Exception as error:  # keep walking other roles
            result["errors"].append(self.scrub(str(error))[:300])
        finally:
            result["elapsed_s"] = round(time.time() - started, 1)
            ctx.close()
        return result

    def mobile_home(self, browser: Browser, spec: dict[str, str]) -> dict[str, Any]:
        role = spec["key"]
        ctx, page = self.new_context(browser, MOBILE, mobile=True)
        record: dict[str, Any] = {"role": role}
        try:
            self.sign_in(page, spec)
            self.drain()
            time.sleep(0.8)
            data = page.evaluate("() => window.__e2e.collect()")
            record["overflow"] = data["overflow"]
            record["truncated"] = data["truncated"]
            record["exceptions"] = data["exceptions"]
            record["screenshot"] = self.screenshot(page, f"{role}__mobile-home")
            record["scroll_height"] = data["scrollHeight"]
            # the sidebar opens as a drawer over the page on a phone; collapse it with its own
            # button so the content underneath can be reviewed too (the landing shot above stays as is)
            record["sidebar_open_on_landing"] = bool(page.evaluate(
                "() => { const s = document.querySelector('[data-testid=\"stSidebar\"]'); return !!s && s.getBoundingClientRect().width > 100 && s.getBoundingClientRect().right > 100; }"
            ))
            collapse = page.locator('[data-testid="stSidebarCollapseButton"] button, [data-testid="stSidebarCollapseButton"]').first
            if record["sidebar_open_on_landing"] and collapse.count():
                collapse.click(timeout=5000)
                time.sleep(0.8)
            height = page.evaluate("() => (document.querySelector('[data-testid=\"stMain\"]') || document.body).scrollHeight")
            page.set_viewport_size({"width": MOBILE["width"], "height": min(max(int(height) + 40, MOBILE["height"]), self.args.full_cap)})
            time.sleep(0.6)
            content = self.out / f"{role}__mobile-content.png"
            page.screenshot(path=str(content))
            self.shots += 1
            record["screenshot_content"] = str(content.relative_to(ROOT))
            after = page.evaluate("() => window.__e2e.collect()")
            record["content_overflow"] = after["overflow"]
            record["content_truncated"] = after["truncated"]
        except Exception as error:
            record["error"] = self.scrub(str(error))[:300]
        finally:
            ctx.close()
        return record

    # ------------------------------------------------------------------ sign-in page checks
    def login_checks(self, browser: Browser) -> dict[str, Any]:
        """Sign-in page itself: each workspace option, empty submit, mobile layout. No credentials used."""
        ctx, page = self.new_context(browser, DESKTOP)
        result: dict[str, Any] = {"views": []}
        try:
            self.open_login(page)
            self.drain()
            result["views"].append(self.inspect(page, "signed-out", "Sign-in page", kind="page", load_s=None, shot="login__01-sign-in", tall=True))
            options = [o.strip() for o in page.locator('[data-testid="stButtonGroup"] button').all_inner_texts()]
            result["workspaces"] = options
            page.get_by_role("button", name="Sign in", exact=True).click()
            self.settle(page)
            result["views"].append(self.inspect(page, "signed-out", "Sign-in page › empty submit", kind="control", load_s=None, shot=None))
        except Exception as error:
            result["error"] = self.scrub(str(error))[:300]
        finally:
            ctx.close()
        ctx, page = self.new_context(browser, MOBILE, mobile=True)
        try:
            self.open_login(page)
            result["mobile"] = {"overflow": page.evaluate("() => window.__e2e.collect().overflow"), "screenshot": self.screenshot(page, "login__mobile")}
        except Exception as error:
            result["mobile"] = {"error": self.scrub(str(error))[:300]}
        finally:
            ctx.close()
        return result

    def wrong_workspace_check(self, browser: Browser) -> dict[str, Any]:
        """A student must not enter the Mentor workspace. Auth guard only, nothing is written."""
        spec = {"key": "student001", "portal": "Mentor", "env": "STUDENT001"}
        email, password = self.creds(spec)
        ctx, page = self.new_context(browser, DESKTOP)
        out: dict[str, Any] = {"check": "student001 in Mentor workspace"}
        try:
            self.open_login(page)
            self.choose_portal(page, "Mentor")
            page.locator("input[aria-label=Email]").fill(email)
            page.locator("input[type=password]").fill(password)
            page.get_by_role("button", name="Sign in", exact=True).click()
            self.settle(page, grace=1.0)
            out["alerts"] = page.evaluate("() => window.__e2e.collect().alerts")
            out["entered_workspace"] = bool(page.locator('[data-testid="stSidebar"]').count())
        except Exception as error:
            out["error"] = self.scrub(str(error))[:300]
        finally:
            ctx.close()
        return out


def build_issues(summary: dict[str, Any]) -> str:
    """Flat, de-duplicated list of everything the walk flagged (for writing up findings)."""
    lines: list[str] = []
    seen: set[tuple[str, ...]] = set()

    def add(*parts: str) -> None:
        if parts not in seen:
            seen.add(parts)
            lines.append(" | ".join(parts))

    for role in summary["roles"]:
        for error in role.get("errors", []):
            add("WALK-ERROR", role["role"], error)
        for view in role["views"]:
            where = f"{role['role']} > {view['label']}"
            if view.get("kind") == "walk-error":
                add("WALK-ERROR", where, view.get("error", ""))
                continue
            for text in view["exceptions"]:
                add("EXCEPTION", where, text[:200])
            for alert in view["error_alerts"]:
                add("ERROR-ALERT", where, alert["text"][:200])
            for event in view["console"] + view["network"]:
                add("BROWSER", role["role"], event["type"], event["text"][:200])
            if view["overflow"]["horizontal"]:
                add("OVERFLOW", where, json.dumps(view["overflow"]["offenders"][:2]))
            for text in view["truncated"]:
                add("TRUNCATED", role["role"], view["label"].split(" › ")[0], text)
            for leak in view["leaks"]:
                add("LEAK:" + leak["kind"], where, leak["match"], f"in {leak['where']}", leak["context"].strip()[:100])
            for chart in view["charts"]:
                if not chart["drawn"] or chart["h"] < 40:
                    add("CHART", where, json.dumps(chart))
            for src in view["broken_images"]:
                add("BROKEN-IMAGE", where, src)
            if view.get("load_s") and view["load_s"] > 8:
                add("SLOW", where, f"{view['load_s']}s")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pass", dest="pass_no", type=str, default="1", help="pass label (for example 2 or 2a); output goes to runtime/streamlit-project/e2e/pass<label>/")
    parser.add_argument("--base-url", default="http://127.0.0.1:8503")
    parser.add_argument("--roles", default="", help="comma list of role keys (default: all). Keys: " + ", ".join(r["key"] for r in ROLES))
    parser.add_argument("--timeout", type=int, default=90, help="per-step timeout, seconds")
    parser.add_argument("--shots", choices=["page", "tab", "all"], default="tab", help="screenshot granularity")
    parser.add_argument("--full-cap", type=int, default=2200, help="max height of the tall capture, px")
    parser.add_argument("--max-controls", type=int, default=8, help="max read-only controls flipped per state")
    parser.add_argument("--max-expanders", type=int, default=12, help="max expanders opened per state (Source records has one per student)")
    parser.add_argument("--options", type=int, default=2, help="alternative options tried per selector")
    parser.add_argument("--no-mobile", action="store_true")
    parser.add_argument("--mobile-only", action="store_true", help="only the mobile home pages (landing + content); merged into an existing summary.json")
    parser.add_argument("--no-auth-checks", action="store_true")
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()

    walk = Walk(args)
    wanted = {r.strip() for r in args.roles.split(",") if r.strip()}
    specs = [r for r in ROLES if not wanted or r["key"] in wanted]
    if not specs:
        print("no matching roles", file=sys.stderr)
        return 2
    started = time.time()
    summary: dict[str, Any] = {
        "pass": args.pass_no,
        "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "base_url": args.base_url,
        "viewport_desktop": DESKTOP,
        "viewport_mobile": MOBILE,
        "roles": [],
        "mobile": [],
    }
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        if not wanted and not args.no_auth_checks and not args.mobile_only:
            summary["login_page"] = walk.login_checks(browser)
            summary["auth_guard"] = walk.wrong_workspace_check(browser)
        for spec in ([] if args.mobile_only else specs):
            summary["roles"].append(walk.walk_role(browser, spec))
        if not args.no_mobile or args.mobile_only:
            for spec in specs:
                summary["mobile"].append(walk.mobile_home(browser, spec))
        browser.close()

    if args.mobile_only:
        target = walk.out / "summary.json"
        merged = json.loads(target.read_text()) if target.exists() else summary
        merged["mobile"] = summary["mobile"]
        target.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n")
        print(f"mobile only: {len(summary['mobile'])} roles merged into {target.relative_to(ROOT)}")
        return 0
    views = [v for r in summary["roles"] for v in r["views"]]
    summary["totals"] = {
        "roles": len(summary["roles"]),
        "views": len(views),
        "screenshots": walk.shots,
        "exceptions": sum(len(v.get("exceptions", [])) for v in views),
        "error_alerts": sum(len(v.get("error_alerts", [])) for v in views),
        "console_errors": sum(len(v.get("console", [])) for v in views),
        "http_errors": sum(len(v.get("network", [])) for v in views),
        "overflow_views": sum(1 for v in views if v.get("overflow", {}).get("horizontal")),
        "leak_findings": sum(len(v.get("leaks", [])) for v in views),
        "truncated_views": sum(1 for v in views if v.get("truncated")),
        "walk_errors": sum(len(r["errors"]) for r in summary["roles"]) + sum(1 for v in views if v.get("kind") == "walk-error"),
        "elapsed_s": round(time.time() - started, 1),
    }
    (walk.out / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    (walk.out / "issues.txt").write_text(build_issues(summary))
    print(json.dumps(summary["totals"], indent=2))
    print(f"summary: {(walk.out / 'summary.json').relative_to(ROOT)}  issues: {(walk.out / 'issues.txt').relative_to(ROOT)}")
    totals = summary["totals"]
    return 1 if (totals["exceptions"] or totals["walk_errors"]) else 0


if __name__ == "__main__":
    sys.exit(main())
