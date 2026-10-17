"""Helpers for driving the multipage app with Streamlit's AppTest.

Pages are callables registered with `st.navigation`, so AppTest cannot switch to
them by file path. After a run, AppTest knows every registered page; these helpers
read that registry and select a page by its URL path (`/courses` -> "courses").
"""

from __future__ import annotations

import os

from streamlit.testing.v1 import AppTest

# AppTest renders the sign-in card; it must never start a real engine in the background.
os.environ.setdefault("AURA_DISABLE_WARMUP", "1")


def page_registry(at: AppTest) -> dict[str, dict]:
    """url_path -> registry info, for the pages the last run registered."""
    return {
        str(info.get("url_pathname")): {"hash": page_hash, **info}
        for page_hash, info in at._registered_pages.items()
    }


def page_titles(at: AppTest) -> list[str]:
    return [
        str(info.get("page_name") or info.get("url_pathname"))
        for info in at._registered_pages.values()
    ]


def open_page(at: AppTest, url_path: str) -> AppTest:
    """Switch to a registered page by URL path and run it."""
    registry = page_registry(at)
    if url_path not in registry:
        raise ValueError(f"No page at /{url_path}. Registered: {sorted(registry)}")
    at._page_hash = registry[url_path]["hash"]
    return at.run()


MODULES = [
    "common",
    "auth",
    "views.student",
    "views.sources",
    "views.profile",
    "views.parent",
    "views.reviews",
    "views.metrics",
    "views.meetings",
    "views.mentor",
    "views.hod",
    "views.operations",
    "views.lms",
    "views.pages",
]


class Namespace:
    """The old single-module `ns` for the split app.

    Reading a name returns it from whichever module defines it; assigning a name
    patches every module that holds it (a function imported into several modules
    is replaced everywhere). Modules are reloaded first, in dependency order, so a
    patch from an earlier script run never leaks into the next one.
    """

    def __init__(self) -> None:
        import importlib
        import sys

        self._modules = []
        for name in MODULES:
            module = sys.modules.get(name)
            module = importlib.reload(module) if module else importlib.import_module(name)
            self._modules.append(module)

    def __getitem__(self, name: str):
        for module in self._modules:
            if hasattr(module, name):
                return getattr(module, name)
        raise KeyError(name)

    def __setitem__(self, name: str, value) -> None:
        hit = False
        for module in self._modules:
            if hasattr(module, name):
                setattr(module, name, value)
                hit = True
        if not hit:
            raise KeyError(name)


def namespace() -> Namespace:
    return Namespace()


def picker(at: AppTest, label: str):
    """The drop-down or segmented control with this label (short lists are segmented)."""
    for widget in [*at.selectbox, *at.segmented_control]:
        if widget.label == label:
            return widget
    raise LookupError(f"No picker labelled {label!r}")


def choose(at: AppTest, label: str, value) -> AppTest:
    widget = picker(at, label)
    if hasattr(widget, "select"):
        widget.select(value)
    else:
        widget.set_value(value)
    return at
