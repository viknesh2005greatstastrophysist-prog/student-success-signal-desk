"""Offline check (rework 1): who can reach which page, and that no drop-down can be typed into.

No server, database or credential is involved."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from streamlit.testing.v1 import AppTest  # noqa: E402

# --- Pages per workspace (URL path -> title), from the registry the app builds.
# st.Page only exists inside a script run, so build it in one.
REGISTRY = """
import sys
sys.path.insert(0, {app!r})
import streamlit as st
from views.pages import pages_for
st.session_state["pages"] = {{
    portal: [[getattr(p, "aura_path", p.url_path), p.title, bool(getattr(p, "aura_home", p._default))] for p in pages_for(portal)]
    for portal in ("student", "parent", "faculty", "hod", "governance", "lms")
}}
"""
at = AppTest.from_string(REGISTRY.format(app=str(Path(__file__).resolve().parent)), default_timeout=30).run()
assert not at.exception, [e.message for e in at.exception]
RAW = at.session_state["pages"]
PAGES = {portal: {path: title for path, title, _ in rows} for portal, rows in RAW.items()}
assert list(PAGES["student"].values()) == ["Overview", "Courses", "Learning", "My support plan", "Profile"], PAGES["student"]
assert list(PAGES["parent"].values()) == ["Overview", "Support plan and mentor updates", "Fees and receipts", "Profile"]
assert list(PAGES["faculty"].values()) == ["Today", "Mentees", "Reviews", "Classroom"]
assert list(PAGES["hod"].values()) == ["Overview", "Students", "Reviews", "Mentors", "Policies"]
assert list(PAGES["hod"]) == ["overview", "students", "reviews", "mentors", "policies"]
assert list(PAGES["governance"].values()) == ["Runs", "Agent graph", "Evaluation", "Audit and replay"]
# Every page has its own URL, and each workspace has exactly one landing page.
for portal, pages in PAGES.items():
    assert len(set(pages)) == len(pages), portal
    assert sum(1 for _, _, default in RAW[portal] if default) == 1, portal

# --- The student never reaches fees; neither the student nor the parent reaches source records.
for portal in ("student", "parent"):
    titles = " ".join(PAGES[portal].values()).lower() + " " + " ".join(PAGES[portal])
    assert "source" not in titles, (portal, titles)
assert not any("fee" in t.lower() for t in PAGES["student"].values()), PAGES["student"]
assert not any("fee" in path for path in PAGES["student"]), PAGES["student"]
assert "fees" in PAGES["parent"]

# Source records are evidence inside the staff profiles only.
from views.profile import HOD_SECTIONS, MENTOR_SECTIONS  # noqa: E402

assert "Source records" in MENTOR_SECTIONS and "Source records" in HOD_SECTIONS
# Owner decision (17 Oct): the department head sees everything a mentor sees.
assert "Signals" in MENTOR_SECTIONS and "Signals" in HOD_SECTIONS

# --- Pickers: short lists are segmented; long lists are a drop-down that cannot be typed into.
SCRIPT = """
import sys
sys.path.insert(0, {app!r})
import streamlit as st
from common import pick, pick_many
short = pick("Short", ["a", "b", "c"], key="short")
mid = pick("Middle", [str(i) for i in range(9)], key="mid")
long = pick("Long", [f"Student {{i}}" for i in range(30)], key="long")
rows = pick("Rows", [{{"id": 1}}, {{"id": 2}}], format_func=lambda r: str(r["id"]), key="rows")
empty_choice = pick("Focus", [None, "x", "y"], format_func=lambda v: "Choose" if v is None else v, key="focus")
many = pick_many("Many", [f"S{{i}}" for i in range(30)], key="many")
st.session_state["done"] = True
"""
at = AppTest.from_string(SCRIPT.format(app=str(Path(__file__).resolve().parent)), default_timeout=30).run()
assert not at.exception, [e.message for e in at.exception]
assert [w.label for w in at.segmented_control] == ["Short"], [w.label for w in at.segmented_control]
labels_selectbox = [w.label for w in at.selectbox]
assert labels_selectbox == ["Middle", "Long", "Rows", "Focus"], labels_selectbox
NO_TYPING = 3  # SelectWidgetFilterMode None: typing is disabled
for box in [*at.selectbox, *at.multiselect]:
    assert box.proto.filter_mode == NO_TYPING, (box.label, box.proto.filter_mode)
# Long lists get their own search box (and short ones do not).
searches = [t.label for t in at.text_input]
assert "Search long" in searches and "Search many" in searches and "Search short" not in searches, searches
print('{"status": "passed", "check": "navigation and pickers"}')
