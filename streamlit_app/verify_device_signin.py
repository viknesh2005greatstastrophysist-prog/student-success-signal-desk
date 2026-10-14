"""Offline check of the sign-in conveniences (C7): remembered devices, the
password-manager form and the local test-accounts panel.

A stand-in client stands in for the engine and synthetic fixtures stand in for the
private .env (no database, no engine, no credential, no model call). It checks:

  * the form carries the standard autocomplete tokens and "Keep me signed in" is on;
  * a remembered device signs in without the form, writes the rotated token as a cookie
    (Secure, SameSite=Strict, Path=/, seven days) and never a password;
  * dead tokens are dropped and their cookies cleared; the form is shown;
  * "Sign out" revokes (forget) and clears the cookie and does not sign back in alone;
    "Switch workspace" keeps the token and offers the workspace on the sign-in page;
  * the Test accounts panel exists only for AURA_LOCAL_PROJECT=1 on 127.0.0.1 or
    localhost, never behind a proxy, never offers student or parent 021, and a
    password is never rendered.
"""

import json
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("AURA_DISABLE_WARMUP", "1")

import streamlit as st  # noqa: E402
from streamlit.testing.v1 import AppTest  # noqa: E402

import auth  # noqa: E402
import device  # noqa: E402
import local_accounts  # noqa: E402
import views.pages  # noqa: E402
from bridge import BridgeError  # noqa: E402

TOKEN_A = "A" * 43
TOKEN_B = "B" * 43
TOKEN_H = "H" * 43
PASSWORDS = {"pw-mentor-1", "pw-hod", "pw-student-001", "pw-student-002", "pw-student-003", "pw-student-021", "pw-parent-021", "pw-student-050"}
ENV_TEXT = "\n".join(
    [
        "AURA_LOCAL_PROJECT=1",
        "AURA_LOGIN_HOD_EMAIL=hod@example.test",
        "AURA_LOGIN_HOD_PASSWORD=pw-hod",
        "AURA_LOGIN_MENTOR1_EMAIL=mentor1@example.test",
        "AURA_LOGIN_MENTOR1_PASSWORD=pw-mentor-1",
        "AURA_LOGIN_STUDENT001_EMAIL=s1@example.test",
        "AURA_LOGIN_STUDENT001_PASSWORD=pw-student-001",
        "AURA_LOGIN_STUDENT002_EMAIL=s2@example.test",
        "AURA_LOGIN_STUDENT002_PASSWORD=pw-student-002",
        "AURA_LOGIN_STUDENT003_EMAIL=s3@example.test",
        "AURA_LOGIN_STUDENT003_PASSWORD=pw-student-003",
        "AURA_LOGIN_STUDENT021_EMAIL=s21@example.test",
        "AURA_LOGIN_STUDENT021_PASSWORD=pw-student-021",
        "AURA_LOGIN_PARENT021_EMAIL=p21@example.test",
        "AURA_LOGIN_PARENT021_PASSWORD=pw-parent-021",
        "AURA_LOGIN_STUDENT050_EMAIL=s50@example.test",
        "AURA_LOGIN_STUDENT050_PASSWORD=pw-student-050",
        "AURA_LOGIN_STUDENT099_EMAIL=orphan@example.test",  # no password: not an account
    ]
)
workdir = Path(tempfile.mkdtemp(prefix="aura-c7-"))
fake_env = workdir / ".env"
fake_env.write_text(ENV_TEXT)
local_accounts.env_file = lambda: fake_env


class Headers(dict):
    """Case-insensitive like the real request headers."""

    def __init__(self, items):
        super().__init__({k.lower(): v for k, v in items.items()})

    def get(self, key, default=None):
        return super().get(key.lower(), default)


def use_request(host="127.0.0.1:8503", cookies=None, **extra):
    st.context = SimpleNamespace(
        headers=Headers({"Host": host, **extra}), cookies=dict(cookies or {}), ip_address="127.0.0.1"
    )


class Stub:
    """Records every call; answers like the engine."""

    def __init__(self):
        self.calls = []
        self.resume_answer = {"remembered": [], "invalid": []}

    def login(self, email, password, portal, remember=False):
        self.calls.append(("login", portal, email, remember))
        if password not in PASSWORDS:
            raise BridgeError("Check your account email and password", "UNAUTHENTICATED", 401)
        answer = {
            "token": "S" * 43,
            "actor": {"role": {"faculty": "faculty", "hod": "hod", "student": "student", "parent": "parent"}[portal], "displayName": "Test Person", "email": email},
        }
        if remember:
            answer["deviceToken"] = {"token": TOKEN_H, "expiresAt": "2026-10-22T00:00:00.000Z"}
        return answer

    def device_resume(self, tokens, auto):
        self.calls.append(("device_resume", dict(tokens), auto))
        answer = dict(self.resume_answer)
        if not auto:
            answer.pop("resumed", None)  # the engine only opens a workspace when asked to
        return answer

    def device_login(self, portal, token):
        self.calls.append(("device_login", portal, token))
        return {"portal": portal, "token": "T" * 43, "actor": {"role": "faculty", "displayName": "Test Mentor", "email": "m@example.test"}, "deviceToken": {"token": TOKEN_B, "expiresAt": "x"}}

    def logout(self, token, *, forget=True, device_token=None):
        self.calls.append(("logout", forget, device_token))
        return {"signedOut": True}


stub = Stub()
auth.get_client = lambda: stub


def fake_pages(portal):  # the signed-in page contents are not under test here
    return [st.Page(lambda: st.write("home"), title="Home", url_path="home", default=True)]


views.pages.pages_for = fake_pages


def run(**request):
    stub.calls.clear()
    use_request(**request)
    at = AppTest.from_file(str(Path(__file__).resolve().parent / "app.py"), default_timeout=30)
    return at.run()


def whole_page(at) -> str:
    from google.protobuf.json_format import MessageToJson

    seen = []

    def walk(node):
        proto = getattr(node, "proto", None)
        if proto is not None and hasattr(proto, "DESCRIPTOR"):
            seen.append(MessageToJson(proto))
        for child in getattr(node, "children", {}).values():
            walk(child)

    walk(at.main)
    walk(at.sidebar)
    return "\n".join(seen)


def labels(at) -> list[str]:
    return [b.label for b in at.button]


def no_exception(at, what):
    assert not at.exception, (what, [e.message for e in at.exception])


def cookie_writes(at) -> list[dict]:
    """The cookie operations the page carries (the JSON handed to the cookie script)."""
    out = []
    for html in at.get("html"):
        body = html.proto.body
        if "document.cookie" in body:
            out.extend(json.loads(body.rsplit(")(", 1)[1].rsplit(");</script>", 1)[0]))
    return out


# ---------------------------------------------------------------- form: autocomplete, checkbox
at = run()
no_exception(at, "sign-in page")
fields = {t.label: t for t in at.text_input}
assert fields["Email"].proto.autocomplete == "username", fields["Email"].proto.autocomplete
assert fields["Password"].proto.autocomplete == "current-password"
assert fields["Password"].proto.type == 1 or "assword" in fields["Password"].label
box = at.checkbox[0]
assert box.label == "Keep me signed in on this device" and box.value is True
assert "Continue" in labels(at), "sign-in form renders"
assert stub.calls == [], "a browser with no remembered device costs no engine call"

# ---------------------------------------------------------------- local panel gating
use_request("127.0.0.1:8503")
accounts = local_accounts.fixture_accounts()
assert [a.prefix for a in accounts] == ["HOD", "MENTOR1", "STUDENT001", "STUDENT002", "STUDENT003", "STUDENT050"], accounts
assert all("021" not in a.prefix and "021" not in a.label for a in accounts)
assert local_accounts.credentials("STUDENT021") is None and local_accounts.credentials("PARENT021") is None
assert local_accounts.credentials("STUDENT099") is None, "no password: not an account"
assert local_accounts.credentials("MENTOR1") == ("mentor1@example.test", "pw-mentor-1")

for host, expect in [
    ("127.0.0.1:8503", True), ("localhost:8503", True), ("LOCALHOST", True), ("[::1]:8503", True),
    ("example.com", False), ("aura-ui.streamlit.app", False), ("localhost.evil.com", False),
    ("127.0.0.1.evil.com:8503", False), ("0.0.0.0:8503", False), ("", False),
]:
    assert local_accounts.is_local_request(Headers({"Host": host})) is expect, host
for proxy in ("x-forwarded-for", "x-forwarded-host", "forwarded", "x-real-ip"):
    assert local_accounts.is_local_request(Headers({"Host": "localhost:8503", proxy: "203.0.113.9"})) is False, proxy

at = run()
page = whole_page(at)
assert "Test accounts" in page and {"Department head", "Mentor 1", "Student 001"} <= set(labels(at)), labels(at)
assert "021" not in page and not any(p in page for p in PASSWORDS), "no 021 account, no password in the page"
more = [s for s in at.selectbox if s.key == "local_more"][0]
assert [o.label if hasattr(o, "label") else str(o) for o in more.options] and "050" in str(more.options) and "021" not in str(more.options), more.options

for what, kwargs, env in [
    ("flag off", {}, "0"),
    ("flag empty", {}, ""),
    ("not a local host", {"host": "aura.example.com"}, "1"),
    ("behind a proxy", {"host": "localhost:8503", "X-Forwarded-For": "203.0.113.9"}, "1"),
]:
    os.environ["AURA_LOCAL_PROJECT"] = env
    at = run(**kwargs)
    assert "Test accounts" not in whole_page(at) and "Mentor 1" not in labels(at), what
os.environ["AURA_LOCAL_PROJECT"] = "1"
fake_env.rename(workdir / "gone")
at = run()
assert "Test accounts" not in whole_page(at), "no .env, no panel (the hosted app)"
(workdir / "gone").rename(fake_env)

# One click signs in, remembered, with the credential read on the server.
at = run()
at.button(key="local_MENTOR1").click().run()
no_exception(at, "test account sign-in")
assert ("login", "faculty", "mentor1@example.test", True) in stub.calls, stub.calls
assert at.session_state["token"] and at.session_state["actor"]["portal"] == "faculty"
writes = cookie_writes(at)
assert writes == [{"name": "aura_dev_faculty", "value": TOKEN_H, "maxAge": 604800}], writes
assert not any(p in whole_page(at) for p in PASSWORDS)

# ---------------------------------------------------------------- the form sign-in and its cookie
at = run()
at.text_input[0].set_value("hod@example.test")
at.text_input[1].set_value("pw-hod")
at.run()  # (a form: nothing is sent until the button)
[b for b in at.button if b.label == "Continue"][0].click().run()
no_exception(at, "form sign-in")
login_calls = [c for c in stub.calls if c[0] == "login"]
assert login_calls and login_calls[0][3] is True, "remember defaults to on"

# ---------------------------------------------------------------- a remembered device skips the form
cookies = {"aura_dev_faculty": TOKEN_A, "unrelated": "x"}
stub.resume_answer = {
    "resumed": {"portal": "faculty", "token": "R" * 43, "actor": {"role": "faculty", "displayName": "Test Mentor", "email": "m@example.test"}, "deviceToken": {"token": TOKEN_B, "expiresAt": "x"}},
    "remembered": [],
    "invalid": [],
}
at = run(cookies=cookies)
no_exception(at, "resume")
assert stub.calls == [("device_resume", {"faculty": TOKEN_A}, True)], stub.calls
assert at.session_state["token"] == "R" * 43 and at.session_state["actor"]["portal"] == "faculty"
assert "Continue" not in labels(at), "no form once signed back in"
assert cookie_writes(at) == [{"name": "aura_dev_faculty", "value": TOKEN_B, "maxAge": 604800}], "the rotated token replaces the cookie"
assert at.session_state["_device_tokens"]["faculty"] == TOKEN_B

# A token the engine no longer accepts: form shown, cookie cleared, nothing signed in.
stub.resume_answer = {"remembered": [], "invalid": ["faculty"]}
at = run(cookies=cookies)
no_exception(at, "dead token")
assert not at.session_state["token"] if "token" in at.session_state else True
assert "Continue" in labels(at), "the form is shown"
assert cookie_writes(at) == [{"name": "aura_dev_faculty", "value": None, "maxAge": 604800}], "the dead cookie is cleared"

# The engine cannot answer: form shown, nothing forgotten.
class Down(Stub):
    def device_resume(self, tokens, auto):
        raise BridgeError("The college engine stopped.", "ENGINE_STOPPED")

auth.get_client = lambda: Down()
at = run(cookies=cookies)
assert "Continue" in labels(at) and cookie_writes(at) == [], "an outage forgets nothing"
auth.get_client = lambda: stub

# ---------------------------------------------------------------- sign out and switch workspace
stub.resume_answer = {
    "resumed": {"portal": "faculty", "token": "R" * 43, "actor": {"role": "faculty", "displayName": "Test Mentor", "email": "m@example.test"}, "deviceToken": {"token": TOKEN_B, "expiresAt": "x"}},
    "remembered": [{"portal": "hod", "displayName": "Dr Test Head", "lastUsedAt": "x"}],
    "invalid": [],
}
cookies = {"aura_dev_faculty": TOKEN_A, "aura_dev_hod": TOKEN_H}

at = run(cookies=cookies)
stub.calls.clear()
signout = [b for b in at.sidebar.button if b.label == "Sign out"][0]
signout.click().run()
no_exception(at, "sign out")
assert stub.calls[0] == ("logout", True, TOKEN_B), stub.calls  # revokes, naming this session's latest token
assert at.session_state["_no_resume"] is True
assert "Continue" in labels(at), "back at the form"
assert ("device_resume", {"hod": TOKEN_H}, False) in stub.calls, "the other workspace is checked, not opened"
assert not any(c == ("device_resume", {"hod": TOKEN_H}, True) for c in stub.calls), "sign out never signs back in alone"
assert {"name": "aura_dev_faculty", "value": None, "maxAge": 604800} in cookie_writes(at), "sign out clears the cookie"
assert "Dr Test Head" in whole_page(at), "the other remembered workspace is offered"

at = run(cookies=cookies)
stub.calls.clear()
switch = [b for b in at.sidebar.button if b.label == "Switch workspace"][0]
switch.click().run()
no_exception(at, "switch workspace")
assert stub.calls[0] == ("logout", False, None), stub.calls  # keeps the device tokens
assert "Continue" in labels(at)
assert not any(w["value"] is None for w in cookie_writes(at)), "switching clears no cookie"
assert at.session_state["_device_tokens"]["faculty"] == TOKEN_B
chip = [b for b in at.button if "Dr Test Head" in b.label]
assert chip, labels(at)
chip[0].click().run()
assert ("device_login", "hod", TOKEN_H) in stub.calls

# ---------------------------------------------------------------- cookie script
use_request()
js_at = AppTest.from_string(
    "import sys; sys.path.insert(0, %r)\nimport device\ndevice.remember('hod', {'token': %r})\ndevice.remember('hod', {'token': 'not-a-token'})\ndevice.flush_cookies()"
    % (str(Path(__file__).resolve().parent), TOKEN_H),
    default_timeout=30,
).run()
body = [h.proto.body for h in js_at.get("html")][0]
for needle in ("SameSite=Strict", "Path=/", "Secure", "Max-Age=", "location.protocol === 'https:'", TOKEN_H):
    assert needle in body, needle
assert "HttpOnly" not in body and body.count("</script") == 1, "the script cannot be closed early"
assert "not-a-token" not in body, "only a well-formed token is ever written"
assert device.cookie_name("faculty") == "aura_dev_faculty"

print("verify_device_signin: all checks passed")
