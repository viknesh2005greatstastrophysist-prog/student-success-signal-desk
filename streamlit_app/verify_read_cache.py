"""Offline AppTest check (audit 0.6): load() serves worker reads from a 30 s
per-session cache, keyed by action and data; writes are never cached and clear
it; sign-out and an expired session clear it. A fake transport stands in for the
college engine, so no database, account or credential is involved."""

from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parent

PRELUDE = f"""
import sys
import streamlit as st
sys.path.insert(0, {str(APP)!r})
source = open({str(APP / "app.py")!r}).read().rsplit("\\nmain()", 1)[0]
ns = {{"__name__": "read_cache_check", "__file__": {str(APP / "app.py")!r}}}
exec(compile(source, "app.py", "exec"), ns)


class Transport:
    def __init__(self):
        self.calls = []
        self.expired = False

    def request(self, action, data=None, token=None):
        self.calls.append(action)
        if self.expired:
            raise ns["BridgeError"]("Session ended.", "UNAUTHENTICATED", 401)
        return {{"action": action, "data": data or {{}}, "n": len(self.calls)}}

    def logout(self, token):
        self.calls.append("logout")


class Clock:
    now = 1000.0

    def monotonic(self):
        return self.now


transport, clock = Transport(), Clock()
ns["get_client"] = lambda: transport
ns["time"] = clock
st.rerun = lambda: None  # sign-out and save_action rerun the page; stay in this run
load, save_action, KEY = ns["load"], ns["save_action"], ns["READ_CACHE_KEY"]
st.session_state["token"] = "opaque-test-token"


def count(action):
    return transport.calls.count(action)


"""

MAIN = """
# A second load inside the window makes no worker call and returns a fresh copy.
first = load("review_overview")
second = load("review_overview")
assert count("review_overview") == 1, transport.calls
second["n"] = 99
assert load("review_overview")["n"] == 1, "a caller's mutation must not reach the cache"
# The key includes the data; key order does not matter.
load("student", {"studentId": "a"})
load("student", {"studentId": "b"})
load("student", {"studentId": "a"})
assert count("student") == 2, transport.calls
load("lms_course", {"courseId": "c", "x": 1})
load("lms_course", {"x": 1, "courseId": "c"})
assert count("lms_course") == 1
# Entries expire after 30 s.
clock.now += 29
load("review_overview")
assert count("review_overview") == 1
clock.now += 2
load("review_overview")
assert count("review_overview") == 2
# Reads outside the allowlist are never cached.
load("not_a_read")
load("not_a_read")
assert count("not_a_read") == 2
# A write goes to the worker every time and clears the cache.
assert KEY in st.session_state
save_action("replay", {"runId": "r"}, "Replayed.")
assert KEY not in st.session_state
save_action("replay", {"runId": "r"}, "Replayed.")
assert count("replay") == 2
load("review_overview")
assert count("review_overview") == 3, "a read after a write must not be stale"
# Sign-out clears everything.
transport.expired = False
st.session_state["token"] = "opaque-test-token"
load("review_overview")
assert KEY in st.session_state
ns["sign_out"]()
assert KEY not in st.session_state and "token" not in st.session_state
st.session_state["cache_check_passed"] = True
"""

EXPIRED = """
# An expired session: the 401 clears the token and the cache, then st.stop() ends the run.
load("review_overview")
assert KEY in st.session_state
transport.expired = True
clock.now += 31
load("review_overview")
st.session_state["unreachable"] = True
"""

at = AppTest.from_string(PRELUDE + MAIN, default_timeout=30).run()
assert not at.exception, [e.message for e in at.exception]
assert at.session_state["cache_check_passed"]

at = AppTest.from_string(PRELUDE + EXPIRED, default_timeout=30).run()
assert not at.exception, [e.message for e in at.exception]
assert "unreachable" not in at.session_state, "st.stop() must end the run"
assert "token" not in at.session_state and "worker_read_cache" not in at.session_state
assert any("session has ended" in w.value for w in at.warning)
print('{"status": "passed", "check": "worker read cache"}')
