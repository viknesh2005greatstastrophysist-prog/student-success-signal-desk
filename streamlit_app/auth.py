from __future__ import annotations

import hashlib
import json
import subprocess
from typing import Any

import device
import labels
import local_accounts
import streamlit as st
import ui
from bridge import BridgeError, get_client, warm_in_background
from common import (
    PORTALS,
    PORTAL_ROLES,
    clear_read_cache,
    display_name,
    value,
)


def login_view() -> None:
    """A calm sign-in card on the page colour: the form is the first thing you see."""
    ui.hide_sidebar()
    with st.container(key="login_shell"):
        with st.container(key="login_panel"):
            ui.login_head()
            # A remembered device signs straight in (the rerun below); otherwise the
            # workspaces it still remembers are offered above the form.
            remembered = resume_remembered()
            offer_remembered(remembered)
            # The workspace control lives inside the form so changing it never reruns the
            # page: a typed email and password survive the switch (E2E #4). The form is a
            # real st.form with the standard autocomplete tokens, so a password manager
            # offers to save and fill the account.
            with st.form("sign_in", clear_on_submit=True, border=False):
                portal = st.segmented_control(
                    "Workspace",
                    list(PORTALS),
                    default="student",
                    required=True,
                    format_func=lambda key: PORTALS[key],
                    key="login_workspace",
                )
                email = st.text_input(
                    "Email", autocomplete="username", placeholder="name@college.edu"
                )
                password = st.text_input(
                    "Password", type="password", autocomplete="current-password"
                )
                remember = st.checkbox(
                    "Keep me signed in on this device", value=True, key="login_remember"
                )
                submitted = st.form_submit_button(
                    "Continue", type="primary", width="stretch"
                )
            st.caption(
                "Use your college account. You will only see what your role allows."
            )
        local_accounts.panel(
            lambda workspace, mail, secret: complete_sign_in(
                workspace, mail, secret, remember=True
            )
        )
        if submitted:
            complete_sign_in(portal, email, password, remember=remember)
        else:
            # Start the engine and open its database connections while the person
            # types; the page has already been drawn and does not wait for this.
            warm_in_background()
    device.flush_cookies()


def _engine_problem(error: Exception) -> str:
    if isinstance(error, BridgeError):
        return str(error)
    return "The workspace could not start. Check its private runtime configuration and try again."


ENGINE_ERRORS = (BridgeError, OSError, ValueError, RuntimeError, subprocess.SubprocessError)


def resume_remembered() -> list[dict[str, Any]]:
    """Ask the engine about the tokens this browser holds. A remembered device signs in
    without the form (unless the person just left a workspace); the answer is kept so
    the page does not ask again until the tokens change."""
    tokens = device.known_tokens()
    if not tokens:
        return []
    signature = hashlib.sha256(json.dumps(sorted(tokens.items())).encode()).hexdigest()
    scan = st.session_state.get(device.SCAN)
    if scan and scan["signature"] == signature:
        return scan["remembered"]
    auto = not st.session_state.get(device.NO_RESUME)
    try:
        with st.spinner("Signing you in…" if auto else "Checking this device…"):
            result = get_client().device_resume(tokens, auto)
    except ENGINE_ERRORS:
        # The engine could not answer: show the form; nothing is forgotten.
        st.session_state[device.SCAN] = {"signature": signature, "remembered": []}
        return []
    for workspace in result.get("invalid", []):
        device.forget(workspace)
    if result.get("resumed"):
        finish_sign_in(result["resumed"], result["resumed"]["portal"])
    remembered = result.get("remembered", [])
    st.session_state[device.SCAN] = {
        "signature": hashlib.sha256(
            json.dumps(sorted(device.known_tokens().items())).encode()
        ).hexdigest(),
        "remembered": remembered,
    }
    return remembered


def offer_remembered(remembered: list[dict[str, Any]]) -> None:
    if not remembered:
        return
    st.caption("Continue where you left off")
    for item in remembered:
        workspace = item["portal"]
        name = labels.pretty_name(item.get("displayName") or "")
        label = f"{name} · {PORTALS[workspace]}" if name else PORTALS[workspace]
        if st.button(label, key=f"resume_{workspace}", width="stretch"):
            open_remembered(workspace)


def open_remembered(workspace: str) -> None:
    token = device.known_tokens().get(workspace)
    try:
        if not token:
            raise BridgeError("Sign in with your email and password.", "UNAUTHENTICATED", 401)
        with st.spinner("Signing in…"):
            result = get_client().device_login(workspace, token)
    except ENGINE_ERRORS as error:
        device.forget(workspace)
        st.session_state.pop(device.SCAN, None)
        st.error(_engine_problem(error))
        return
    finish_sign_in(result, workspace)


def complete_sign_in(
    portal: str | None, email: str, password: str, remember: bool = False
) -> None:
    if not portal:
        st.error("Choose the workspace you want to open.")
        return
    if not email.strip() or not password:
        st.error("Enter your email and password.")
        return
    try:
        with st.spinner("Signing in…"):
            result = get_client().login(email.strip(), password, portal, remember)
    except ENGINE_ERRORS as error:
        st.error(_engine_problem(error))
        return
    actor = result.get("actor") or {}
    role = value(actor, "role")
    if role not in PORTAL_ROLES[portal]:
        try:
            get_client().logout(result["token"])
        except BridgeError:
            st.caption("The temporary session could not be closed automatically.")
        st.error("This account cannot enter the selected workspace.")
        return
    if not remember and portal in device.known_tokens():
        device.forget(portal)  # an explicit sign-in without "keep me" drops the old cookie
    finish_sign_in(result, portal)


def finish_sign_in(result: dict[str, Any], portal: str) -> None:
    # Keep only the opaque session token and the authenticated actor in session state.
    clear_read_cache()
    st.session_state.pop("success_notice", None)
    st.session_state.pop(device.NO_RESUME, None)
    st.session_state.pop(device.SCAN, None)
    st.session_state["token"] = result["token"]
    st.session_state["actor"] = {**result.get("actor", {}), "portal": portal}
    if result.get("deviceToken"):
        device.remember(portal, result["deviceToken"])
    st.rerun()


def sign_out(forget: bool = True) -> None:
    """End the session. "Sign out" (forget) also forgets this device for the workspace:
    its token is revoked and its cookie cleared. "Switch workspace" keeps the token, so
    the workspace stays one click away on the sign-in page."""
    token = st.session_state.get("token")
    workspace = (st.session_state.get("actor") or {}).get("portal")
    if token:
        try:
            get_client().logout(
                token,
                forget=forget,
                device_token=device.known_tokens().get(workspace) if forget else None,
            )
        except BridgeError:
            pass
    clear_read_cache()
    if forget and workspace:
        device.forget(workspace)
    kept = {k: st.session_state[k] for k in device.KEEP if k in st.session_state}
    st.session_state.clear()
    st.session_state.update(kept)
    st.session_state[device.NO_RESUME] = True
    # Back to the sign-in page itself ("/"), not the sign-in form under the old page's address.
    st.switch_page(st.Page(login_view, title="Sign in", url_path="sign-in"))


def sign_in_sidebar(actor: dict[str, Any]) -> None:
    ui.brand()
    portal = actor.get("portal")
    ui.identity_card(
        labels.pretty_name(display_name(actor)),
        PORTALS.get(portal, "Workspace"),
        actor.get("email", ""),
    )


def sidebar_footer() -> None:
    if st.sidebar.button(
        "Switch workspace",
        width="stretch",
        icon=":material/swap_horiz:",
        help="Leave this workspace but stay remembered on this device.",
    ):
        sign_out(forget=False)
    if st.sidebar.button("Sign out", width="stretch", icon=":material/logout:"):
        sign_out()
