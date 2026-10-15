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
from views.pages import all_paths, page_path, pages_for

st.set_page_config(
    page_title="AURA | Student Success",
    page_icon=str(Path(__file__).resolve().parent / "assets" / "aura-mark.svg"),
    layout="wide",
    initial_sidebar_state="auto",
)


def signed_out_pages() -> list[st.Page]:
    """Every workspace page address opens the sign-in form while signed out, so a
    bookmark or a refresh never shows "Page not found"; after sign-in the same
    address opens that page."""
    return [
        st.Page(login_view, title="Sign in", url_path=path, visibility="hidden")
        for path in sorted(all_paths(PORTAL_ROLES))
    ]


def other_workspace_view(home: st.Page) -> None:
    ui.empty_state(
        "This page is in another workspace",
        "You are signed in to a different workspace. Use Switch workspace in the sidebar to open it.",
        ":material/swap_horiz:",
    )
    if st.button("Go to my home page", type="primary", icon=":material/home:"):
        st.switch_page(home)


def routing_pages(pages: list[st.Page]) -> list[st.Page]:
    """Hidden pages around a workspace's own: "/" forwards to the home page, and
    the sign-in address or another workspace's address says so plainly instead of
    "Page not found". Nothing from another workspace is shown."""
    home = next((page for page in pages if getattr(page, "aura_home", False)), pages[0])
    extra = []
    if not any(page.url_path == "" for page in pages):
        extra.append(
            st.Page(
                lambda home=home: st.switch_page(home),
                title=home.title,
                url_path="home",
                default=True,
                visibility="hidden",
            )
        )
    extra.append(
        st.Page(
            lambda home=home: st.switch_page(home),
            title="Sign in",
            url_path="sign-in",
            visibility="hidden",
        )
    )
    own = {page_path(page) for page in pages}
    extra += [
        st.Page(
            lambda home=home: other_workspace_view(home),
            title="Another workspace",
            url_path=path,
            visibility="hidden",
        )
        for path in sorted(all_paths(PORTAL_ROLES) - own)
    ]
    return pages + extra


def main() -> None:
    ui.inject_styles()
    actor = st.session_state.get("actor")
    if not actor or not st.session_state.get("token"):
        st.navigation(
            [st.Page(login_view, title="Sign in", url_path="sign-in", default=True)]
            + signed_out_pages(),
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
    sign_in_sidebar(actor)
    success_notice = st.session_state.pop("success_notice", None)
    if success_notice:
        st.toast(success_notice, icon=":material/check_circle:")
    current = st.navigation(routing_pages(pages_for(portal)))
    sidebar_footer()
    current.run()
    # After the page: a page that forwards (st.switch_page) stops the run here, and the
    # waiting cookie writes are then made on the page it forwards to.
    device.flush_cookies()


main()
