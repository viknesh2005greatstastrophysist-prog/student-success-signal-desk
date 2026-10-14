"""Remembered devices: the browser half of "Keep me signed in on this device".

The engine hands the page a random token for a workspace sign-in (only its hash is
stored in the database). The page keeps it in one cookie per workspace,
`aura_dev_<workspace>`, so a reload or a new tab can open that workspace without the
form. A password is never put in a cookie.

Streamlit gives a script the cookies of the request that opened the session
(`st.context.cookies`, read-only), and no API to set one, so a cookie is written by a
few lines of script in an `st.html` element. A cookie written from script cannot be
HttpOnly; the token is therefore random, bound to one account and workspace, rotated
on every use, expires after seven days and is revoked on sign-out (see
`docs/WORK_STATUS.md`).
"""

from __future__ import annotations

import json
import re
from typing import Any

import streamlit as st
from common import PORTALS

COOKIE_PREFIX = "aura_dev_"
MAX_AGE_SECONDS = 7 * 24 * 60 * 60
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{43}$")  # 32 random bytes as base64url

# Session-state keys that survive "Sign out" and "Switch workspace", which clear the rest.
TOKENS = "_device_tokens"  # workspace -> latest token (None: forgotten)
OPS = "_cookie_ops"  # cookie writes waiting for the next page draw
NO_RESUME = "_no_resume"  # the person just left a workspace: do not sign back in alone
SCAN = "_device_scan"  # last answer of the engine about the tokens above
KEEP = (TOKENS, OPS, NO_RESUME, SCAN)

# Runs in the page. `Secure` always on https and on a local address (Chrome and Firefox
# accept it on http://localhost); Safari refuses a Secure cookie over plain http, so on
# a local address a cookie that did not stick is written again without it.
_SCRIPT = """(function (ops) {
  var local = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname);
  var secure = location.protocol === 'https:' || local;
  ops.forEach(function (op) {
    var base = op.name + '=' + (op.value || '') + '; Path=/; SameSite=Strict; Max-Age=' + (op.value ? op.maxAge : 0);
    document.cookie = base + (secure ? '; Secure' : '');
    if (op.value && secure && location.protocol !== 'https:' && document.cookie.indexOf(op.name + '=') < 0) document.cookie = base;
  });
})"""


def cookie_name(workspace: str) -> str:
    return f"{COOKIE_PREFIX}{workspace}"


def browser_tokens() -> dict[str, str]:
    """The tokens the browser sent when this session opened (the cookie jar can have
    moved on since: `known_tokens` prefers what this session has learned)."""
    try:
        cookies = st.context.cookies
    except Exception:  # noqa: BLE001 -- no request context (for example a script test)
        return {}
    found = {}
    for workspace in PORTALS:
        token = cookies.get(cookie_name(workspace))
        if isinstance(token, str) and _TOKEN.match(token):
            found[workspace] = token
    return found


def known_tokens() -> dict[str, str]:
    held: dict[str, Any] = {**browser_tokens(), **st.session_state.get(TOKENS, {})}
    return {w: t for w, t in held.items() if isinstance(t, str) and _TOKEN.match(t)}


def _queue(workspace: str, token: str | None) -> None:
    ops = st.session_state.setdefault(OPS, [])
    ops.append({"name": cookie_name(workspace), "value": token, "maxAge": MAX_AGE_SECONDS})


def remember(workspace: str, issued: dict[str, Any]) -> None:
    """Store the token the engine just issued (or rotated) for a workspace."""
    token = issued.get("token")
    if workspace in PORTALS and isinstance(token, str) and _TOKEN.match(token):
        st.session_state.setdefault(TOKENS, {})[workspace] = token
        _queue(workspace, token)


def forget(workspace: str) -> None:
    """Drop the token of a workspace and clear its cookie."""
    if workspace in PORTALS:
        st.session_state.setdefault(TOKENS, {})[workspace] = None
        _queue(workspace, None)


def flush_cookies() -> None:
    """Write the waiting cookie changes. The element is invisible (display: none) and
    only exists on the run that carries the change."""
    ops = st.session_state.pop(OPS, None)
    if not ops:
        return
    latest = {op["name"]: op for op in ops}  # the last write per cookie wins
    payload = json.dumps(list(latest.values())).replace("</", "<\\/")
    with st.container(key="cookie_sink"):
        st.html(f"<script>({_SCRIPT})({payload});</script>", unsafe_allow_javascript=True)
