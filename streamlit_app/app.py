"""AURA entry point: sign in, then hand over to the signed-in role's pages.

Each page lives in `views/` and has its own URL; Streamlit runs only the page
being opened. Shared helpers are in `common.py` and `auth.py`.
"""

from __future__ import annotations

from pathlib import Path

import streamlit as st

import ui
import device
from auth import login_view, sidebar_footer, sign_in_sidebar
from common import PORTAL_ROLES
from views.pages import pages_for

st.set_page_config(
    page_title="AURA | Student Success",
    page_icon=str(Path(__file__).resolve().parent / "assets" / "aura-mark.svg"),
    layout="wide",
    initial_sidebar_state="auto",
)


def main() -> None:
    ui.inject_styles()
    actor = st.session_state.get("actor")
    if not actor or not st.session_state.get("token"):
        st.navigation(
            [st.Page(login_view, title="Sign in", url_path="sign-in", default=True)],
            position="hidden",
        ).run()
        return
    portal = actor.get("portal", "student")
    if actor.get("role") not in PORTAL_ROLES.get(portal, set()):
        st.session_state.pop("actor", None)
        st.session_state.pop("token", None)
        st.session_state.pop("success_notice", None)
        st.error("Your session no longer matches this workspace. Sign in again.")
        st.stop()
    device.flush_cookies()
    sign_in_sidebar(actor)
    success_notice = st.session_state.pop("success_notice", None)
    if success_notice:
        st.toast(success_notice, icon=":material/check_circle:")
    current = st.navigation(pages_for(portal))
    sidebar_footer()
    current.run()


main()
