from __future__ import annotations

import base64
import json
import os
import re
import time
from datetime import date, datetime
from typing import Any

import labels
import pandas as pd
import streamlit as st
from bridge import BridgeError, get_client

PORTALS = {
    "student": "Student",
    "parent": "Parent",
    "faculty": "Mentor",
    "hod": "Department head",
    "governance": "AI activity",
    "lms": "Learning (LMS)",
}
PORTAL_ICONS = {
    "student": ":material/school:",
    "parent": ":material/family_restroom:",
    "faculty": ":material/supervisor_account:",
    "hod": ":material/account_balance:",
    "governance": ":material/hub:",
    "lms": ":material/auto_stories:",
}
CHECK_LABELS = {
    "alerts_cite_triggers": "Each alert cites its triggering signals",
    "thresholds_faculty_set": "Thresholds are faculty-set",
    "advisor_review_required": "No student labelled without mentor review",
    "privacy_scope_enforced": "Privacy scope enforced",
}
PORTAL_ROLES = {
    "student": {"student"},
    "parent": {"parent"},
    "faculty": {"faculty"},
    "hod": {"hod"},
    "governance": {"governance", "hod"},
    "lms": {"student", "faculty", "hod"},
}
ATTENDANCE_STATES = ["present", "absent", "late", "excused"]
FOLLOWUP_STATES = ["planned", "in_progress", "completed"]
PLAN_DOMAINS = ["academic", "attendance", "wellbeing-referral"]
SCOPE_BASIS = {"selected": "Your selection", "criteria": "From the request"}
UUID_TEXT = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE
)
ACTION_OWNER_LABELS = {"assigned_faculty": "Assigned faculty", "student": "Student"}


def today_local() -> date:
    return datetime.now().astimezone().date()


def value(row: Any, *names: str, default: Any = None) -> Any:
    if not isinstance(row, dict):
        return default
    for name in names:
        if name in row:
            return row[name]
    return default


def display_name(person: dict[str, Any]) -> str:
    return labels.pretty_name(
        value(person, "name", "display_name", "displayName", default="Unnamed record")
    )


def person_id(person: dict[str, Any]) -> str:
    return str(value(person, "id", "student_id", "studentId", default=""))


def date_value(raw: Any) -> date:
    try:
        return date.fromisoformat(str(raw)[:10])
    except (TypeError, ValueError):
        return today_local()


def money(paise: Any) -> str:
    try:
        return f"₹{int(paise) / 100:,.2f}"
    except (TypeError, ValueError):
        return "Not recorded"


def short_time(raw: Any) -> str:
    try:
        return (
            datetime.fromisoformat(str(raw)).astimezone().strftime("%d %b %Y, %I:%M %p")
        )
    except (TypeError, ValueError):
        return str(raw or "Not recorded")


def request(action: str, data: dict[str, Any] | None = None) -> Any:
    token = st.session_state.get("token")
    if not token:
        raise BridgeError("Sign in to continue.", "UNAUTHENTICATED", 401)
    started = time.perf_counter()
    try:
        return get_client().request(action, data=data or {}, token=token)
    finally:
        # Opt-in timing trace for the e2e speed measurement; a no-op unless set.
        log_path = os.environ.get("AURA_REQUEST_LOG")
        if log_path:
            with open(log_path, "a") as log:
                log.write(f"{action}\t{(time.perf_counter() - started) * 1000:.0f}\n")


READ_CACHE_KEY = "worker_read_cache"
READ_CACHE_SECONDS = 60
# Read-only worker actions that load() may serve from the per-session cache.
# Anything that changes data goes through save_action(), which clears the cache.
CACHEABLE_READS = frozenset(
    {
        "overview",
        "student",
        "classroom",
        "sources",
        "receipt",
        "lms_overview",
        "lms_course",
        "review_overview",
        "review_queue",
        "plan_export",
    }
)


# The engine batches only these (plan_export stays a single call).
BATCHABLE = CACHEABLE_READS - {"plan_export"}


def clear_read_cache() -> None:
    st.session_state.pop(READ_CACHE_KEY, None)


def _cache_key(action: str, data: dict[str, Any] | None) -> tuple[str, str]:
    return (action, json.dumps(data or {}, sort_keys=True, default=str))


def _cache_get(key: tuple[str, str], now: float) -> Any | None:
    entry = st.session_state.get(READ_CACHE_KEY, {}).get(key)
    if entry and now - entry[0] < READ_CACHE_SECONDS:
        return entry[1]
    return None


def _cache_put(items: dict[tuple[str, str], Any], now: float) -> None:
    live = {
        k: v
        for k, v in st.session_state.get(READ_CACHE_KEY, {}).items()
        if now - v[0] < READ_CACHE_SECONDS
    }
    for key, result in items.items():
        live[key] = (now, json.dumps(result))
    st.session_state[READ_CACHE_KEY] = live


def read_many(
    requests: list[tuple[str, dict[str, Any] | None]],
) -> list[Any | BridgeError]:
    """Several worker reads for one page.

    Fresh per-session cache entries are reused; everything else travels in ONE
    batched engine call (authenticated once, run together), so a page pays for a
    single trip to the database. A read that fails comes back as its BridgeError
    instead of failing the others. Entries are JSON text, so each hit returns a
    fresh copy that callers can mutate freely.
    """
    now = time.monotonic()
    results: list[Any | BridgeError] = [None] * len(requests)
    missing: list[int] = []
    for index, (action, data) in enumerate(requests):
        hit = _cache_get(_cache_key(action, data), now) if action in BATCHABLE else None
        if hit is None:
            missing.append(index)
        else:
            results[index] = json.loads(hit)
    if not missing:
        return results
    if len(missing) == 1:
        action, data = requests[missing[0]]
        try:
            results[missing[0]] = cached_read(action, data, _direct=True)
        except BridgeError as error:
            results[missing[0]] = error
        return results
    answers = request(
        "batch",
        {
            "requests": [
                {"action": requests[i][0], "payload": requests[i][1] or {}}
                for i in missing
            ]
        },
    )
    stored: dict[tuple[str, str], Any] = {}
    for index, answer in zip(missing, answers):
        if answer.get("ok"):
            results[index] = answer["data"]
            stored[_cache_key(*requests[index])] = answer["data"]
        else:
            error = answer.get("error") or {}
            results[index] = BridgeError(
                error.get("message", "The action could not complete."),
                error.get("code", "REQUEST_FAILED"),
                error.get("status", 500),
                error.get("retryAfterSeconds"),
            )
    _cache_put(stored, now)
    return results


def session_bundle() -> list[tuple[str, dict[str, Any] | None]]:
    """The reads a signed-in role's pages share. The first page that needs any of
    them loads all of them together, so the role's other pages open from cache."""
    actor = st.session_state.get("actor") or {}
    portal = actor.get("portal")
    student_id = value(actor, "studentId", "student_id")
    if portal == "student" and student_id:
        return [("student", {"studentId": student_id}), ("lms_overview", None)]
    if portal == "faculty":
        return [("overview", None), ("review_queue", None), ("review_overview", None)]
    if portal == "hod":
        return [("overview", None), ("review_overview", None), ("review_queue", None)]
    if portal == "governance":
        return [("review_overview", None)]
    if portal == "parent":
        return [("overview", None)]
    return []


def cached_read(
    action: str, data: dict[str, Any] | None = None, *, _direct: bool = False
) -> Any:
    """Serve a worker read from a short per-session cache.

    The cache lives in st.session_state, not st.cache_data: a process-wide cache
    would keep the signed-in user's data (and token-scoped results) in server
    memory shared by every session. A miss on one of the role's shared reads
    refreshes the whole bundle in one batched call.
    """
    if action not in CACHEABLE_READS:
        return request(action, data)
    key = _cache_key(action, data)
    now = time.monotonic()
    hit = _cache_get(key, now)
    if hit is not None:
        return json.loads(hit)
    if not _direct and action in BATCHABLE:
        bundle = session_bundle()
        if (action, data or None) in [(a, d or None) for a, d in bundle]:
            outcome = read_many(bundle)
            wanted = outcome[
                [(a, d or None) for a, d in bundle].index((action, data or None))
            ]
            if isinstance(wanted, BridgeError):
                raise wanted
            return wanted
    result = request(action, data)
    _cache_put({key: result}, now)
    return result


def _end_session_for(error: BridgeError) -> bool:
    if error.status != 401:
        return False
    clear_read_cache()
    st.session_state.pop("token", None)
    st.session_state.pop("actor", None)
    st.session_state.pop("success_notice", None)
    st.warning("Your session has ended. Sign in again to continue.")
    return True


def load(action: str, data: dict[str, Any] | None = None) -> Any:
    try:
        with st.spinner("Loading your workspace…"):
            return cached_read(action, data)
    except BridgeError as error:
        if not _end_session_for(error):
            st.error(str(error))
        st.stop()


def load_many(requests: list[tuple[str, dict[str, Any] | None]]) -> list[Any]:
    """`load` for several reads at once (one batched engine call for the missing ones)."""
    try:
        with st.spinner("Loading your workspace…"):
            results = read_many(requests)
    except BridgeError as error:
        if not _end_session_for(error):
            st.error(str(error))
        st.stop()
    for result in results:
        if isinstance(result, BridgeError):
            if not _end_session_for(result):
                st.error(str(result))
            st.stop()
    return results


QUOTA_RETRIES = 2


def request_waiting_for_quota(action: str, data: dict[str, Any]) -> Any:
    """An AI request that finds the provider's quota window closed is retried by itself,
    with the wait on screen ("Waiting for AI quota, about N s") instead of failing (#34)."""
    attempt = 0
    while True:
        try:
            return request(action, data)
        except BridgeError as error:
            if error.code != "AI_QUOTA_WAIT" or attempt >= QUOTA_RETRIES:
                raise
            attempt += 1
            holder = st.empty()
            for left in range(max(1, min(int(error.retry_after or 15), 120)), 0, -1):
                holder.info(
                    f"Waiting for AI quota, about {left} s. Your request is kept and retried automatically.",
                    icon=":material/hourglass_top:",
                )
                time.sleep(1)
            holder.empty()


def save_action(action: str, data: dict[str, Any], success: str) -> Any | None:
    try:
        with st.spinner("Saving your changes…"):
            try:
                result = request_waiting_for_quota(action, data)
            finally:
                # Never show pre-write data, even if the write failed part-way.
                clear_read_cache()
        if action == "replay":
            st.success(success)
            return result
        if action in {"plan_save", "plan_revise", "plan_pause", "plan_lock"}:
            st.session_state["review_plan_selector_revision"] = (
                st.session_state.get("review_plan_selector_revision", 0) + 1
            )
            st.session_state["review_selected_id"] = result.get(
                "id", data.get("planId")
            )
        st.session_state["success_notice"] = success
        st.rerun()
        return result
    except BridgeError as error:
        if error.status == 401:
            st.session_state.pop("token", None)
            st.session_state.pop("actor", None)
            st.session_state.pop("success_notice", None)
            st.warning("Your session has ended. Sign in again to continue.")
        elif error.code == "AI_QUOTA_WAIT":
            st.info(
                f"Waiting for AI quota, about {error.retry_after or 'a few'} s. "
                "Nothing was lost; press the button again in a moment.",
                icon=":material/hourglass_top:",
            )
        else:
            st.error(str(error))
        return None


def attachment_payload(uploaded: Any) -> tuple[dict[str, str] | None, str | None]:
    if uploaded is None:
        return None, None
    if uploaded.size < 1:
        return None, "Choose a file with at least one byte."
    if uploaded.size > 2 * 1024 * 1024:
        return None, "Files must be 2 MB or smaller."
    if len(uploaded.name) > 100 or not all(
        character.isalnum() or character in " ._()-" for character in uploaded.name
    ):
        return (
            None,
            "Use a file name with letters, numbers, spaces, dots, brackets, underscores, or hyphens.",
        )
    return {
        "name": uploaded.name,
        "data": base64.b64encode(uploaded.getvalue()).decode("ascii"),
    }, None


def select_id(
    label: str, rows: list[dict[str, Any]], id_getter, label_getter, *, key: str
) -> str | None:
    available = [row for row in rows if id_getter(row)]
    if not available:
        return None
    ids = [id_getter(row) for row in available]
    labels = {id_getter(row): label_getter(row) for row in available}
    return pick(label, ids, format_func=lambda item: labels.get(item, item), key=key)


SEGMENT_MAX = 7  # up to this many options: a segmented control, never a drop-down
SEARCH_FROM = 12  # from this many options: a separate search box narrows the picker


def _forget_stale(key: str | None, options: list[Any]) -> None:
    if key and key in st.session_state and st.session_state[key] not in options:
        del st.session_state[key]


def pick(
    label: str,
    options: list[Any],
    *,
    format_func=str,
    key: str | None = None,
    index: int = 0,
    help: str | None = None,
    placeholder: str | None = None,
    label_visibility: str = "visible",
    search: bool | None = None,
) -> Any:
    """Choose one option without typing into the control.

    Up to SEGMENT_MAX plain options (text or numbers) become a segmented control.
    Longer lists, rows and lists with an empty "choose" entry are a drop-down that cannot be typed into;
    from SEARCH_FROM options a separate search box narrows it.
    """
    options = list(options)
    if not options:
        return None
    index = max(0, min(index, len(options) - 1))
    if len(options) <= SEGMENT_MAX and all(
        isinstance(o, (str, int, float)) and not isinstance(o, bool) for o in options
    ):
        _forget_stale(key, options)
        chosen = st.segmented_control(
            label,
            options,
            default=options[index],
            required=True,
            format_func=format_func,
            key=key,
            help=help,
            label_visibility=label_visibility,
        )
        return options[0] if chosen is None else chosen
    shown = options
    if search is not False and len(options) >= SEARCH_FROM:
        query = (
            st.text_input(
                f"Search {label.lower()}",
                key=f"{key}__search" if key else None,
                placeholder="Type to narrow the list",
            )
            .strip()
            .lower()
        )
        if query:
            shown = [o for o in options if query in str(format_func(o)).lower()]
            if not shown:
                st.caption(
                    f":material/search_off: Nothing matches \u201c{query}\u201d."
                )
                return None
        st.caption(f"Showing {len(shown)} of {len(options)}")
        if options[index] in shown:
            index = shown.index(options[index])
        else:
            index = 0
    _forget_stale(key, shown)
    return st.selectbox(
        label,
        shown,
        index=min(index, len(shown) - 1),
        format_func=format_func,
        key=key,
        help=help,
        placeholder=placeholder,
        label_visibility=label_visibility,
        filter_mode=None,
    )


def pick_many(
    label: str,
    options: list[Any],
    *,
    format_func=str,
    key: str,
    default: list[Any] | None = None,
    max_selections: int | None = None,
) -> list[Any]:
    """Choose several options. A separate search box narrows long lists; the
    multiselect itself cannot be typed into and keeps what is already chosen."""
    options = list(options)
    shown = options
    if len(options) >= SEARCH_FROM:
        query = (
            st.text_input(
                f"Search {label.lower()}",
                key=f"{key}__search",
                placeholder="Type to narrow the list",
            )
            .strip()
            .lower()
        )
        if query:
            chosen_now = st.session_state.get(key) or default or []
            shown = [
                o
                for o in options
                if o in chosen_now or query in str(format_func(o)).lower()
            ]
    if key in st.session_state:
        st.session_state[key] = [o for o in st.session_state[key] if o in shown]
    return st.multiselect(
        label,
        shown,
        default=None if key in st.session_state else default,
        format_func=format_func,
        key=key,
        max_selections=max_selections,
        filter_mode=None,
    )


def sections(options: list[str], *, key: str) -> str:
    """One section at a time. Only the chosen section's code runs, so heavy
    sections cost nothing until they are opened."""
    return (
        st.segmented_control(
            "Section",
            options,
            default=options[0],
            required=True,
            key=key,
            label_visibility="collapsed",
        )
        or options[0]
    )


def text_matches(query: str, *parts: Any) -> bool:
    query = query.strip().lower()
    return not query or any(query in str(part or "").lower() for part in parts)


def _sized_columns(
    rows: list[dict[str, Any]], column_config: dict[str, Any] | None
) -> dict[str, Any]:
    """Give every column a width that fits its header and longest value (no clipped cells).

    Columns the caller already configured keep their configuration."""
    config = dict(column_config or {})
    sized: dict[str, int] = {}
    for name in rows[0]:
        if name in config:
            continue
        longest = max((len(str(row.get(name) or "")) for row in rows[:80]), default=0)
        sized[name] = int(
            min(420, max(84, len(str(name)) * 8 + 44, longest * 7.8 + 28))
        )
    # Shrink the widest columns until the table fits the page; text then ellipsises, never the header.
    while (
        sum(sized.values()) + 120 * len(config) > 900
        and max(sized.values(), default=0) > 150
    ):
        widest = max(sized, key=sized.get)
        sized[widest] = int(sized[widest] * 0.9)
    total = sum(sized.values()) + 120 * len(config)
    factor = min(1.7, 880 / total) if 0 < total < 880 else 1.0
    for name, width in sized.items():
        config[name] = st.column_config.Column(name, width=int(width * factor))
    return config


def dataframe(
    rows: list[dict[str, Any]],
    *,
    empty: str = "No records to show.",
    key: str | None = None,
    column_config: dict[str, Any] | None = None,
) -> None:
    if not rows:
        st.caption(f":material/inbox: {empty}")
        return
    frame = pd.DataFrame(rows)
    for column in frame.columns[frame.dtypes == object]:
        frame[column] = frame[column].where(frame[column].notna(), "—")
    st.dataframe(
        frame,
        hide_index=True,
        width="stretch",
        key=key,
        column_config=_sized_columns(rows, column_config),
    )


def percent(raw: Any) -> float | None:
    try:
        return None if raw is None else float(raw)
    except (TypeError, ValueError):
        return None


def average(values: list[float | None]) -> float | None:
    known = [v for v in values if v is not None]
    return round(sum(known) / len(known), 1) if known else None


def percent_text(raw: Any) -> str:
    number = percent(raw)
    return "—" if number is None else f"{number:g}%"


PERCENT_COLUMN = {
    "format": "%.0f%%",
    "min_value": 0,
    "max_value": 100,
}
