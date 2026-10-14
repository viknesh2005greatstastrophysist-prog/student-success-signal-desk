"""One-click sign-in with the fixture accounts, for a developer's own machine only.

The panel exists only when the private runtime says it is local (`AURA_LOCAL_PROJECT`
is "1") and the page was opened at 127.0.0.1 or localhost. The hosted app has neither
the `.env` fixtures nor a local address. Student 021 and parent 021 (the case under
review) are never offered. A password is read on the server at the moment of the
click and goes straight to the sign-in call: it is never rendered, stored in session
state or used as a widget key or label.
"""

from __future__ import annotations

import os
import re
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import NamedTuple

import streamlit as st
from bridge import REPO, BridgeError, read_environment_file

LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "[::1]"})
# A proxy or tunnel in front of the server means the page is not a plain local one.
PROXY_HEADERS = ("x-forwarded-host", "x-forwarded-for", "x-forwarded-proto", "forwarded", "x-real-ip")
EXCLUDED = frozenset({"STUDENT021", "PARENT021"})
FEATURED_PEOPLE = 3  # students and parents with a button of their own; the rest are in a list


class Fixture(NamedTuple):
    prefix: str  # the AURA_LOGIN_<prefix>_EMAIL / _PASSWORD pair
    label: str
    portal: str


def host_name(host: str) -> str:
    host = host.strip().lower()
    if host.startswith("["):
        return host.split("]")[0] + "]"
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


def is_local_request(headers: Mapping[str, str] | None = None) -> bool:
    if headers is None:
        try:
            headers = st.context.headers
        except Exception:  # noqa: BLE001 -- no request context
            return False
    if any(headers.get(name) for name in PROXY_HEADERS):
        return False
    return host_name(headers.get("Host") or "") in LOCAL_HOSTS


def env_file() -> Path:
    return REPO / ".env"


def local_project(values: Mapping[str, str]) -> bool:
    flag = os.environ.get("AURA_LOCAL_PROJECT", values.get("AURA_LOCAL_PROJECT", ""))
    return str(flag) == "1"


def _read() -> dict[str, str]:
    try:
        return read_environment_file(env_file()) if env_file().is_file() else {}
    except (BridgeError, OSError, ValueError):
        return {}


def describe(prefix: str) -> tuple[str, str] | None:
    """(label, workspace) of a fixture prefix, or None when it is not a sign-in account."""
    if prefix in EXCLUDED or prefix.endswith("021"):
        return None
    if prefix == "HOD":
        return "Department head", "hod"
    if prefix == "OPERATIONS":
        return "AI activity", "governance"
    for pattern, noun, portal in (
        (r"MENTOR(\d+)", "Mentor", "faculty"),
        (r"STUDENT(\d+)", "Student", "student"),
        (r"PARENT(\d+)", "Parent", "parent"),
    ):
        match = re.fullmatch(pattern, prefix)
        if match:
            return f"{noun} {match.group(1).zfill(3) if portal != 'faculty' else int(match.group(1))}", portal
    return None


def fixture_accounts(values: Mapping[str, str] | None = None, headers: Mapping[str, str] | None = None) -> list[Fixture]:
    """The accounts to offer: empty unless this is a local project opened locally."""
    values = _read() if values is None else values
    if not local_project(values) or not is_local_request(headers):
        return []
    found = []
    for key in values:
        match = re.fullmatch(r"AURA_LOGIN_([A-Z]+\d*)_EMAIL", key)
        if not match or f"AURA_LOGIN_{match.group(1)}_PASSWORD" not in values:
            continue
        described = describe(match.group(1))
        if described:
            found.append(Fixture(match.group(1), *described))
    order = {"hod": 0, "governance": 1, "faculty": 2, "student": 3, "parent": 4}
    return sorted(found, key=lambda f: (order[f.portal], f.label))


def credentials(prefix: str) -> tuple[str, str] | None:
    """The fixture's email and password, only for an account the panel would offer."""
    values = _read()
    if prefix not in {f.prefix for f in fixture_accounts(values)}:
        return None
    return values.get(f"AURA_LOGIN_{prefix}_EMAIL", ""), values.get(f"AURA_LOGIN_{prefix}_PASSWORD", "")


def panel(sign_in: Callable[[str, str, str], None]) -> None:
    """The "Test accounts" card; `sign_in(workspace, email, password)` signs in."""
    accounts = fixture_accounts()
    if not accounts:
        return
    people = {"student": 0, "parent": 0}
    featured, others = [], []
    for account in accounts:
        if account.portal in people:
            people[account.portal] += 1
            (featured if people[account.portal] <= FEATURED_PEOPLE else others).append(account)
        else:
            featured.append(account)
    chosen: Fixture | None = None
    with st.container(key="login_local"):
        st.html('<p class="aura-local-title">Test accounts</p>')
        st.caption("This computer only. One click signs in with a fixture account.")
        for start in range(0, len(featured), 3):
            for column, account in zip(st.columns(3), featured[start : start + 3], strict=False):
                if column.button(account.label, key=f"local_{account.prefix}", width="stretch"):
                    chosen = account
        if others:
            pick = st.selectbox(
                "More accounts",
                others,
                index=None,
                format_func=lambda f: f"{f.label}",
                placeholder="Other students and parents",
                label_visibility="collapsed",
                key="local_more",
            )
            chosen = pick or chosen
    if chosen:
        secret = credentials(chosen.prefix)
        if secret:
            sign_in(chosen.portal, *secret)
