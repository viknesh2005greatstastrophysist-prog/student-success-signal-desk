from __future__ import annotations

import subprocess
from typing import Any

import labels
import streamlit as st
import ui
from bridge import BridgeError, get_client
from common import (
    PORTALS,
    PORTAL_ICONS,
    PORTAL_ROLES,
    clear_read_cache,
    display_name,
    value,
)


def login_view() -> None:
    """Split screen: ink hero on the left, the form on the right (stacked on a phone)."""
    ui.hide_sidebar()
    with st.container(key="login_shell"):
        ui.brand_panel()
        with st.container(key="login_panel"):
            st.html('<p class="aura-eyebrow">Welcome back</p>')
            st.header("Sign in to your *workspace*", anchor=False)
            st.caption(
                "Use your college account. You'll only see the records and tools your role allows."
            )
            # The workspace control lives inside the form so changing it never reruns the
            # page: a typed email and password survive the switch (E2E #4).
            with st.form("sign_in", clear_on_submit=True, border=False):
                portal = st.segmented_control(
                    "Workspace",
                    list(PORTALS),
                    default="student",
                    required=True,
                    format_func=lambda key: f"{PORTAL_ICONS[key]} {PORTALS[key]}",
                    key="login_workspace",
                )
                email = st.text_input(
                    "Email", autocomplete="email", placeholder="name@college.edu"
                )
                password = st.text_input(
                    "Password", type="password", autocomplete="current-password"
                )
                submitted = st.form_submit_button(
                    "Sign in", type="primary", width="stretch"
                )
            st.caption(
                ":material/lock: Sessions are private to your account and end when you sign out."
            )
        if submitted:
            complete_sign_in(portal, email, password)


def complete_sign_in(portal: str | None, email: str, password: str) -> None:
    if not portal:
        st.error("Choose the workspace you want to open.")
        return
    if not email.strip() or not password:
        st.error("Enter your email and password.")
        return
    try:
        with st.spinner("Signing in…"):
            result = get_client().login(email.strip(), password, portal)
    except BridgeError as error:
        st.error(str(error))
        return
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        st.error(
            "The workspace could not start. Check its private runtime configuration and try again."
        )
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
    # Keep only the opaque session token and the authenticated actor in session state.
    clear_read_cache()
    st.session_state.pop("success_notice", None)
    st.session_state["token"] = result["token"]
    st.session_state["actor"] = {**actor, "portal": portal}
    st.rerun()


def sign_out() -> None:
    token = st.session_state.get("token")
    if token:
        try:
            get_client().logout(token)
        except BridgeError:
            pass
    clear_read_cache()
    st.session_state.clear()
    st.rerun()


def sign_in_sidebar(actor: dict[str, Any]) -> None:
    ui.brand()
    portal = actor.get("portal")
    ui.identity_card(
        labels.pretty_name(display_name(actor)),
        PORTALS.get(portal, "Workspace"),
        actor.get("email", ""),
    )


def sidebar_footer() -> None:
    st.sidebar.divider()
    if st.sidebar.button("Sign out", width="stretch", icon=":material/logout:"):
        sign_out()
    st.sidebar.caption(
        "AURA · Student Success & Early Warning. Agents draft and flag; mentors decide."
    )
