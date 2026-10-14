#!/usr/bin/env python3
"""Live agentic end-to-end run of AURA through the real Streamlit UI (Playwright, headless Chromium).

Round 2 of the E2E test (docs/E2E_TEST_LOG.md, row C3). Unlike walk.py this script WRITES: it signs in as
mentor1 and creates a review plan for exactly three explicitly selected, high-risk mentees, answers the
planner's questions once, locks and runs the plan with real Groq calls, inspects every draft, lightly edits
one that passed validation, approves and publishes it through the human gate, then checks the published plan
as that student and as their parent, and the run and approval as the department head and on AI activity.

It runs only against a LOCAL server and the LOCAL database, with fixture accounts. Claude is acting as mentor,
HoD, student and parent with the owner's authorisation; these are test runs, not sign-offs by real faculty.
Credentials come from the root .env (AURA_LOGIN_*), inside this process only, and are never printed.
Remote models only ever see anonymised numbers (the egress guard); this script does not touch that.
Student 021 (NAYAN KALAL, 01FE23BCI103) is refused.

Usage (repo root; start your own server first, never on 8502):
    CH11_PROVIDER_ORDER=groq,gemini,configured .venv/bin/streamlit run streamlit_app/app.py \
        --server.port 8503 --server.headless true --server.address 127.0.0.1 &
    .venv/bin/python streamlit_app/e2e/live_run.py --stage baseline
    .venv/bin/python streamlit_app/e2e/live_run.py --stage plan --dry     # fill the form, do not save
    .venv/bin/python streamlit_app/e2e/live_run.py --stage plan           # create, answer, lock, run (Groq)
    .venv/bin/python streamlit_app/e2e/live_run.py --stage inspect
    .venv/bin/python streamlit_app/e2e/live_run.py --stage decide         # edit, revalidate, approve, publish
    .venv/bin/python streamlit_app/e2e/live_run.py --stage views          # student, parent, HoD, AI activity, export
    .venv/bin/python streamlit_app/e2e/live_run.py --stage all

Round 3 (docs/E2E_TEST_LOG.md, "Pass 3") adds scenarios, each with its own state directory:
    --scenario attendance    two students whose attendance points outweigh the rest (Attendance specialist)
    --scenario wellbeing     two students, plan focus "Wellbeing referral" (Wellbeing-referral specialist)
Start the server with CH11_FAULT_INJECT=draft:1,judge:1 to make the first review fail the validator once (the
Regenerator runs live on real diagnoses) and the first judge look score low once (the judge-triggered repair
runs live). Both are off unless that variable is set, and both are recorded as "injected for testing" in the
draft's provenance and in the audit log. The judge itself is called live on every draft that passes validation.

State between stages lives in runtime/streamlit-project/e2e/live2/state.json (git-ignored), so a failed
stage never repeats the model calls of an earlier one. Screenshots go next to it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

from playwright.sync_api import Error as PlaywrightError  # noqa: E402
from playwright.sync_api import Page, sync_playwright  # noqa: E402
from walk import DESKTOP, ROOT, Walk, load_env  # noqa: E402

OUT = ROOT / "runtime" / "streamlit-project" / "e2e" / "live2"
STATE = OUT / "state.json"

REQUEST = "Prepare support plans for these students; use the current cycle's figures and the approved policy."
ANSWER = (
    "Only the three students I selected. The current review cycle is the window: use this cycle's attendance, "
    "marks, LMS and internship figures. Use the faculty-approved mentor policy. Focus on academic follow-up."
)
# Three high-risk mentees of mentor1 (risk score 85 in the current cycle), none of them student 021.
MENTEES = [
    {"register": "01FE22BCI026", "name": "Akshay Poojary"},
    {"register": "01FE24BCI018", "name": "Preetam G"},
    {"register": "01FE23BCI058", "name": "Pooja Pattar"},
]
SCENARIOS: dict[str, dict[str, Any]] = {
    "pass2": {"out": "live2"},
    "attendance": {
        "out": "live3-attendance",
        "request": "Prepare attendance support plans for these students; use the current cycle's figures and the approved policy.",
        "answer": (
            "Only the students I selected. The current review cycle is the window: use this cycle's attendance and "
            "placement-activity figures. Use the faculty-approved mentor policy. Focus on attendance follow-up."
        ),
        "focus": "Attendance",
        # medium-risk mentees of mentor1 whose only signals are ATTENDANCE_LOW (20 points) and PLACEMENT_ACTIVITY (15)
        "mentees": [
            {"register": "01FE24BCI073", "name": "Sunayana Kamat"},
            {"register": "01FE24BCI036", "name": "Bhavana Hulagammanavara"},
        ],
    },
    "wellbeing": {
        "out": "live3-wellbeing",
        "request": "Prepare optional wellbeing referral conversations for these students; use the current cycle's figures and the approved policy.",
        "answer": (
            "Only the students I selected. The current review cycle is the window: use this cycle's indicators only. "
            "Use the faculty-approved mentor policy. Focus on an optional wellbeing referral conversation, nothing more."
        ),
        "focus": "Wellbeing referral",
        "mentees": [
            {"register": "01FE24BCI007", "name": "Tanmayee Kalal"},
            {"register": "01FE23BCI076", "name": "Tanuja Ratan"},
        ],
    },
}
FOCUS = "Academic"
# Seconds to pause between planner calls. Round 2 paced them by hand (70) because the limiter refused a call
# that needed to wait; since the limiter waits (and the page shows the wait) round 3 sets 0 to prove it.
PLANNER_COOLDOWN = int(os.environ.get("LIVE_PLANNER_COOLDOWN", "70"))


def configure(name: str) -> None:
    """Select a scenario: its students, request, answer, focus and state directory."""
    global OUT, STATE, REQUEST, ANSWER, MENTEES, FOCUS
    scenario = SCENARIOS[name]
    OUT = ROOT / "runtime" / "streamlit-project" / "e2e" / scenario["out"]
    STATE = OUT / "state.json"
    REQUEST = scenario.get("request", REQUEST)
    ANSWER = scenario.get("answer", ANSWER)
    FOCUS = scenario.get("focus", FOCUS)
    MENTEES = scenario.get("mentees", MENTEES)
    assert PROTECTED_REGISTER not in [m["register"] for m in MENTEES], "student 021 is never used"


PROTECTED_REGISTER = "01FE23BCI103"  # student 021, never touched
PROTECTED_ENV = "STUDENT021"
EDIT_REASON = "Claude test run as mentor: light rewording of one action for clarity, evidence unchanged."
DECISION_REASON = "Claude test run as mentor on the local database: figures and actions checked, approved."
TERMINAL = {"awaiting_faculty", "needs_human", "ai_unavailable", "approved", "rejected", "failed", "completed"}


# --------------------------------------------------------------------------- state and reporting
def load_state() -> dict[str, Any]:
    OUT.mkdir(parents=True, exist_ok=True)
    return json.loads(STATE.read_text()) if STATE.exists() else {"log": [], "findings": []}


def save_state(state: dict[str, Any]) -> None:
    STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False, default=str) + "\n")


def note(state: dict[str, Any], text: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    print(f"[{stamp}] {text}", flush=True)
    state["log"].append(f"{stamp} {text}")


def finding(state: dict[str, Any], severity: str, where: str, text: str) -> None:
    note(state, f"FINDING {severity} {where}: {text}")
    state["findings"].append({"severity": severity, "where": where, "text": text})


# --------------------------------------------------------------------------- core (read-only bridge)
class Core:
    """Read-only structured access to the same engine the UI uses; used for ground truth and counts."""

    def __init__(self, env: dict[str, str]) -> None:
        import bridge  # the app's own private worker bridge

        self.env = env
        self.client = bridge.Client()
        self.tokens: dict[tuple[str, str], str] = {}

    def token(self, env_key: str, portal: str) -> str:
        if env_key == PROTECTED_ENV:
            raise SystemExit("refusing to use student 021")
        key = (env_key, portal)
        if key not in self.tokens:
            result = self.client.request(
                "login",
                {
                    "email": self.env[f"AURA_LOGIN_{env_key}_EMAIL"],
                    "password": self.env[f"AURA_LOGIN_{env_key}_PASSWORD"],
                    "portal": portal,
                    "source": "server-local",
                },
            )
            self.tokens[key] = result["token"]
        return self.tokens[key]

    def read(self, env_key: str, portal: str, action: str, data: dict[str, Any] | None = None) -> Any:
        return self.client.request(action, data or {}, token=self.token(env_key, portal))

    def close(self) -> None:
        self.client.close()


def snapshot(core: Core) -> dict[str, Any]:
    """Counts as each role sees them, from the Core, for before/after consistency checks."""
    mentor_queue = core.read("MENTOR1", "faculty", "review_queue")
    mentor_overview = core.read("MENTOR1", "faculty", "overview")
    mentor_review = core.read("MENTOR1", "faculty", "review_overview")
    hod_queue = core.read("HOD", "hod", "review_queue")
    gov = core.read("HOD", "governance", "review_overview")
    jobs = [j for j in gov.get("jobs") or [] if j.get("status") != "queued"]
    totals = (gov.get("metrics") or {}).get("totals") or {}
    return {
        "mentor_awaiting": mentor_queue.get("awaitingCount"),
        "mentor_overview_pending": (mentor_overview.get("counts") or {}).get("pending_reviews"),
        "mentor_approved_plans": len(mentor_queue.get("plans") or []),
        "mentor_plan_count": len(mentor_review.get("plans") or []),
        "hod_awaiting": hod_queue.get("awaitingCount"),
        "hod_approved_plans": len(hod_queue.get("plans") or []),
        "gov_recorded_runs": len(jobs),
        "gov_model_runs": sum(1 for j in jobs if j.get("mode") == "model"),
        "gov_waiting_for_ai": sum(1 for j in jobs if j.get("status") == "ai_unavailable"),
        "gov_totals": {k: totals.get(k) for k in ("evaluated", "validationPassed", "escalated")},
        "gov_plans": len(gov.get("plans") or []),
    }


# --------------------------------------------------------------------------- browser helpers
class Live:
    def __init__(self, base_url: str) -> None:
        import argparse as _a

        self.walk = Walk(_a.Namespace(pass_no="live2", base_url=base_url, timeout=90, full_cap=2200))
        self.walk.out = OUT  # screenshots land in live2/, not pass<N>/
        self.env = self.walk.env

    # sign in / out
    def spec(self, key: str, portal: str, env_key: str) -> dict[str, str]:
        if env_key == PROTECTED_ENV:
            raise SystemExit("refusing to sign in as student 021")
        return {"key": key, "portal": portal, "env": env_key}

    def open(self, browser, viewport=DESKTOP):  # noqa: ANN001
        ctx, page = self.walk.new_context(browser, viewport)
        return ctx, page

    def sign_in(self, page: Page, spec: dict[str, str]) -> None:
        self.walk.sign_in(page, spec)

    def wait(self, page: Page, seconds: int = 90, grace: float = 1.0) -> float:
        previous = self.walk.args.timeout
        self.walk.args.timeout = seconds
        try:
            return self.walk.settle(page, grace=grace, quiet=0.8)
        finally:
            self.walk.args.timeout = previous

    def shot(self, page: Page, name: str, tall: bool = False) -> str:
        return self.walk.screenshot(page, name, tall=tall)

    # navigation
    def goto_page(self, page: Page, label: str) -> None:
        page.locator('[data-testid="stSidebar"] [data-testid="stRadioOption"]').filter(has_text=label).first.click()
        self.wait(page, 90, 0.6)

    def goto_tab(self, page: Page, label: str) -> None:
        page.get_by_role("tab", name=re.compile(label)).first.click()
        self.wait(page, 90, 0.5)

    def open_expander(self, page: Page, title: str) -> bool:
        """Open the expander whose own summary contains the title (not one that merely holds a matching label)."""
        summary = page.locator('[data-testid="stMain"] [data-testid="stExpander"] > details > summary').filter(has_text=title).first
        if summary.count() == 0:
            return False
        if not summary.evaluate("s => s.parentElement.open"):
            summary.click()
            time.sleep(0.6)
        return True

    # widgets
    def pick_select(self, page: Page, label: str, option_text: str) -> None:
        box = (
            page.locator('[data-testid="stSelectbox"]')
            .filter(has=page.locator('[data-testid="stWidgetLabel"]', has_text=re.compile(rf"^\s*{re.escape(label)}\s*$")))
            .first
        )
        combo = box.locator('input[role="combobox"]')
        combo.click()
        page.keyboard.type(option_text[:24], delay=15)
        page.locator('[role="listbox"] [role="option"]').filter(has_text=option_text[:24]).first.click()
        self.wait(page, 90, 0.5)

    def select_value(self, page: Page, label: str) -> str:
        box = (
            page.locator('[data-testid="stSelectbox"]')
            .filter(has=page.locator('[data-testid="stWidgetLabel"]', has_text=re.compile(rf"^\s*{re.escape(label)}\s*$")))
            .first
        )
        if box.count() == 0:
            return ""
        return (box.locator("input[role=combobox]").input_value() or box.inner_text()).strip()

    def button(self, page: Page, name: str, exact: bool = True):  # noqa: ANN201
        # buttons with a Material icon carry the icon's ligature text in their accessible name
        return page.get_by_role("button", name=re.compile(rf"(?:^|\s){re.escape(name)}\s*$"))

    def frames(self, page: Page) -> list[dict[str, Any]]:
        return page.evaluate("() => window.__e2e.collect().dataframes")

    def table(self, page: Page, *headers: str) -> list[dict[str, str]]:
        for frame in self.frames(page):
            if all(h in frame["headers"] for h in headers):
                head, cells = frame["headers"], frame["sample"]
                width = len(head)
                if not width:
                    continue
                return [dict(zip(head, cells[i : i + width])) for i in range(0, len(cells) - width + 1, width)]
        return []

    def main_text(self, page: Page) -> str:
        return page.locator('[data-testid="stMain"]').inner_text()

    def alerts(self, page: Page) -> list[dict[str, str]]:
        return page.evaluate("() => window.__e2e.collect().alerts")

    def errors_on_page(self, page: Page) -> list[str]:
        data = page.evaluate("() => window.__e2e.collect()")
        return data["exceptions"] + [a["text"] for a in data["alerts"] if a["kind"] == "error"]


def mentee_labels() -> list[str]:
    return [m["register"] for m in MENTEES]


def login_keys_for(core_names: dict[str, str]) -> dict[str, str]:
    """Student display name -> STUDENT### env key, using the fixture account list (names only)."""
    env = load_env()
    email_key: dict[str, str] = {}
    for key, value in env.items():
        match = re.match(r"AURA_LOGIN_((?:STUDENT|PARENT)\d+)_EMAIL$", key)
        if match:
            email_key[value] = match.group(1)
    accounts = json.loads((ROOT / "runtime" / "project-final" / "accounts.json").read_text())
    result: dict[str, str] = {}
    for account in accounts:
        if account.get("role") == "student" and account.get("name") in core_names.values():
            result[account["name"]] = email_key.get(account["email"], "")
    return result


# --------------------------------------------------------------------------- stage: baseline
def stage_baseline(state: dict[str, Any], core: Core) -> None:
    assert PROTECTED_REGISTER not in mentee_labels()
    state["baseline"] = snapshot(core)
    note(state, f"baseline counts: {json.dumps(state['baseline'])}")
    save_state(state)


# --------------------------------------------------------------------------- stage: plan
def progress_watcher(core: Core, plan_id: str, stop: threading.Event, state: dict[str, Any]) -> None:
    """Print job progress from the Core while the (blocking) Run button works (reuses the main session:
    each extra bridge sign-in counts against the sign-in rate limit)."""
    last = ""
    try:
        while not stop.is_set():
            try:
                jobs = [j for j in core.read("MENTOR1", "faculty", "review_overview").get("jobs") or [] if j.get("plan_id") == plan_id]
                line = ", ".join(f"{j.get('status')}/{j.get('stage')}" for j in jobs)
                if line != last:
                    note(state, f"progress: {line}")
                    last = line
            except Exception as error:  # noqa: BLE001 - the watcher must never stop the run
                note(state, f"progress watcher: {str(error)[:80]}")
            stop.wait(25)
    finally:
        pass


def read_questions(live: Live, page: Page) -> list[str]:
    for alert in live.alerts(page):
        if "Complete these details before locking" in alert["text"]:
            return [alert["text"].split("locking the plan:", 1)[-1].strip()]
    return []


def fill_create_form(live: Live, page: Page, state: dict[str, Any]) -> None:
    live.open_expander(page, "Create a review plan")
    page.get_by_label("Review request", exact=True).fill(REQUEST)
    multi = page.locator('[data-testid="stMultiSelect"]').filter(has_text="Students in scope").first
    for mentee in MENTEES:
        multi.locator("input").first.click()
        page.keyboard.type(mentee["register"], delay=15)
        page.locator('[role="listbox"] [role="option"]').filter(has_text=mentee["register"]).first.click()
        time.sleep(0.4)
    chips = multi.locator(".react-aria-ComboBox [data-tag]").count()
    note(state, f"selected {chips} students in the form")
    assert chips == len(MENTEES), f"expected {len(MENTEES)} selected students, saw {chips}"
    page.keyboard.press("Escape")
    live.shot(page, "02-mentor-create-plan-form")


def stage_plan(state: dict[str, Any], live: Live, core: Core, dry: bool, run_timeout: int, resume: bool = False) -> None:
    plan_info: dict[str, Any] = state.setdefault("plan", {})
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx, page = live.open(browser)
        try:
            live.sign_in(page, live.spec("mentor1", "Mentor", "MENTOR1"))
            live.goto_page(page, "Support reviews")
            live.goto_tab(page, "Plans & agent runs")
            live.shot(page, "01-mentor-plans-tab")

            # 1. create the plan with exactly three explicitly selected mentees
            if not resume:
                fill_create_form(live, page, state)
                if dry:
                    note(state, "dry run: stopping before Save review plan")
                    save_state(state)
                    return

            created_at = time.time()
            if not resume:
                before_plans = len(core.read("MENTOR1", "faculty", "review_overview").get("plans") or [])
                live.button(page, "Save review plan").click()
                live.wait(page, 240, 1.5)
                created_at = time.time()
                plan_info["planner_rounds"] = 1
                plan_info["errors_after_create"] = live.errors_on_page(page)
                live.shot(page, "03-mentor-plan-created", tall=True)
                overview = core.read("MENTOR1", "faculty", "review_overview")
                plans = overview.get("plans") or []
                assert len(plans) == before_plans + 1, f"plan not saved ({before_plans} -> {len(plans)}); errors {plan_info['errors_after_create']}"
                plan = max(plans, key=lambda r: r.get("created_at") or r.get("createdAt") or "")
                plan_info["id"] = plan["id"]
                note(state, f"plan {plan['id'][:8]} saved, revision {plan['revision']}, status {plan['status']}")
                plan_info["planner_agent_create"] = plan["body"].get("agent")
            else:
                plan = next(r for r in core.read("MENTOR1", "faculty", "review_overview")["plans"] if r["id"] == plan_info["id"])
                created_at = time.time() - 600
                note(state, f"resuming plan {plan['id'][:8]} (revision {plan['revision']}, status {plan['status']})")
            card = live.main_text(page)
            plan_info["card_after_create"] = {
                "students_fact": (re.findall(r"Students\s*\n+\s*(\d+)", card) or [None])[0],
                "scope_fact": "Your selection" in card,
            }

            # 2. the planner's questions, answered once (paced: the Groq tokens-per-minute budget is 8000)
            questions = read_questions(live, page)
            plan_info.setdefault("questions_round_1", questions or plan["body"].get("questions") or [])
            note(state, f"planner questions: {plan_info['questions_round_1']}")
            plan_info.setdefault("answers_saved", 0)
            for attempt in range(1, 6):
                if not read_questions(live, page):
                    break
                cooldown = PLANNER_COOLDOWN - (time.time() - created_at)
                if cooldown > 0:
                    note(state, f"waiting {int(cooldown)}s so the next planner call fits the tokens-per-minute budget")
                    time.sleep(cooldown)
                live.open_expander(page, "Answer questions or revise this plan")
                page.get_by_label("Revision feedback", exact=True).fill(ANSWER)
                if live.select_value(page, "Revised focus").startswith("Choose"):
                    live.pick_select(page, "Revised focus", FOCUS)
                if live.select_value(page, "Revised policy").startswith("Choose"):
                    box = page.locator('[data-testid="stSelectbox"]').filter(has_text="Revised policy").first
                    box.locator('input[role="combobox"]').click()
                    page.locator('[role="listbox"] [role="option"]').nth(1).click()
                    time.sleep(0.4)
                live.button(page, "Save revised plan").click()
                live.wait(page, 240, 1.5)
                created_at = time.time()
                busy = [a["text"] for a in live.alerts(page) if "No AI model answered" in a["text"]]
                live.shot(page, f"04-mentor-plan-answer-{attempt}", tall=True)
                if busy:
                    plan_info.setdefault("ai_unavailable_messages", []).append(busy[0][:240])
                    note(state, f"answer {attempt} was not saved: the UI said '{busy[0][:140]}'")
                    continue
                plan_info["answers_saved"] += 1
                plan_info["planner_rounds"] = plan_info.get("planner_rounds", 1) + 1
                remaining = read_questions(live, page)
                note(state, f"answered (attempt {attempt}); questions still shown: {bool(remaining)}")
                if remaining and plan_info["answers_saved"] >= 2:
                    finding(state, "P2", "Plan questions", f"the planner asked again after {plan_info['answers_saved']} saved answers: {remaining}")
            plan_info["answers_given"] = plan_info["answers_saved"]

            # a scope conflict is answered with the mentor's own selection
            if page.get_by_role("button", name=re.compile(r"Keep my \d+")).count():
                page.get_by_role("button", name=re.compile(r"Keep my \d+")).first.click()
                live.wait(page, 240, 1.5)
                plan_info["scope_conflict_answered"] = "kept the mentor's selection"

            # 3. assert the plan scope shows exactly the three names
            opened = live.open_expander(page, "Students in scope")
            rows: list[dict[str, str]] = []
            for _ in range(8):
                rows = live.table(page, "Register number", "Student")
                if rows:
                    break
                time.sleep(1.0)
            shown = sorted((r["Register number"], r["Student"]) for r in rows)
            expected = sorted((m["register"], m["name"]) for m in MENTEES)
            plan_info["scope_shown"] = shown
            summary = page.locator('[data-testid="stMain"]').get_by_text(re.compile(r"Students in scope \(\d+\)")).first.inner_text()
            plan_info["scope_summary"] = summary.strip()
            live.shot(page, "05-mentor-plan-scope", tall=True)
            ok = opened and shown == expected and f"({len(MENTEES)})" in summary
            plan_info["scope_assertion"] = "pass" if ok else "FAIL"
            note(state, f"scope assertion {plan_info['scope_assertion']}: {summary.strip()} {shown}")
            fresh = next(r for r in core.read("MENTOR1", "faculty", "review_overview")["plans"] if r["id"] == plan["id"])
            plan_info["body_after_answers"] = {
                k: fresh["body"].get(k)
                for k in ("request", "domain", "policyId", "studentIds", "scope", "filter", "questions", "scopeConflict", "feedback")
            }
            plan_info["planner_agent"] = fresh["body"].get("agent")
            plan_info["revision"] = fresh["revision"]
            if not ok:
                finding(state, "P1", "Plan scope (L1)", f"scope did not show exactly the selected names: {shown}")
                save_state(state)
                raise SystemExit("scope assertion failed: not locking")
            assert not fresh["body"].get("questions"), f"questions remain: {fresh['body'].get('questions')}"

            # 4. lock, then run (real Groq calls)
            live.button(page, "Lock review plan").click()
            live.wait(page, 120, 1.2)
            live.shot(page, "06-mentor-plan-locked", tall=True)
            locked = next(r for r in core.read("MENTOR1", "faculty", "review_overview")["plans"] if r["id"] == plan["id"])
            assert locked["status"] == "locked", f"plan status {locked['status']}"
            note(state, "plan locked; pressing Run review")
            stop = threading.Event()
            watcher = threading.Thread(target=progress_watcher, args=(core, plan["id"], stop, state), daemon=True)
            watcher.start()
            started = time.time()
            live.button(page, "Run review").click()
            live.wait(page, run_timeout, 2.0)
            plan_info["run_seconds"] = round(time.time() - started)
            stop.set()
            watcher.join(timeout=60)
            note(state, f"Run review returned after {plan_info['run_seconds']}s")
            plan_info["page_errors_after_run"] = live.errors_on_page(page)
            plan_info["alerts_after_run"] = live.alerts(page)
            live.shot(page, "07-mentor-agent-run", tall=True)
            table = live.table(page, "Student", "Status", "Stage")
            plan_info["job_table_ui"] = table
            note(state, f"agent run table (UI): {table}")
            jobs = [j for j in core.read("MENTOR1", "faculty", "review_overview").get("jobs") or [] if j.get("plan_id") == plan["id"]]
            plan_info["job_status"] = {j["id"]: [j.get("status"), j.get("stage"), j.get("mode"), j.get("error_code")] for j in jobs}
            note(state, f"jobs (Core): {plan_info['job_status']}")
            if plan_info["page_errors_after_run"]:
                finding(state, "P1", "Run review", f"UI errors after the run: {plan_info['page_errors_after_run']}")
        finally:
            ctx.close()
            browser.close()
            save_state(state)


# --------------------------------------------------------------------------- stage: retry
def stage_retry(state: dict[str, Any], live: Live, core: Core, run_timeout: int) -> None:
    """Press "Retry AI review" (after the tokens-per-minute window cools) until no review is waiting for a model."""
    plan_id = state["plan"]["id"]
    attempts: list[dict[str, Any]] = state.setdefault("retries", [])
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx, page = live.open(browser)
        try:
            live.sign_in(page, live.spec("mentor1", "Mentor", "MENTOR1"))
            live.goto_page(page, "Support reviews")
            live.goto_tab(page, "Plans & agent runs")
            live.open_expander(page, "Why no model answered")
            live.shot(page, "08a-mentor-ai-unavailable", tall=True)
            for attempt in range(1, 9):
                jobs = [j for j in core.read("MENTOR1", "faculty", "review_overview").get("jobs") or [] if j.get("plan_id") == plan_id]
                # one review runs per click under a budgeted remote model: queued ones need another Run review
                waiting = [j for j in jobs if j.get("status") in ("ai_unavailable", "queued", "blocked")]
                if not waiting:
                    break
                note(state, f"retry {attempt}: {len(waiting)} of {len(jobs)} reviews still to run; one review runs per click under a budgeted remote model")
                time.sleep(5)
                button = live.button(page, "Retry AI review")
                if button.count() == 0:
                    button = live.button(page, "Run review")
                if button.count() == 0:
                    note(state, "no Run review or Retry AI review button on the page")
                    break
                stop = threading.Event()
                watcher = threading.Thread(target=progress_watcher, args=(core, plan_id, stop, state), daemon=True)
                watcher.start()
                started = time.time()
                button.first.click()
                live.wait(page, run_timeout, 2.0)
                stop.set()
                watcher.join(timeout=60)
                jobs = [j for j in core.read("MENTOR1", "faculty", "review_overview").get("jobs") or [] if j.get("plan_id") == plan_id]
                record = {
                    "attempt": attempt,
                    "seconds": round(time.time() - started),
                    "jobs": {str(j["id"])[:8]: [j.get("status"), j.get("stage"), j.get("mode"), j.get("error_code")] for j in jobs},
                    "page_errors": live.errors_on_page(page),
                }
                attempts.append(record)
                note(state, f"retry {attempt} returned after {record['seconds']}s: {record['jobs']}")
                live.shot(page, f"08b-mentor-retry-{attempt}", tall=True)
        finally:
            ctx.close()
            browser.close()
            save_state(state)


# --------------------------------------------------------------------------- stage: inspect
def judge_facts(judge: Any) -> Any:
    """The judge's verdict without free text, plus its first look when a repair followed."""
    if not isinstance(judge, dict):
        return None
    keys = ("status", "round", "scores", "mean", "min", "passed", "repair", "injected", "provider", "model", "tokens", "unavailableReason")
    out = {k: judge.get(k) for k in keys if k in judge}
    if isinstance(judge.get("previous"), dict):
        out["previous"] = judge_facts(judge["previous"])
    return out


def draft_facts(draft: dict[str, Any]) -> dict[str, Any]:
    import labels

    validation = draft.get("validation") or {}
    prov = validation.get("provenance") or {}
    agent = prov.get("agent") or {}
    calls = [c for c in agent.get("toolCalls") or [] if isinstance(c, dict)]
    egress = [e for e in prov.get("egress") or [] if isinstance(e, dict)]
    repair_rows = []
    for item in validation.get("repairs") or []:
        rows, _ = labels.diagnosis_rows(item)
        repair_rows.append({"attempt": item.get("attempt"), "diagnoses": rows})
    open_rows, _ = labels.diagnosis_rows(validation)
    return {
        "student": draft.get("display_name"),
        "register": draft.get("register_number"),
        "case": draft.get("id"),
        "revision": draft.get("revision"),
        "version": draft.get("artifact_version"),
        "status": draft.get("status"),
        "mode": draft.get("mode"),
        "model_id": draft.get("model_id"),
        "provider": prov.get("provider"),
        "model": prov.get("model"),
        "specialist": prov.get("specialist"),
        "valid": validation.get("valid"),
        "checks": validation.get("checks"),
        "packet_schema": validation.get("packetSchema"),
        "repairs": len(validation.get("repairs") or []),
        "repair_diagnoses": repair_rows,
        "open_issues": open_rows,
        "fallback": validation.get("fallback"),
        "fallback_reason": prov.get("fallbackReason"),
        "provider_error": validation.get("providerError"),
        "provider_skips": [f"{f.get('provider')}:{f.get('reason')}" for f in prov.get("fallbacks") or []],
        "tokens": prov.get("tokens"),
        "egress_sent": sum(1 for e in egress if e.get("outcome") == "sent"),
        "egress_blocked": sum(1 for e in egress if e.get("outcome") == "blocked"),
        "investigator": {
            "mode": agent.get("mode"),
            "turns": agent.get("turns"),
            "budget": agent.get("budget"),
            "provider": agent.get("provider"),
            "model": agent.get("model"),
            "tool_calls": len(calls),
            "tools": [f"{c.get('tool')}:{c.get('status')}" for c in calls],
            "evidence_values": agent.get("evidenceValues"),
            "fallback_reason": agent.get("fallbackReason") or agent.get("skippedReason"),
        },
        "judge_recorded": bool(re.search(r"judge", json.dumps(prov), re.I)),
        "judge": judge_facts(validation.get("judge")),
        "injected": prov.get("injected"),
        "repair_sources": [r.get("source") or "validator" for r in validation.get("repairs") or []],
        "model_attempts": len(validation.get("modelAttempts") or []),
        "egress_reached": sum(1 for e in egress if e.get("reached")),
        "summary_chars": len(((draft.get("recommendation") or {}).get("summary")) or ""),
        "actions": [a.get("label") for a in (draft.get("recommendation") or {}).get("actions") or []],
    }


def job_facts(job: dict[str, Any]) -> dict[str, Any]:
    trace = job.get("node_trace") or []
    nodes = []
    if isinstance(trace, list):
        for node in trace:
            if isinstance(node, dict):
                nodes.append(f"{node.get('node') or node.get('name')}:{node.get('state') or node.get('status')}")
    return {
        "id": job.get("id"),
        "student_id": job.get("student_id"),
        "status": job.get("status"),
        "stage": job.get("stage"),
        "mode": job.get("mode"),
        "error_code": job.get("error_code"),
        "attempts": job.get("attempts"),
        "nodes": nodes,
        "retrieval_refs": len(job.get("retrieval") or []),
        "source_timings": sorted((job.get("source_timings") or {}).keys()),
        "failure_diagnosis": job.get("failure_diagnosis"),
    }


def stage_inspect(state: dict[str, Any], live: Live, core: Core) -> None:
    plan_id = state["plan"]["id"]
    queue = core.read("MENTOR1", "faculty", "review_queue")
    wanted = set(mentee_labels())
    drafts = [d for d in queue.get("drafts") or [] if d.get("register_number") in wanted]
    overview = core.read("MENTOR1", "faculty", "review_overview")
    jobs = [j for j in overview.get("jobs") or [] if j.get("plan_id") == plan_id]
    plan = next(r for r in overview["plans"] if r["id"] == plan_id)
    export = core.read("MENTOR1", "faculty", "plan_export", {"planId": plan_id})
    inspected: dict[str, Any] = {
        "drafts": [draft_facts(d) for d in drafts],
        "jobs": [job_facts(j) for j in jobs],
        "planner_agent": plan["body"].get("agent"),
        "planner_steps": plan["body"].get("agentSteps"),
        "export_keys": sorted(export.keys()),
    }
    audit = export.get("audit") or export.get("auditEvents") or []
    inspected["audit_actions"] = sorted({str(a.get("action") or a.get("type")) for a in audit if isinstance(a, dict)})
    inspected["audit_rows"] = len(audit)
    state["inspected"] = inspected
    note(state, f"inspected {len(drafts)} drafts and {len(jobs)} jobs from the Core")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx, page = live.open(browser)
        try:
            live.sign_in(page, live.spec("mentor1", "Mentor", "MENTOR1"))
            live.goto_page(page, "Support reviews")
            live.goto_tab(page, "Plans & agent runs")
            live.open_expander(page, "How the planner read this request")
            state["plan"]["planner_trace_ui"] = live.table(page, "Step", "Detail")
            live.shot(page, "08-mentor-planner-trace", tall=True)
            live.goto_tab(page, "Review queue")
            ui_rows = []
            for index, mentee in enumerate(MENTEES):
                try:
                    live.pick_select(page, "Draft", mentee["register"])
                except PlaywrightError as error:
                    ui_rows.append({"register": mentee["register"], "error": live.walk.scrub(str(error))[:160]})
                    continue
                for title in ("How this draft was produced", "Repair history", "Open issues"):
                    live.open_expander(page, title)
                text = live.main_text(page)
                drafted = re.search(r"Drafted by: ([^\n]+)", text)
                repairs = re.search(r"(\d+) targeted repair attempt", text)
                headline = re.search(r"Validation report\s*\n+([^\n]+)", text)
                ui_rows.append(
                    {
                        "register": mentee["register"],
                        "drafted_by": drafted.group(1) if drafted else None,
                        "validation_headline": headline.group(1) if headline else None,
                        "repairs_caption": int(repairs.group(1)) if repairs else 0,
                        "provenance": live.table(page, "Step", "Detail"),
                        "tools": live.table(page, "Tool", "Outcome"),
                        "judge_chip": " ".join(page.locator(".aura-agent").filter(has_text="judge").first.inner_text().split())
                        if page.locator(".aura-agent").filter(has_text="judge").count()
                        else None,
                        "errors": live.errors_on_page(page),
                    }
                )
                live.shot(page, f"09-mentor-draft-{index + 1}-{mentee['register']}", tall=True)
            state["inspected"]["draft_ui"] = ui_rows
        finally:
            ctx.close()
            browser.close()
            save_state(state)


# --------------------------------------------------------------------------- stage: decide
def stage_decide(state: dict[str, Any], live: Live, core: Core) -> None:
    inspected = state["inspected"]
    candidates = [d for d in inspected["drafts"] if d.get("valid") and d.get("mode") == "model"]
    if not candidates:
        finding(state, "P1", "Draft validation", "no draft passed validation, so nothing can be approved")
        save_state(state)
        raise SystemExit("no valid draft")
    # prefer the draft that went through the most repairs: it proves a repaired draft is publishable
    chosen = max(candidates, key=lambda d: (d.get("repairs") or 0))
    state["chosen"] = {"student": chosen["student"], "register": chosen["register"], "case": chosen["case"], "version_before": chosen["version"]}
    note(state, f"chosen draft: {chosen['student']} {chosen['register']} case {str(chosen['case'])[:8]} version {chosen['version']}")
    original_label = chosen["actions"][0]
    new_label = original_label.rstrip(".") + " (reworded by mentor)"
    state["chosen"]["edit"] = {"from": original_label, "to": new_label}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx, page = live.open(browser)
        try:
            live.sign_in(page, live.spec("mentor1", "Mentor", "MENTOR1"))
            live.goto_page(page, "Support reviews")
            live.goto_tab(page, "Review queue")
            live.pick_select(page, "Draft", chosen["register"])
            live.open_expander(page, "Edit the draft")
            live.shot(page, "10-mentor-edit-draft-before", tall=True)
            # reword one action: select the first cell of the Action column in the data editor
            grid = page.locator('[data-testid="stDataFrame"]').filter(has_text="Action").first
            if grid.count() == 0:
                grid = page.locator('[data-testid="stDataFrame"]').first
            grid.scroll_into_view_if_needed()
            box = grid.bounding_box()
            assert box, "no data editor box"
            page.mouse.click(box["x"] + 90, box["y"] + 35 + 17)
            time.sleep(0.4)
            page.keyboard.press("Enter")
            time.sleep(0.3)
            page.keyboard.press("ControlOrMeta+A")
            page.keyboard.type(new_label, delay=8)
            page.keyboard.press("Enter")
            time.sleep(0.6)
            edit_mode = "action cell in the data editor"
            page.get_by_label("Reason for this edit", exact=True).fill(EDIT_REASON)
            live.shot(page, "11-mentor-edit-draft-typed", tall=True)
            live.button(page, "Save new draft version").click()
            live.wait(page, 180, 1.5)
            queue = core.read("MENTOR1", "faculty", "review_queue")
            after = next((d for d in queue["drafts"] if d.get("register_number") == chosen["register"]), None)
            assert after, "draft vanished after edit"
            facts = draft_facts(after)
            labels_now = facts["actions"]
            if new_label not in labels_now:
                # fall back to rewording the recommendation summary (the action grid ignored the edit)
                finding(state, "P3", "Edit the draft", "the action cell did not take the typed text in headless Chromium; reworded the summary instead")
                edit_mode = "recommendation summary (action cell edit did not register)"
                live.open_expander(page, "Edit the draft")
                summary_box = page.get_by_label("Recommendation summary", exact=True)
                summary_box.fill((summary_box.input_value() or "").rstrip(".") + " (reworded by mentor).")
                page.get_by_label("Reason for this edit", exact=True).fill(EDIT_REASON)
                live.button(page, "Save new draft version").click()
                live.wait(page, 180, 1.5)
                queue = core.read("MENTOR1", "faculty", "review_queue")
                after = next(d for d in queue["drafts"] if d.get("register_number") == chosen["register"])
                facts = draft_facts(after)
            state["chosen"]["edit_mode"] = edit_mode
            state["chosen"]["after_edit"] = facts
            state["chosen"]["revalidated"] = bool(
                facts["version"] > chosen["version"]
                and facts["valid"]
                and (after.get("validation") or {}).get("mentorEdited")
            )
            note(state, f"edit saved via {edit_mode}: version {chosen['version']} -> {facts['version']}, valid {facts['valid']}, revalidated {state['chosen']['revalidated']}")
            live.shot(page, "12-mentor-edit-draft-saved", tall=True)
            assert state["chosen"]["revalidated"], "the edited version was not revalidated as valid"

            # approve and publish through the human gate
            page.locator('[data-testid="stMain"]').get_by_text("Approve and publish").first.click()
            time.sleep(0.3)
            page.get_by_label("Decision rationale", exact=True).fill(DECISION_REASON)
            live.shot(page, "13-mentor-gate-before-decision", tall=True)
            live.button(page, "Save decision").click()
            live.wait(page, 180, 1.5)
            live.shot(page, "14-mentor-gate-after-decision", tall=True)
            queue = core.read("MENTOR1", "faculty", "review_queue")
            state["chosen"]["still_in_queue"] = any(d.get("register_number") == chosen["register"] and d.get("status") == "awaiting_faculty" for d in queue["drafts"])
            state["chosen"]["approved_plans_after"] = len(queue.get("plans") or [])
            note(state, f"decision saved; still awaiting: {state['chosen']['still_in_queue']}; approved plans now {state['chosen']['approved_plans_after']}")
        finally:
            ctx.close()
            browser.close()
            save_state(state)


# --------------------------------------------------------------------------- stage: views
def stage_views(state: dict[str, Any], live: Live, core: Core) -> None:
    chosen = state["chosen"]
    names = {chosen["register"]: chosen["student"]}
    keys = login_keys_for({"x": str(chosen["student"]).upper()})
    student_key = keys.get(str(chosen["student"]).upper())
    assert student_key and student_key != PROTECTED_ENV, "no student login for the chosen draft"
    number = student_key.replace("STUDENT", "")
    parent_key = f"PARENT{number}"
    label = "reworded by mentor" if "summary" in str(chosen.get("edit_mode")) else str(chosen["edit"]["to"])
    results: dict[str, Any] = {"student_login": student_key, "parent_login": parent_key}

    def plan_card(page: Page, heading: str) -> dict[str, Any]:
        text = live.main_text(page)
        return {
            "has_heading": heading in text,
            "has_edited_action": label in text,
            "has_chip_note": "Drafted by an AI agent. Approved by your mentor." in text,
            "agent_chip": " ".join(page.locator(".aura-agent").first.inner_text().split()) if page.locator(".aura-agent").count() else None,
            "snippet": text[text.find(heading) : text.find(heading) + 420] if heading in text else text[:200],
        }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            # student
            ctx, page = live.open(browser)
            try:
                live.sign_in(page, live.spec("student", "Student", student_key))
                results["student_home"] = plan_card(page, "Your support plan")
                live.shot(page, "15-student-overview", tall=True)
                if not results["student_home"]["has_heading"]:
                    live.goto_page(page, "Academic records")
                    live.goto_tab(page, "Support")
                    results["student_records"] = plan_card(page, "Your support plan")
                    live.shot(page, "15b-student-support-tab", tall=True)
                results["student_errors"] = live.errors_on_page(page)
            finally:
                ctx.close()
            # parent
            ctx, page = live.open(browser)
            try:
                live.sign_in(page, live.spec("parent", "Parent", parent_key))
                results["parent_home"] = plan_card(page, "Approved support plan")
                results["parent_home"]["shows_child_name"] = str(chosen["student"]).split()[0].lower() in live.main_text(page).lower()
                live.shot(page, "16-parent-overview", tall=True)
                if not results["parent_home"]["has_heading"]:
                    live.goto_page(page, "Child records")
                    results["parent_records"] = plan_card(page, "Approved support plan")
                    live.shot(page, "16b-parent-child-records", tall=True)
                results["parent_errors"] = live.errors_on_page(page)
            finally:
                ctx.close()
            # HoD
            ctx, page = live.open(browser)
            try:
                live.sign_in(page, live.spec("hod", "Department head", "HOD"))
                results["hod_overview_text"] = re.findall(r"Reviews awaiting work\s*\n+\s*(\d+)", live.main_text(page))
                live.shot(page, "17-hod-overview", tall=True)
                live.goto_page(page, "Support reviews")
                results["hod_support_kpis"] = {
                    k: (re.findall(rf"{k}\s*\n+\s*([^\n]+)", live.main_text(page)) or [None])[0]
                    for k in ("Awaiting mentors", "Approved plans")
                }
                live.shot(page, "18-hod-support-reviews", tall=True)
                live.goto_tab(page, "Plans & agent runs")
                results["hod_plan_visible"] = state["plan"]["id"][:8] in live.main_text(page) or REQUEST[:30] in live.main_text(page)
                live.shot(page, "19-hod-plans", tall=True)
                results["hod_errors"] = live.errors_on_page(page)
            finally:
                ctx.close()
            # AI activity
            ctx, page = live.open(browser)
            try:
                live.sign_in(page, live.spec("hod-ai-activity", "AI activity", "HOD"))
                text = live.main_text(page)
                results["gov_kpis_ui"] = {
                    k: (re.findall(rf"{k}\s*\n+\s*([^\n]+)", text) or [None])[0]
                    for k in ("Recorded runs", "AI model runs", "Passed validation", "Escalations", "Waiting for AI")
                }
                live.shot(page, "20-ai-activity-overview", tall=True)
                live.goto_tab(page, "Runs & replay")
                results["gov_runs_ui"] = live.table(page, "Run", "Status", "Stage")
                runs_text = live.main_text(page)
                results["gov_runs_judge"] = {
                    "judge_node_in_strip": "Judge" in runs_text,
                    "judge_rows": live.table(page, "Step", "Detail")[:30],
                }
                live.shot(page, "21-ai-activity-runs", tall=True)
                live.goto_tab(page, "Plans")
                results["gov_plan_visible"] = state["plan"]["id"][:8] in live.main_text(page) or REQUEST[:30] in live.main_text(page)
                # evidence export from the AI activity workspace
                export_btn = page.get_by_role("button", name="Prepare evidence export")
                if export_btn.count():
                    export_btn.first.click()
                    live.wait(page, 120, 1.0)
                    results["export_gov"] = {"download_button": page.get_by_role("button", name="Download review evidence").count() > 0}
                live.shot(page, "22-ai-activity-plans-export", tall=True)
                results["gov_errors"] = live.errors_on_page(page)
            finally:
                ctx.close()
            # evidence export as the mentor, with the file itself checked
            ctx, page = live.open(browser)
            try:
                live.sign_in(page, live.spec("mentor1", "Mentor", "MENTOR1"))
                live.goto_page(page, "Support reviews")
                live.goto_tab(page, "Plans & agent runs")
                button = page.get_by_role("button", name="Prepare evidence export")
                results["export_button_present"] = button.count() > 0
                if button.count():
                    button.first.click()
                    live.wait(page, 120, 1.0)
                    download = page.get_by_role("button", name="Download review evidence").first
                    results["download_button_present"] = download.count() > 0
                    live.shot(page, "23-mentor-evidence-export", tall=True)
                    with page.expect_download(timeout=60000) as info:
                        download.click()
                    path = OUT / "evidence-export.json"
                    info.value.save_as(path)
                    data = json.loads(path.read_text())
                    results["export_file"] = {
                        "bytes": path.stat().st_size,
                        "keys": sorted(data.keys())[:12],
                        "has_plan_id": state["plan"]["id"] in json.dumps(data),
                        "jobs": len(data.get("jobs") or []),
                    }
            finally:
                ctx.close()
        finally:
            browser.close()

    results["after"] = snapshot(core)
    results["before"] = state.get("baseline")
    state["views"] = results
    note(state, "views done: " + json.dumps({k: v for k, v in results.items() if k in ("student_home", "parent_home", "after")}, default=str)[:600])
    save_state(state)


# --------------------------------------------------------------------------- main
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stage", choices=["baseline", "plan", "inspect", "decide", "views", "retry", "all"], default="all")
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), default="pass2")
    parser.add_argument("--base-url", default="http://127.0.0.1:8503")
    parser.add_argument("--resume", action="store_true", help="plan stage: continue the plan already in state.json instead of creating one")
    parser.add_argument("--dry", action="store_true", help="plan stage: fill the form and stop before saving")
    parser.add_argument("--run-timeout", type=int, default=900, help="seconds to wait for Run review to return")
    args = parser.parse_args()
    if ":8502" in args.base_url:
        raise SystemExit("port 8502 belongs to another session; use 8503")
    configure(args.scenario)
    state = load_state()
    live = Live(args.base_url)
    core = Core(live.env)
    stages = ["baseline", "plan", "retry", "inspect", "decide", "views"] if args.stage == "all" else [args.stage]
    try:
        for stage in stages:
            note(state, f"== stage {stage}")
            if stage == "baseline":
                stage_baseline(state, core)
            elif stage == "plan":
                stage_plan(state, live, core, args.dry, args.run_timeout, args.resume)
            elif stage == "retry":
                stage_retry(state, live, core, args.run_timeout)
            elif stage == "inspect":
                stage_inspect(state, live, core)
            elif stage == "decide":
                stage_decide(state, live, core)
            elif stage == "views":
                stage_views(state, live, core)
    finally:
        core.close()
        save_state(state)
    print(f"state: {STATE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
