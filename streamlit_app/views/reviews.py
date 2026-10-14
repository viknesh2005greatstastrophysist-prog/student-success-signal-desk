from __future__ import annotations

import json
import re
from typing import Any

import labels
import pandas as pd
import streamlit as st
import ui
from common import pick
from common import (
    ACTION_OWNER_LABELS,
    CHECK_LABELS,
    PLAN_DOMAINS,
    SCOPE_BASIS,
    UUID_TEXT,
    dataframe,
    load,
    save_action,
    value,
)

SCORING_FIELDS = {
    "attendanceWeight": ("Attendance weight (points)", 20, 0),
    "markWeight": ("Marks weight (points)", 20, 0),
    "inactivityWeight": ("LMS inactivity weight (points)", 20, 0),
    "overdueWeight": ("Overdue assignments weight (points)", 10, 0),
    "internshipWeight": ("Internship weight (points)", 15, 0),
    "placementWeight": ("Placement weight (points)", 15, 0),
    "overdueMinimum": ("Overdue assignments that trigger a signal", 1, 1),
    "internshipMinimum": ("Missed internship milestones that trigger a signal", 1, 1),
    "placementMinimum": ("Missed placement activities that trigger a signal", 1, 1),
}


def render_policy_form() -> None:
    ui.section(
        "Approve a mentor policy",
        "These thresholds and weights are exactly what reviews will apply. Only faculty can approve them.",
        icon=":material/rule:",
    )
    with st.form("approve_policy"):
        version = st.text_input(
            "Policy version", max_chars=80, placeholder="For example, Mentor review 1"
        )
        attendance_min = st.number_input(
            "Attendance threshold (%)",
            min_value=0.0,
            max_value=100.0,
            value=None,
            step=1.0,
        )
        mark_min = st.number_input(
            "Mark threshold (%)", min_value=0.0, max_value=100.0, value=None, step=1.0
        )
        inactivity_max = st.number_input(
            "Learning inactivity threshold (days)",
            min_value=1,
            max_value=90,
            value=None,
            step=1,
        )
        medium = st.number_input(
            "Medium review score", min_value=1.0, max_value=99.0, value=None, step=1.0
        )
        high = st.number_input(
            "High review score", min_value=2.0, max_value=100.0, value=None, step=1.0
        )
        freshness = st.number_input(
            "Evidence freshness window (days)",
            min_value=1,
            max_value=365,
            value=None,
            step=1,
        )
        scoring = {}
        st.markdown("##### Signal weights and count thresholds")
        st.caption(
            "Weights are the points each signal adds to the composite risk score."
        )
        weight_cols = st.columns(3)
        for index, (field, (label, default, minimum)) in enumerate(
            SCORING_FIELDS.items()
        ):
            with weight_cols[index % 3]:
                scoring[field] = st.number_input(
                    label,
                    min_value=minimum,
                    max_value=100,
                    value=default,
                    step=1,
                    key=f"policy_{field}",
                )
        rationale = st.text_area("Reason for approving this policy", max_chars=600)
        submitted = st.form_submit_button("Approve policy", type="primary")
    if submitted:
        values = [attendance_min, mark_min, inactivity_max, medium, high, freshness]
        if (
            len(version.strip()) < 3
            or any(item is None for item in values)
            or len(rationale.strip()) < 12
        ):
            st.error(
                "Complete every threshold and enter a reason of at least twelve characters."
            )
        elif float(high) <= float(medium):
            st.error("The high review score must exceed the medium review score.")
        else:
            policy = {
                "version": version.strip(),
                "attendanceMinimum": float(attendance_min),
                "markMinimum": float(mark_min),
                "inactivityMaximum": int(inactivity_max),
                "mediumScore": float(medium),
                "highScore": float(high),
                "freshnessDays": int(freshness),
                **scoring,
            }
            save_action(
                "policy_approve",
                {"policy": policy, "rationale": rationale.strip()},
                "Mentor policy approved.",
            )


def policy_rows(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for row in raw:
        policy = row.get("policy") or {}
        output.append(
            {
                "id": str(row.get("id", "")),
                "Policy version": policy.get("version", "Not recorded"),
                "Reason": row.get("rationale", ""),
                "Attendance threshold (%)": policy.get("attendanceMinimum"),
                "Mark threshold (%)": policy.get("markMinimum"),
                "Learning inactivity (days)": policy.get("inactivityMaximum"),
                "Medium review score": policy.get("mediumScore"),
                "High review score": policy.get("highScore"),
                "Evidence freshness (days)": policy.get("freshnessDays"),
                "Weights and count thresholds": "; ".join(
                    f"{SCORING_FIELDS[key][0].replace(' (points)', '')}: {policy.get(key, 'Not recorded')}"
                    for key in SCORING_FIELDS
                ),
                "owner": value(row, "faculty_person_id", "facultyPersonId"),
            }
        )
    return output


def student_name_map(review: dict[str, Any]) -> dict[str, str]:
    return {
        str(value(row, "id", "student_id", default="")): str(
            labels.pretty_name(value(row, "display_name", "name", default="Student"))
        )
        for row in review.get("students") or []
        if value(row, "id", "student_id")
    }


def render_policies(review: dict[str, Any], actor: dict[str, Any]) -> None:
    policies = policy_rows(review.get("policies") or [])
    ui.section(
        "Approved mentor policies",
        "Every review applies one of these faculty-approved policies. Reviews cannot run without one.",
        icon=":material/policy:",
    )
    full_rows = [
        {k: v for k, v in row.items() if k not in {"id", "owner"}} for row in policies
    ]
    if not full_rows:
        dataframe([], empty="No policy has been approved yet.")
    else:
        groups: dict[tuple, dict[str, Any]] = {}
        for row in full_rows:
            key = (
                row.get("Policy version"),
                row.get("Reason"),
                row.get("Attendance threshold (%)"),
                row.get("Mark threshold (%)"),
                row.get("Learning inactivity (days)"),
            )
            groups.setdefault(key, {"row": row, "n": 0})["n"] += 1
        ui.inset_list(
            [
                {
                    "title": g["row"].get("Policy version"),
                    "sub": f"{g['row'].get('Reason') or ''}"
                    + (f" Approved {g['n']} times." if g["n"] > 1 else ""),
                    "end": f"Attendance {g['row'].get('Attendance threshold (%)')}% · Marks {g['row'].get('Mark threshold (%)')}% · Inactive {g['row'].get('Learning inactivity (days)')} days",
                }
                for g in groups.values()
            ]
        )
        with st.expander("Full scoring detail", icon=":material/table_rows:"):
            dataframe(full_rows)
    if actor.get("role") == "faculty":
        with ui.card("policy_form"):
            render_policy_form()
    else:
        st.caption(
            ":material/lock: Only the assigned faculty mentor can approve a scoring policy."
        )


def policy_text(text: Any, policy_by_id: dict[str, dict[str, Any]]) -> str:
    """Plan text with policy ids replaced by the policy's name and version."""

    def named(match: re.Match[str]) -> str:
        row = policy_by_id.get(match.group(0).lower()) or policy_by_id.get(
            match.group(0)
        )
        return str((row or {}).get("Policy version") or "the approved policy")

    return UUID_TEXT.sub(named, str(text))


def ai_unavailable_rows(jobs: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Provider, model and failure for every model that did not answer."""
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for job in jobs:
        for reason in job.get("failure_reasons") or []:
            text = str(reason)
            if text in seen:
                continue
            seen.add(text)
            head, _, tail = text.partition(": ")
            kind, _, model = head.partition(" ")
            if tail and kind in labels.PROVIDERS:
                rows.append(
                    {
                        "Provider": labels.provider_label(kind),
                        "Model": model or "—",
                        "What happened": tail,
                    }
                )
            else:
                rows.append({"Provider": "—", "Model": "—", "What happened": text})
    return rows


def render_ai_unavailable(
    selected_plan: dict[str, Any], jobs: list[dict[str, Any]], can_plan: bool
) -> None:
    """Reviews waiting because no AI model answered: the audited reason and a retry."""
    waiting = [job for job in jobs if job.get("status") == "ai_unavailable"]
    if not waiting:
        return
    st.warning(
        f"{len(waiting)} of {len(jobs)} student reviews are waiting for an AI model. "
        "Nothing was drafted by rules; the reasons below are in the audit log.",
        icon=":material/cloud_off:",
    )
    rows = ai_unavailable_rows(waiting)
    if rows:
        with st.expander("Why no model answered", icon=":material/troubleshoot:"):
            dataframe(rows)
    if can_plan and not selected_plan.get("paused"):
        retry = st.button(
            "Retry AI review",
            type="primary",
            key=f"retry_ai_{selected_plan['id']}",
            icon=":material/refresh:",
        )
        if retry:
            save_action(
                "plan_execute",
                {"planId": selected_plan["id"]},
                "Retry recorded. Saved activity has been refreshed.",
            )


def render_plan_scope(
    selected_plan: dict[str, Any],
    body: dict[str, Any],
    students: list[dict[str, Any]],
    can_plan: bool,
) -> None:
    """Who the agents will run on, any narrowing, and an unanswered scope conflict."""
    scoped = [str(sid) for sid in body.get("studentIds") or []]
    roster = {
        str(value(row, "id", "student_id", default="")): row
        for row in students
        if value(row, "id", "student_id")
    }
    scope = body.get("scope") or {}
    if scope.get("narrowedFrom"):
        st.caption(
            f":material/filter_alt: Narrowed from {scope['narrowedFrom']} selected students to "
            f"{len(scoped)} by the criteria in your request."
        )
    conflict = body.get("scopeConflict")
    if isinstance(conflict, dict) and not conflict.get("resolution"):
        selected = int(conflict.get("selected") or len(scoped))
        implied = int(conflict.get("implied") or 0)
        switchable = bool(conflict.get("impliedStudentIds"))
        plan_key = f"{selected_plan['id']}_{selected_plan['revision']}"
        with st.container(border=True, key=f"scope_conflict_{plan_key}"):
            st.markdown(
                "**Your selection and your request describe different students**"
            )
            st.markdown(
                f"You selected **{selected}**; your request describes **{implied}**. "
                f"The plan stays on your **{selected}** until you choose."
            )
            if not can_plan:
                st.caption("Only the assigned mentor can answer this.")
            else:
                keep_col, switch_col = st.columns(2)
                with keep_col:
                    if st.button(
                        f"Keep my {selected}",
                        key=f"scope_keep_{plan_key}",
                        icon=":material/check:",
                        width="stretch",
                    ):
                        save_action(
                            "plan_revise",
                            {
                                "planId": selected_plan["id"],
                                "expectedRevision": selected_plan["revision"],
                                "input": {
                                    "request": body.get("request", ""),
                                    "scopeChoice": "keep",
                                },
                            },
                            "Your selection stays as chosen.",
                        )
                with switch_col:
                    if switchable and st.button(
                        f"Use the {implied} from my request",
                        key=f"scope_switch_{plan_key}",
                        icon=":material/swap_horiz:",
                        width="stretch",
                    ):
                        save_action(
                            "plan_revise",
                            {
                                "planId": selected_plan["id"],
                                "expectedRevision": selected_plan["revision"],
                                "input": {
                                    "request": body.get("request", ""),
                                    "scopeChoice": "switch",
                                },
                            },
                            f"The plan now covers the {implied} students your request describes.",
                        )
                if not switchable:
                    st.caption(
                        "The request describes more students than one review covers (50). "
                        "Narrow the request to switch."
                    )
    with st.expander(f"Students in scope ({len(scoped)})", icon=":material/groups:"):
        if not scoped:
            st.caption("No students are in scope yet.")
        else:
            rows = []
            for sid in scoped:
                row = roster.get(sid)
                rows.append(
                    {
                        "Register number": str(
                            value(row, "register_number", "srn", default="Not listed")
                        )
                        if row
                        else "Not listed",
                        "Student": labels.pretty_name(
                            labels.pretty_name(
                                value(row, "display_name", "name", default="Not listed")
                            )
                        )
                        if row
                        else "Not in your current list",
                    }
                )
            dataframe(sorted(rows, key=lambda item: item["Register number"]))
            st.caption(
                "These are the students the agents will run on once the plan is locked."
            )


def render_plan_workbench(review: dict[str, Any], actor: dict[str, Any]) -> None:
    raw_policies = review.get("policies") or []
    policies = policy_rows(raw_policies)
    role = actor.get("role")
    students = review.get("students") or []
    names = student_name_map(review)
    student_options = [
        str(value(row, "id", "student_id", default=""))
        for row in students
        if value(row, "id", "student_id")
    ]
    student_labels = {
        str(
            value(row, "id", "student_id")
        ): f"{value(row, 'register_number', 'srn', default='Student')} · {labels.pretty_name(value(row, 'display_name', 'name', default=''))}"
        for row in students
        if value(row, "id", "student_id")
    }
    policy_by_id = {row["id"]: row for row in policies if row["id"]}
    plans = review.get("plans") or []
    # Plans are created, revised, locked, run and paused by the assigned mentor
    # only; the department head and AI-activity roles observe (the Core enforces it).
    can_plan = role == "faculty"
    st.caption(
        ":material/route: **How a review runs:** describe it → answer the planner's questions → "
        "lock the plan → run the agents → decide each draft in the review queue."
    )
    if not can_plan:
        st.caption(
            ":material/visibility: This workspace can observe review plans but not create or change them."
        )
    if can_plan:
        with st.expander(
            "Create a review plan",
            expanded=not plans,
            icon=":material/add_circle:",
        ):
            if not review.get("modelConfigured"):
                st.warning(
                    "No AI model is connected, so the planner cannot answer yet. "
                    "Nothing is drafted by rules: saving will ask you to retry.",
                    icon=":material/cloud_off:",
                )
            with st.form("create_plan", border=False):
                request_text = st.text_area(
                    "Review request",
                    max_chars=2000,
                    placeholder="For example: check my mentees whose attendance dropped this month.",
                )
                chosen_students = st.multiselect(
                    "Students in scope",
                    student_options,
                    format_func=lambda item: student_labels.get(item, item),
                    max_selections=50,
                    filter_mode=None,
                )
                left, right = st.columns(2)
                with left:
                    domain = pick(
                        "Review focus",
                        [None, *PLAN_DOMAINS],
                        format_func=lambda item: (
                            "Choose a focus"
                            if item is None
                            else labels.domain_label(item)
                        ),
                    )
                with right:
                    policy_id = pick(
                        "Approved mentor policy",
                        [None, *policy_by_id.keys()],
                        format_func=lambda item: (
                            "Choose an approved policy"
                            if item is None
                            else policy_by_id[item]["Policy version"]
                        ),
                    )
                feedback = st.text_area("Planning notes", max_chars=1000)
                submitted = st.form_submit_button(
                    "Save review plan", type="primary", icon=":material/save:"
                )
            if submitted:
                payload: dict[str, Any] = {
                    "request": request_text.strip(),
                    "feedback": feedback.strip(),
                }
                if chosen_students:
                    payload["studentIds"] = chosen_students
                if domain:
                    payload["domain"] = domain
                if policy_id:
                    payload["policyId"] = policy_id
                if len(request_text.strip()) < 3:
                    st.error("Describe the review in at least three characters.")
                else:
                    save_action("plan_save", payload, "Review plan saved.")

    if not plans:
        ui.empty_state(
            "No review plans yet",
            "Create a plan above. The coordinator will ask for anything it needs before the plan can be locked.",
        )
        return
    plan_options = [row for row in plans if row.get("id")]
    plan_by_id = {row["id"]: row for row in plan_options}
    ids = list(plan_by_id)
    prior = st.session_state.get("review_selected_id")
    selector_revision = st.session_state.get("review_plan_selector_revision", 0)
    default_index = st.session_state.setdefault(
        f"review_plan_default_{selector_revision}",
        ids.index(prior) if prior in ids else 0,
    )
    selected_id = pick(
        "Plan",
        ids,
        index=min(default_index, len(ids) - 1),
        format_func=lambda key: plan_label(plan_by_id[key]),
        key=f"review_plan_{selector_revision}",
    )
    selected_plan = plan_by_id[selected_id]
    st.session_state["review_selected_id"] = selected_id
    body = selected_plan.get("body") or {}
    questions = body.get("questions") or []
    review_jobs = [
        row
        for row in review.get("jobs", [])
        if str(value(row, "plan_id", "planId", default=""))
        == str(selected_plan.get("id"))
    ]

    with ui.card(f"plan_{selected_id}"):
        title, status = st.columns([4, 1.5], vertical_alignment="center")
        with title:
            st.markdown(
                f"#### {ui._md_safe(body.get('request', 'Review request not recorded'))}"
            )
        with status:
            st.markdown(
                ui.status_md(selected_plan.get("status"))
                + (
                    " " + ui.badge_md("Paused", "orange", ":material/pause:")
                    if selected_plan.get("paused")
                    else ""
                )
            )
        facts = st.columns(4)
        facts[0].caption("Focus")
        facts[0].markdown(
            f"**{labels.domain_label(body.get('domain')) if body.get('domain') else '—'}**"
        )
        facts[1].caption("Policy")
        facts[1].markdown(
            f"**{ui._md_safe(policy_by_id.get(body.get('policyId'), {}).get('Policy version', '—'))}**"
        )
        facts[2].caption("Students")
        facts[2].markdown(f"**{len(body.get('studentIds') or [])}**")
        facts[3].caption("Scope")
        facts[3].markdown(
            f"**{SCOPE_BASIS.get((body.get('scope') or {}).get('basis'), '—')}**"
        )
        if questions:
            ui.agent_chip_block(
                body.get("modelId") or body.get("model_id"),
                label="planner agent",
                note="asked these before the plan can be locked",
            )
            st.warning(
                "Complete these details before locking the plan: "
                + " ".join(questions),
                icon=":material/help:",
            )
        render_plan_scope(selected_plan, body, students, can_plan)
        steps = body.get("steps", [])
        if steps:
            with st.expander("Planned steps", icon=":material/format_list_numbered:"):
                for number, step in enumerate(steps, 1):
                    st.markdown(
                        f"{number}. {ui._md_safe(policy_text(step, policy_by_id))}"
                    )
        render_planner_trace(body)
        ui.tech_details(
            [
                ("Plan reference", selected_plan.get("id")),
                ("Revision", selected_plan.get("revision")),
            ]
        )

    if selected_plan.get("status") != "locked" and can_plan:
        with st.expander(
            "Answer questions or revise this plan",
            expanded=bool(questions),
            icon=":material/edit:",
        ):
            # The form key carries the revision and the save counter, so a saved
            # revision always opens a fresh form: the feedback box is empty and
            # every field shows the saved values again, never the old typed text.
            form_key = f"revise_plan_{selected_id}_{selected_plan['revision']}_{selector_revision}"
            with st.form(form_key, border=False):
                revised_request = st.text_area(
                    "Revised review request",
                    value=body.get("request", ""),
                    max_chars=2000,
                    key=f"{form_key}_request",
                )
                revised_students = st.multiselect(
                    "Revised students in scope",
                    student_options,
                    default=[
                        sid
                        for sid in body.get("studentIds", [])
                        if sid in student_options
                    ],
                    format_func=lambda sid: student_labels.get(sid, sid),
                    max_selections=50,
                    key=f"{form_key}_students",
                    filter_mode=None,
                )
                left, right = st.columns(2)
                focuses = [None, *PLAN_DOMAINS]
                with left:
                    revised_focus = pick(
                        "Revised focus",
                        focuses,
                        index=focuses.index(body.get("domain")),
                        format_func=lambda item: (
                            labels.domain_label(item) if item else "Choose a focus"
                        ),
                        key=f"{form_key}_focus",
                    )
                policy_ids = [None, *policy_by_id]
                with right:
                    revised_policy = pick(
                        "Revised policy",
                        policy_ids,
                        index=policy_ids.index(body.get("policyId"))
                        if body.get("policyId") in policy_ids
                        else 0,
                        format_func=lambda item: (
                            policy_by_id[item]["Policy version"]
                            if item
                            else "Choose a policy"
                        ),
                        key=f"{form_key}_policy",
                    )
                if body.get("feedback"):
                    st.caption("Notes saved so far (the planner keeps reading them):")
                    for note in str(body["feedback"]).splitlines():
                        if note.strip():
                            ui.plain_text(note, muted=True)
                revised_feedback = st.text_area(
                    "Revision feedback",
                    value="",
                    max_chars=1000,
                    placeholder="Answer the planner's questions or add a note. Your earlier notes are kept.",
                    help="Write only what is new: it is added to the notes above, never mixed into them. "
                    "Answered questions are not asked again. The planner reads plain English "
                    "(for example: leave out final-years, focus on attendance); your selection above stays authoritative.",
                    key=f"{form_key}_feedback",
                )
                revise = st.form_submit_button("Save revised plan", type="primary")
            if revise:
                revision_input = {
                    "request": revised_request,
                    "feedback": revised_feedback.strip(),
                }
                if revised_students:
                    revision_input["studentIds"] = revised_students
                if revised_focus:
                    revision_input["domain"] = revised_focus
                if revised_policy:
                    revision_input["policyId"] = revised_policy
                save_action(
                    "plan_revise",
                    {
                        "planId": selected_id,
                        "expectedRevision": selected_plan["revision"],
                        "input": revision_input,
                    },
                    "Answers saved to the same plan as a new revision.",
                )

    action_col, export_col = st.columns([2, 1], vertical_alignment="bottom")
    with action_col:
        if selected_plan.get("status") == "locked" and not can_plan:
            st.caption(
                ":material/lock: This plan is locked"
                + (" and paused" if selected_plan.get("paused") else "")
                + ". Only the assigned mentor can run or pause it."
            )
        elif selected_plan.get("status") == "locked":
            paused = bool(selected_plan.get("paused"))
            with st.form(
                f"pause_form_{selected_id}_{selected_plan['revision']}", border=False
            ):
                reason_col, button_col = st.columns([2, 1], vertical_alignment="bottom")
                with reason_col:
                    reason = st.text_input("Pause or resume reason")
                with button_col:
                    change_pause = st.form_submit_button(
                        "Resume review" if paused else "Pause review",
                        icon=":material/play_arrow:" if paused else ":material/pause:",
                        width="stretch",
                    )
            if change_pause:
                if len(reason.strip()) < 5:
                    st.error("Enter a reason of at least five characters.")
                else:
                    save_action(
                        "plan_pause",
                        {
                            "planId": selected_id,
                            "expectedRevision": selected_plan["revision"],
                            "paused": not paused,
                            "reason": reason.strip(),
                        },
                        "Review resumed." if paused else "Review paused.",
                    )
            if paused:
                st.warning(
                    "This review is paused. Resume before running.",
                    icon=":material/pause_circle:",
                )
            st.caption(
                ":material/lock: This plan is locked. Its saved scope and policy cannot be edited."
            )
            if st.button(
                "Run review",
                type="primary",
                key=f"run_{selected_plan['id']}",
                disabled=bool(selected_plan.get("paused")),
                icon=":material/smart_toy:",
            ):
                save_action(
                    "plan_execute",
                    {"planId": selected_plan["id"]},
                    "Review run recorded. Saved activity has been refreshed.",
                )
        elif can_plan and selected_plan.get("status") != "locked" and not questions:
            lock = st.button(
                "Lock review plan",
                type="primary",
                key=f"lock_{selected_plan['id']}",
                icon=":material/lock:",
            )
            if lock:
                save_action(
                    "plan_lock",
                    {
                        "planId": selected_plan["id"],
                        "expectedRevision": int(selected_plan.get("revision", 0)),
                    },
                    "Review plan locked.",
                )
    with export_col:
        if st.button(
            "Prepare evidence export",
            key=f"export_{selected_plan['id']}",
            icon=":material/inventory:",
            width="stretch",
        ):
            exported = load("plan_export", {"planId": selected_plan["id"]})
            st.download_button(
                "Download review evidence",
                json.dumps(exported, ensure_ascii=False, indent=2),
                file_name=f"review-{selected_plan['id']}.json",
                mime="application/json",
                key=f"download_{selected_plan['id']}",
                on_click="ignore",
                icon=":material/download:",
                width="stretch",
            )

    if not review_jobs:
        return
    ui.section(
        "Agent run",
        "Each student moves through the coordinator, four data agents, risk analysis, retrieval, drafting and validation, then stops at the mentor gate.",
        icon=":material/hub:",
    )
    traced = [job for job in review_jobs if job.get("node_trace")]
    if traced:
        trace_job = traced[0]
        if len(traced) > 1:
            trace_id = pick(
                "Show agent trace for",
                [str(job["id"]) for job in traced],
                format_func=lambda jid: names.get(
                    str(
                        next(j for j in traced if str(j["id"]) == jid).get("student_id")
                    ),
                    "Student",
                ),
                key=f"trace_{selected_id}",
            )
            trace_job = next(job for job in traced if str(job["id"]) == trace_id)
        ui.pipeline_stepper(
            trace_job.get("node_trace"),
            judge=(trace_job.get("validation") or {}).get("judge")
            if isinstance(trace_job.get("validation"), dict)
            else None,
        )
    render_ai_unavailable(selected_plan, review_jobs, can_plan)
    dataframe(
        [
            {
                "Student": names.get(str(row.get("student_id")), "Student"),
                "Status": labels.status_label(row.get("status")),
                "Stage": labels.status_label(row.get("stage")),
                "Drafted by": labels.mode_label(row.get("mode"))
                if row.get("mode")
                else "—",
                "Issue": labels.issue_label(row.get("error_code"))
                if row.get("error_code")
                else "—",
            }
            for row in review_jobs
        ]
    )
    for job in review_jobs:
        if job.get("status") == "needs_human":
            who = names.get(str(job.get("student_id")), "A student")
            ui.gate_banner(
                f"{who}: the repair or execution budget is exhausted, so nothing was advanced. Review the diagnosis before creating another review.",
                title="Needs your decision",
            )
            with st.expander("Diagnosis", icon=":material/troubleshoot:"):
                render_diagnoses(job.get("failure_diagnosis"))
                st.json(job.get("failure_diagnosis") or {})
                st.caption(
                    "No draft was substituted. Revise the review or retry it; nothing reaches a student without your approval."
                )
    for job in review_jobs:
        if job.get("retrieval"):
            with st.expander(
                f"Similar past support · {names.get(str(job.get('student_id')), 'Student')}",
                icon=":material/travel_explore:",
            ):
                st.caption(
                    "Prior cases are restricted to this account's student scope and reduced to approved action categories."
                )
                dataframe(
                    [
                        {
                            "Reference": labels.short_ref(ref["id"]),
                            "Tags": ", ".join(
                                labels.domain_label(t) for t in ref["tags"]
                            ),
                            "Similarity": round(ref["similarity"], 3),
                            "Summary": ref["text"],
                        }
                        for ref in job["retrieval"]
                    ],
                    column_config={
                        "Similarity": st.column_config.ProgressColumn(
                            "Similarity", min_value=0, max_value=1, format="%.2f"
                        )
                    },
                )
    for job in review_jobs:
        if job.get("source_timings"):
            with st.expander(
                f"Data agent timings · {names.get(str(job.get('student_id')), 'Student')}",
                icon=":material/timer:",
            ):
                st.caption(
                    "The four data agents read one shared database snapshot concurrently."
                )
                dataframe(
                    [
                        {
                            "Data agent": labels.source_label(name),
                            "Milliseconds": round(elapsed, 2),
                        }
                        for name, elapsed in job["source_timings"].items()
                    ]
                )


def render_composite_risk(review: dict[str, Any], actor: dict[str, Any]) -> None:
    if actor.get("role") != "faculty":
        return
    ui.section(
        "Composite risk view",
        "Scores combine the four signals using your approved policy. A flag only opens a review path; it is never a label.",
    )
    rows = review.get("riskView") or []
    plan_options = {p["id"]: plan_label(p) for p in review.get("plans", [])}
    filter_col, toggle_col = st.columns([3, 1], vertical_alignment="bottom")
    with filter_col:
        plan_filter = pick(
            "Risk cycle",
            [None, *plan_options],
            format_func=lambda item: (
                "All assigned cycles" if item is None else plan_options[item]
            ),
            key="risk_cycle",
        )
    with toggle_col:
        flagged_only = st.checkbox("Flagged students only", key="risk_flagged")
    # Rows are student x review cycle. All cycles: each student's latest row;
    # one cycle: that cycle's rows. Either way one row is one student.
    scoped = labels.risk_scope(rows, plan_filter, flagged_only)
    counts = labels.risk_counts(scoped)
    ui.kpi_row(
        [
            {
                "label": "Students evaluated",
                "value": counts["evaluated"],
                "icon": ":material/fact_check:",
                "help": f"Of {counts['students']} students shown, this many have a risk score.",
            },
            {
                "label": "Students flagged",
                "value": counts["flagged"],
                "icon": ":material/flag:",
            },
            {
                "label": "High band",
                "value": counts["high"],
                "icon": ":material/priority_high:",
            },
            {
                "label": "Medium band",
                "value": counts["medium"],
                "icon": ":material/trending_up:",
            },
        ]
    )
    st.caption(
        "One row per student: the latest review cycle that evaluated them. Pick a cycle above to see that cycle only."
        if not plan_filter
        else "One row per student in the chosen review cycle."
    )
    dataframe(
        [
            {
                "Student": labels.pretty_name(row["studentName"]),
                "Register number": row["registerNumber"],
                "Score": row["score"],
                "Band": labels.risk_label(row["band"]),
                "Status": labels.status_label(row["status"]),
                "Contributing signals": ", ".join(
                    labels.signal_label(signal["code"]) for signal in row["signals"]
                ),
            }
            for row in scoped
        ],
        empty="No evaluated students match these filters.",
        column_config={
            "Score": st.column_config.ProgressColumn(
                "Score", min_value=0, max_value=100, format="%d"
            )
        },
    )
    flagged = [row for row in scoped if row.get("flagged")]
    if flagged:
        st.markdown("##### Why each student was flagged")
        if len(flagged) > 8 and not st.toggle(
            f"Show all {len(flagged)} flagged students", key="risk_show_all_flagged"
        ):
            st.caption(
                f"Showing the first 8 of {len(flagged)} flagged students. Switch the toggle on to list everyone."
            )
            flagged = flagged[:8]
    for row in flagged:
        with st.expander(
            f"{labels.pretty_name(row['studentName'])} · {labels.risk_label(row['band'])} · score {row['score']}",
            icon=":material/flag:",
        ):
            st.markdown(ui.risk_md(row.get("band"), row.get("score")))
            ui.html_block(ui.signal_chips(row["signals"]))
            ui.plain_text(row["reviewPath"], muted=True)
            dataframe(
                [
                    {
                        "Signal": labels.signal_label(signal["code"]),
                        "Source": labels.source_label(signal["source"]),
                        "Value": signal["value"],
                        "Threshold": signal["threshold"],
                        "Points": signal["points"],
                        "Reason": labels.readable_claim(signal["explanation"]),
                    }
                    for signal in row["signals"]
                ]
            )


def render_outcomes(queue: dict[str, Any], actor: dict[str, Any]) -> None:
    plans = queue.get("plans") or []
    ui.section(
        "Intervention outcomes",
        "Approved plans, what happened next, and the immutable history of every decision.",
        icon=":material/timeline:",
    )
    if not plans:
        ui.empty_state(
            "No approved plans yet",
            "Plans appear here after a mentor approves a draft.",
        )
        return
    # Every figure below counts the same approved plans by their current status;
    # the log lists the same plans first, then the changes that led to that status.
    outcome = labels.outcome_counts(plans)
    ui.kpi_row_nonzero(
        [
            {
                "label": "Approved plans",
                "value": outcome["plans"],
                "icon": ":material/verified:",
            },
            {
                "label": "Planned",
                "value": outcome["planned"],
                "icon": ":material/event:",
                "help": "Approved and not started yet. A plan that was withdrawn and then restored is planned again.",
            },
            {
                "label": "In progress",
                "value": outcome["in_progress"],
                "icon": ":material/pending:",
            },
            {
                "label": "Completed",
                "value": outcome["completed"],
                "icon": ":material/task_alt:",
            },
            {
                "label": "Withdrawn",
                "value": outcome["withdrawn"],
                "icon": ":material/undo:",
            },
        ]
    )
    log_rows = [
        {
            "Student": labels.pretty_name(row.get("display_name")),
            "Approved actions": "; ".join(
                action.get("label", "")
                for action in (row.get("plan") or {}).get("actions", [])
            ),
            "Row": "Plan, current status",
            "Status": labels.status_label(row.get("status")),
            "Outcome": row.get("outcome"),
            "Visible": "Yes" if row.get("visible_to_student") else "No",
            "Decision": labels.status_label(row.get("decision")),
            "Decided by": row.get("decided_by"),
            "Decision time": labels.nice_time(row.get("decided_at")),
            "Rationale": row.get("rationale"),
        }
        for row in plans
    ]
    log_rows.extend(
        {
            "Student": labels.pretty_name(event.get("student_name")),
            "Approved actions": "",
            "Row": "Earlier change",
            "Status": labels.status_label((event.get("payload") or {}).get("status")),
            "Outcome": (event.get("payload") or {}).get("outcome"),
            "Visible": "Recorded event",
            "Decision": labels.humanize(event.get("event_type")),
            "Decided by": event.get("actor_name"),
            "Decision time": labels.nice_time(event.get("occurred_at")),
            "Rationale": "Immutable intervention history",
        }
        for event in queue.get("interventionLog", [])
    )
    log_head, log_button = st.columns([3, 1], vertical_alignment="bottom")
    with log_head:
        st.markdown("##### Intervention log")
        st.caption(
            f"{outcome['plans']} plan{'s' if outcome['plans'] != 1 else ''} with their current status, followed by "
            f"{len(queue.get('interventionLog', []))} earlier change{'s' if len(queue.get('interventionLog', [])) != 1 else ''}. "
            "The counts above use the current status only."
        )
    with log_button:
        st.download_button(
            "Download intervention log CSV",
            pd.DataFrame(log_rows).to_csv(index=False),
            file_name="intervention-log.csv",
            mime="text/csv",
            on_click="ignore",
            icon=":material/download:",
            width="stretch",
        )
    dataframe(log_rows)
    if actor.get("role") != "faculty":
        return
    with ui.card("intervention_update"):
        st.markdown("##### Update an intervention")
        selected = pick(
            "Intervention",
            plans,
            format_func=lambda row: (
                f"{labels.pretty_name(row.get('display_name', 'Student'))} · {labels.status_label(row.get('status', 'planned'))} · {labels.short_ref(row.get('id'))}"
            ),
            key="intervention_plan",
        )
        versions = [
            v
            for v in queue.get("versions", [])
            if v["support_plan_id"] == selected["id"]
        ]
        if versions:
            st.caption(":material/history: Approved publication history")
            dataframe(
                [
                    {
                        "Version": v["version"],
                        "Published": labels.nice_time(v["created_at"]),
                        "Reference": labels.short_ref(v["content_hash"], 10),
                    }
                    for v in versions
                ]
            )
            restore_cols = st.columns(min(len(versions), 4))
            for index, version in enumerate(versions):
                with restore_cols[index % len(restore_cols)]:
                    if st.button(
                        f"Restore version {version['version']}",
                        key=f"restore_{selected['id']}_{version['version']}",
                        icon=":material/restore:",
                        width="stretch",
                    ):
                        save_action(
                            "version_restore",
                            {
                                "planId": selected["id"],
                                "version": version["version"],
                                "expectedVersion": max(v["version"] for v in versions),
                            },
                            "Earlier approved version restored as a new publication.",
                        )
        current = selected.get("status", "planned")
        statuses = ["planned", "in_progress", "completed", "withdrawn"]
        with st.form("record_outcome", border=False):
            status = pick(
                "Status",
                statuses,
                index=statuses.index(current) if current in statuses else 0,
                format_func=lambda item: (
                    "Withdraw plan"
                    if item == "withdrawn"
                    else labels.status_label(item)
                ),
            )
            outcome = st.text_area(
                "Outcome or reason for withdrawal",
                value=str(selected.get("outcome", "") or ""),
                max_chars=1200,
            )
            submitted = st.form_submit_button("Save outcome", type="primary")
        if submitted:
            if len(outcome.strip()) < 12:
                st.error(
                    "Enter an outcome or withdrawal reason of at least twelve characters."
                )
            else:
                save_action(
                    "outcome",
                    {
                        "planId": selected["id"],
                        "expectedRevision": int(selected.get("revision", 0)),
                        "status": status,
                        "outcome": outcome.strip(),
                    },
                    "Intervention outcome saved.",
                )


def check_line(name: str, result: Any) -> str:
    label = CHECK_LABELS.get(name, labels.humanize(name))
    if result is True:
        return f":green[:material/check_circle:] {label}"
    if result is False:
        return f":red[:material/cancel:] {label}"
    return f":gray[:material/remove_circle_outline:] {label} · not recorded for this version"


def render_planner_trace(body: dict[str, Any]) -> None:
    """How the planner agent read the request: tool calls, turns, provider, fallback."""
    agent = body.get("agent")
    if not isinstance(agent, dict):
        return
    with st.expander("How the planner read this request", icon=":material/psychology:"):
        rows = agent_rows(agent, "Planner", "Planner (tools not used)")
        source = agent.get("questionSource")
        if source:
            rows.append(
                {
                    "Step": "Questions came from",
                    "Detail": {
                        "model": "the planner model, about this request",
                        "model+rules": "the planner model, topped up by the standard rule questions",
                        "rules": "the standard rule questions (a plan saved before the rule-based path was retired)",
                    }.get(str(source), labels.humanize(source)),
                }
            )
        criteria = body.get("filter")
        names = {
            "allMine": "all my mentees",
            "semesterMin": "from semester",
            "semesterMax": "up to semester",
            "attendanceBelowPct": "attendance below (%)",
            "markBelowPct": "marks below (%)",
        }
        if isinstance(criteria, dict) and criteria:
            rows.append(
                {
                    "Step": "Student criteria",
                    "Detail": ", ".join(
                        names.get(str(k), labels.humanize(k))
                        + ("" if v is True else f" {v}")
                        for k, v in criteria.items()
                    ),
                }
            )
        dataframe(rows)
        render_tool_calls(agent)
        understood = body.get("agentSteps") or []
        if understood:
            st.markdown("**What the planner understood**")
            for number, step in enumerate(understood, 1):
                st.markdown(f"{number}. {ui._md_safe(step)}")
        st.caption(
            "The planner only drafts. It resolves students from your own scope on the server, "
            "and you decide when the plan is locked and run."
        )


def provenance_rows(
    validation: dict[str, Any],
    mode: Any,
    model_id: Any,
    evidence_values: Any = None,
) -> list[dict[str, str]]:
    """Plain-text rows describing how a draft was produced (mentor/governance only)."""
    rows = _provenance_rows(validation, mode, model_id)
    academic = (evidence_values or {}).get("academic") if isinstance(evidence_values, dict) else None
    basis = academic.get("attendanceBasis") if isinstance(academic, dict) else None
    if basis:
        rows.append(
            {"Step": "Attendance figures", "Detail": labels.attendance_basis_label(basis)}
        )
    return rows


def _provenance_rows(
    validation: dict[str, Any], mode: Any, model_id: Any
) -> list[dict[str, str]]:
    prov = validation.get("provenance") if isinstance(validation, dict) else None
    if not isinstance(prov, dict):
        return [
            {
                "Step": "Drafted by",
                "Detail": f"{labels.mode_label(mode)}{' · ' + str(model_id) if model_id else ''}",
            },
            {"Step": "Trace", "Detail": "Recorded before provider tracing (packet v1)"},
        ]
    egress = [e for e in prov.get("egress") or [] if isinstance(e, dict)]
    sent = [e for e in egress if e.get("outcome") == "sent"]
    blocked = [e for e in egress if e.get("outcome") == "blocked"]
    rows = [
        {
            "Step": "Provider",
            "Detail": labels.provider_label(prov.get("provider"))
            if prov.get("provider")
            else labels.mode_label(mode),
        },
        {"Step": "Model", "Detail": str(prov.get("model") or "not recorded")},
        {"Step": "Specialist", "Detail": labels.domain_label(prov.get("specialist"))},
        {
            "Step": "Packet format",
            "Detail": str(validation.get("packetSchema") or "packet-v1"),
        },
        {
            "Step": "Repairs",
            "Detail": str(prov.get("repairs", len(validation.get("repairs") or []))),
        },
        {
            "Step": "Fallback reason",
            "Detail": str(prov.get("fallbackReason") or "none"),
        },
    ]
    for fallback in prov.get("fallbacks") or []:
        rows.append(
            {
                "Step": "Provider skipped",
                "Detail": f"{labels.provider_label(fallback.get('provider'))} {fallback.get('model', '')}: {fallback.get('reason', '')}",
            }
        )
    if prov.get("tokens"):
        rows.append({"Step": "Tokens reported", "Detail": str(prov.get("tokens"))})
    if not egress:
        remote = "none (local model only)"
    elif any("reached" in e for e in sent):
        reached = [e for e in sent if e.get("reached")]
        remote = (
            f"{len(sent)} passed the privacy guard, {len(reached)} reached the model"
            + (f", {len(blocked)} stopped by the guard" if blocked else "")
        )
    else:
        remote = f"{len(sent)} sent, {len(blocked)} stopped by the privacy guard"
    rows.append({"Step": "Remote requests", "Detail": remote})
    for item in sent[-2:]:
        rows.append(
            {
                "Step": "Egress audit hash",
                "Detail": f"{str(item.get('payloadHash', ''))[:16]}… · {item.get('bytes', '?')} bytes · {len(item.get('fields') or [])} fields",
            }
        )
    for item in blocked:
        rows.append(
            {
                "Step": "Privacy guard",
                "Detail": f"Refused: {labels.humanize(item.get('category'))}",
            }
        )
    rows.extend(agent_rows(prov.get("agent")))
    rows.extend(judge_rows(prov.get("judge") or validation.get("judge")))
    for item in prov.get("injected") or []:
        if isinstance(item, dict):
            rows.append(
                {
                    "Step": "Injected for testing",
                    "Detail": f"{labels.humanize(item.get('kind'))} fault set by the test harness, not a natural failure",
                }
            )
    return rows


def judge_rows(judge: Any) -> list[dict[str, str]]:
    """The judge agent's scores and reasons (mentor and governance panels)."""
    if not isinstance(judge, dict):
        return []
    where = (
        f"{labels.provider_label(judge.get('provider'))} · {judge.get('model') or 'model not recorded'}"
        if judge.get("provider")
        else "no model answered"
    )
    if judge.get("status") != "scored":
        return [
            {
                "Step": "Judge",
                "Detail": f"Judge unavailable ({labels.humanize(judge.get('unavailableReason'))}); the draft was not blocked",
            }
        ]
    scores = judge.get("scores") or {}
    reasons = judge.get("reasons") or {}
    verdict = "passed" if judge.get("passed") else "needs repair"
    rows = [
        {
            "Step": "Judge",
            "Detail": f"{where} · mean {judge.get('mean')} of 5 · lowest {judge.get('min')} · {verdict}",
        },
        {
            "Step": "Judge scores",
            "Detail": " · ".join(
                f"{labels.humanize(name)} {scores.get(name, '?')}"
                for name in labels.JUDGE_DIMENSIONS
            ),
        },
    ]
    for name in labels.JUDGE_DIMENSIONS:
        if reasons.get(name):
            rows.append({"Step": f"Judge: {name}", "Detail": str(reasons[name])})
    previous = judge.get("previous")
    if isinstance(previous, dict) and previous.get("status") == "scored":
        first = previous.get("scores") or {}
        rows.append(
            {
                "Step": "Judge first look",
                "Detail": " · ".join(
                    f"{labels.humanize(n)} {first.get(n, '?')}"
                    for n in labels.JUDGE_DIMENSIONS
                )
                + f" · repair {previous.get('repair') or 'not needed'}",
            }
        )
    elif judge.get("repair"):
        rows.append(
            {
                "Step": "Judge repair",
                "Detail": f"One targeted repair was {judge['repair']}",
            }
        )
    return rows


def _tool_arguments(raw: Any) -> str:
    """Aliased tool arguments as short key=value text (plain text, no markup)."""
    if not isinstance(raw, dict):
        return "—"
    parts = []
    for key, value in list(raw.items())[:6]:
        if isinstance(value, (str, int, float, bool)):
            parts.append(f"{str(key)[:24]}={str(value)[:40]}")
    return ", ".join(parts) or "—"


def agent_rows(
    agent: Any,
    label: str = "Investigator",
    fallback_text: str = "Standard evidence set (tools not used)",
) -> list[dict[str, str]]:
    """Summary rows for an agent loop: turns, tool calls, provider and any fallback."""
    if not isinstance(agent, dict):
        return []
    calls = [c for c in agent.get("toolCalls") or [] if isinstance(c, dict)]
    ok = sum(1 for c in calls if c.get("status") == "ok")
    stopped = len(calls) - ok
    used_tools = agent.get("mode") == "tools"
    budget = agent.get("budget") or {}
    rows = [
        {
            "Step": label,
            "Detail": (
                f"{'Used tools' if used_tools else fallback_text} · "
                f"{agent.get('turns', 0)} of {budget.get('maxTurns', 2)} tool turns · "
                f"{ok} of {budget.get('maxToolCalls', 4)} tool calls ran"
                + (f", {stopped} refused" if stopped else "")
            ),
        }
    ]
    if agent.get("provider"):
        rows.append(
            {
                "Step": "Agent provider",
                "Detail": f"{labels.provider_label(agent.get('provider'))} · {agent.get('model') or 'model not recorded'}",
            }
        )
    if agent.get("evidenceValues"):
        rows.append(
            {
                "Step": "Evidence added",
                "Detail": f"{agent['evidenceValues']} tool values appended to the evidence snapshot",
            }
        )
    reason = agent.get("fallbackReason") or agent.get("skippedReason")
    if reason:
        rows.append({"Step": "Agent fallback", "Detail": str(reason)})
    return rows


def tool_call_rows(agent: Any) -> list[dict[str, Any]]:
    if not isinstance(agent, dict):
        return []
    return [
        {
            "#": call.get("seq"),
            "Turn": call.get("turn"),
            "Tool": labels.tool_label(call.get("tool")),
            "Arguments": _tool_arguments(call.get("args")),
            "Outcome": "Ran"
            if call.get("status") == "ok"
            else f"Refused · {labels.humanize(call.get('code'))}"
            if call.get("status") == "refused"
            else f"Failed · {labels.humanize(call.get('code'))}",
            "Result size (bytes)": call.get("resultBytes"),
            "Result hash": str(call.get("resultHash") or "")[:12] or "—",
        }
        for call in agent.get("toolCalls") or []
        if isinstance(call, dict)
    ]


def render_tool_calls(agent: Any) -> None:
    """Tool calls the agent made (name, aliased arguments, result size), refused ones included."""
    if not isinstance(agent, dict):
        return
    rows = tool_call_rows(agent)
    if rows:
        dataframe(rows)
        st.caption(
            "Arguments are aliases and numbers only. Results are stored as a hash and a size; "
            "the numbers they returned sit in the evidence snapshot under their own paths."
        )
    elif agent.get("mode") == "tools":
        st.caption(
            ":material/search_off: The agent asked for no look-ups beyond the standard evidence."
        )


def repair_diagnosis_rows(validation: Any) -> tuple[list[dict[str, str]], bool]:
    """One row per diagnosed failure, tagged with its repair attempt (Brief 16-lite).

    Older reports have no stored diagnoses, so each row falls back to the plain wording
    of its failed check; the flag says so.
    """
    attempts = validation.get("repairs") if isinstance(validation, dict) else None
    rows: list[dict[str, str]] = []
    fallback = False
    for item in attempts or []:
        found, used_fallback = labels.diagnosis_rows(item)
        fallback = fallback or used_fallback
        rows.extend({"Attempt": str(item.get("attempt", "—")), **row} for row in found)
    return rows, fallback


DIAGNOSIS_FALLBACK_NOTE = (
    "Recorded before targeted diagnoses were stored, so this shows the standard wording "
    "for each failed check."
)


def render_diagnoses(validation: Any) -> None:
    """Targeted diagnoses: every repair attempt, then the latest open ones."""
    if not isinstance(validation, dict):
        return
    rows, fallback = repair_diagnosis_rows(validation)
    latest, latest_fallback = labels.diagnosis_rows(validation)
    rows.extend({"Attempt": "Latest", **row} for row in latest)
    if not rows:
        return
    dataframe(rows)
    st.caption(
        DIAGNOSIS_FALLBACK_NOTE
        if fallback or latest_fallback
        else "Each fix request names the failing part by code and position, with evidence references only: no names, dates or draft text."
    )


def render_draft_provenance(
    selected: dict[str, Any], validation: dict[str, Any]
) -> None:
    with st.expander("How this was made", icon=":material/route:"):
        checks = validation.get("checks") or {}
        checks = checks if isinstance(checks, dict) else {}
        ui.judge_chip_block(validation.get("judge"))
        st.markdown("**Checks that ran on this version**")
        for name in CHECK_LABELS:
            st.markdown(check_line(name, checks.get(name)))
        st.caption(
            f"Drafted by: {labels.mode_label(selected.get('mode'))}"
            + (f" · {selected.get('model_id')}" if selected.get("model_id") else "")
        )
        if validation.get("fallback"):
            st.caption(
                ":material/swap_horiz: A rule-based fallback produced this draft (a path that has been retired)."
            )
        if validation.get("providerError"):
            st.caption(
                f":material/cloud_off: Model issue: {labels.issue_label(validation.get('providerError'))}"
            )
        repairs = validation.get("repairs", [])
        if repairs:
            st.caption(
                f":material/build: {len(repairs)} targeted repair attempt(s) before review."
            )
        dataframe(
            provenance_rows(
                validation,
                selected.get("mode"),
                selected.get("model_id"),
                selected.get("evidence_values"),
            )
        )
        render_tool_calls(((validation or {}).get("provenance") or {}).get("agent"))
        st.caption(
            "Remote models receive anonymised numbers only (case alias, values, thresholds, course aliases); "
            "aliases are restored on the server after validation. "
            "Reports describe the checks that existed when this version was recorded."
        )


def draft_option_label(
    row: dict[str, Any], risk_by_student: dict[str, dict[str, Any]]
) -> str:
    """One line that tells drafts apart: student, register number, risk, version, time (#15)."""
    risk = risk_by_student.get(str(row.get("student_id"))) or {}
    parts = [
        labels.pretty_name(row.get("display_name", "Student")),
        str(row.get("register_number") or ""),
        f"{labels.risk_label(risk['band'])} {risk.get('score', '')}".strip()
        if risk.get("band")
        else "",
        f"version {labels.version_number(row.get('artifact_version'))}",
        labels.nice_time(row.get("drafted_at")),
    ]
    return " · ".join(part for part in parts if part)


def plan_label(plan: dict[str, Any]) -> str:
    """One line that tells review plans apart: request, state, date and reference (#15)."""
    body = plan.get("body") or {}
    request = " ".join(str(body.get("request") or "Review plan").split())
    short = request if len(request) <= 56 else request[:55].rstrip() + "…"
    raw = value(
        plan, "created_at", "createdAt", "updated_at", "updatedAt", default=None
    )
    parts = [
        short,
        labels.status_label(plan.get("status")) if plan.get("status") else "",
        labels.nice_time(raw) if raw else "",
        labels.short_ref(plan.get("id")),
    ]
    return " · ".join(part for part in parts if part)


def render_draft_reviews(
    queue: dict[str, Any],
    actor: dict[str, Any],
    risk_by_student: dict[str, dict[str, Any]],
) -> None:
    drafts = queue.get("drafts") or []
    is_mentor = actor.get("role") == "faculty"
    ui.section(
        "Drafts at the gate" if is_mentor else "Drafts waiting on mentors",
        "Drafts the agents prepared for flagged students. Nothing reaches a student or family until you approve it."
        if is_mentor
        else "Drafts waiting on each student's assigned mentor. Nothing reaches a student or family until that mentor approves it.",
    )
    if not drafts:
        ui.empty_state(
            "Nothing is waiting for you"
            if is_mentor
            else "Nothing is waiting on a mentor",
            "When a review run drafts support for a flagged student, it appears here for your decision."
            if is_mentor
            else "When a review run drafts support for a flagged student, it appears here until the mentor decides.",
        )
        if queue.get("legacyDrafts"):
            st.caption(
                f":material/inventory_2: Older drafts from the retired rule-based path are kept below, read-only ({len(queue['legacyDrafts'])})."
            )
        return
    if not is_mentor:
        # Department oversight: who is waiting on a mentor, never the draft's
        # content, risk score or evidence (the Core does not send them either).
        dataframe(
            [
                {
                    "Student": labels.pretty_name(row.get("display_name", "Student")),
                    "Register number": row.get("register_number", "Not listed"),
                    "Status": "Awaiting the assigned mentor"
                    if row.get("status") == "awaiting_faculty"
                    else labels.status_label(row.get("status")),
                    "Drafted by": labels.mode_label(row.get("mode")),
                    "Drafted": labels.nice_time(row.get("drafted_at")),
                    "Earlier drafts": row.get("earlier_count") or 0,
                }
                for row in drafts
            ]
        )
        st.caption(
            ":material/lock: One row per student, showing the latest AI draft. Draft contents, risk scores and evidence are visible only to the student's assigned mentor."
        )
        return
    if len(drafts) > 1:
        selected = pick(
            "Draft",
            drafts,
            format_func=lambda row: draft_option_label(row, risk_by_student),
            key="support_draft",
        )
    else:
        selected = drafts[0]
    if selected.get("earlier_drafts"):
        with st.expander(
            f"Earlier drafts for this student ({len(selected['earlier_drafts'])})",
            icon=":material/history:",
        ):
            st.caption(
                "Newer drafts replace these in the queue. They stay on record, read-only, and are not counted as waiting."
            )
            dataframe(
                [
                    {
                        "Draft version": labels.version_number(
                            e.get("artifact_version")
                        ),
                        "Drafted": labels.nice_time(e.get("drafted_at")),
                        "Review cycle opened": labels.nice_time(e.get("opened_at")),
                        "Case": labels.short_ref(e.get("case_id")),
                    }
                    for e in selected["earlier_drafts"]
                ]
            )
    packet = selected.get("recommendation") or {}
    validation = selected.get("validation") or {}
    is_v2 = packet.get("schema") == "packet-v2"
    evidence_values = selected.get("evidence_values") or {}
    cited_signals = selected.get("signals") or []
    cited_policy = selected.get("policy") or {}
    student_name = labels.pretty_name(selected.get("display_name", "Student"))
    edit_key = f"edit_open_{selected['id']}_{selected.get('artifact_id')}"
    with st.container(border=True, key="gate_decision"):
        ui.sheet_header(
            "Approve this plan?",
            " · ".join(
                part
                for part in (student_name, str(selected.get("register_number") or ""))
                if part
            ),
        )
        ui.sheet_paragraph(packet.get("summary") or "No summary recorded.")
        headline, tone, _icon = labels.validation_headline(validation)
        ui.html_block(
            '<div class="aura-meta">'
            + ui.status_html(headline, tone)
            + "</div>"
        )
        ui.provenance_caption()
        if validation.get("mentorEdited"):
            st.caption(
                ":material/edit: This version includes edits by the mentor account."
            )
        actions = packet.get("actions") or []
        if actions:
            ui.sheet_heading("What happens next")
            ui.inset_list(
                [
                    {
                        "title": row.get("label"),
                        "sub": " · ".join(
                            part
                            for part in (
                                ACTION_OWNER_LABELS.get(
                                    row.get("owner"), labels.humanize(row.get("owner"))
                                ),
                                f"within {row.get('dueInDays')} days"
                                if row.get("dueInDays") is not None
                                else "",
                            )
                            if part
                        ),
                    }
                    for row in actions
                    if isinstance(row, dict)
                ],
                flat=True,
            )
        if is_v2 and packet.get("rationale"):
            st.markdown("#### Why this draft")
            ui.html_block(
                "".join(
                    f'<p class="aura-claim">{ui.esc(sentence.get("text"))}</p>'
                    + ui.claim_chips(
                        sentence.get("citations"),
                        evidence_values,
                        cited_signals,
                        cited_policy,
                    )
                    for sentence in packet.get("rationale") or []
                    if isinstance(sentence, dict)
                )
            )
        if is_v2 and actions:
            with st.expander("Talking points for each step", icon=":material/forum:"):
                parts = []
                for row in actions:
                    points = "".join(
                        f"<li>{ui.esc(point)}</li>"
                        for point in row.get("talkingPoints") or []
                    )
                    parts.append(
                        f'<p class="aura-sheet-h">{ui.esc(row.get("label") or "Action")}</p>'
                        f'<p class="aura-claim">{ui.esc(row.get("personalisation"))}</p>'
                        + (f"<ul>{points}</ul>" if points else "")
                        + ui.claim_chips(
                            row.get("citations"),
                            evidence_values,
                            cited_signals,
                            cited_policy,
                        )
                    )
                ui.html_block("".join(parts))
        if packet.get("citations") and not (is_v2 and packet.get("rationale")):
            st.markdown("#### Evidence cited")
            ui.citation_chips(packet.get("citations", []))
        render_draft_provenance(selected, validation)
        repairs = validation.get("repairs", [])
        if repairs:
            with st.expander("Repair history", icon=":material/build:"):
                rows, fallback = repair_diagnosis_rows(validation)
                dataframe(
                    rows, empty="No failed checks were recorded for these attempts."
                )
                st.caption(
                    DIAGNOSIS_FALLBACK_NOTE
                    if fallback
                    else "Only the failing parts were rewritten each time; the rest stayed as drafted."
                )
        open_rows, open_fallback = labels.diagnosis_rows(validation)
        if open_rows:
            with st.expander("Open issues", icon=":material/report:"):
                dataframe(open_rows)
                st.caption(
                    DIAGNOSIS_FALLBACK_NOTE
                    if open_fallback
                    else "The latest diagnosis of what is still wrong and the fix that was requested."
                )
        if actor.get("role") != "faculty":
            st.info("This view is read-only for your role.", icon=":material/visibility:")
            return
        with st.form(
            f"decide_draft_{selected['id']}_{selected.get('artifact_id')}", border=False
        ):
            rationale = st.text_area(
                "Decision rationale",
                max_chars=600,
                placeholder="A short reason, kept with the decision",
            )
            approve_col, edit_col, decline_col = st.columns(
                [1.7, 0.9, 1], vertical_alignment="center"
            )
            with approve_col:
                approved = st.form_submit_button(
                    "Approve and publish", type="primary", width="stretch"
                )
            with edit_col:
                edit_clicked = st.form_submit_button("Edit", width="stretch")
            with decline_col:
                declined = st.form_submit_button(
                    "Decline",
                    type="tertiary",
                    width="stretch",
                    key=f"danger_decline_{selected['id']}",
                )
        decision_head(selected)
        if edit_clicked:
            st.session_state[edit_key] = True
        if approved or declined:
            if len(rationale.strip()) < 8:
                st.error("Enter a decision rationale of at least eight characters.")
            else:
                save_action(
                    "case_decide",
                    {
                        "caseId": selected["id"],
                        "expectedRevision": int(selected["revision"]),
                        "artifactId": selected["artifact_id"],
                        "contentHash": selected["content_hash"],
                        "decision": "approved" if approved else "rejected",
                        "rationale": rationale.strip(),
                    },
                    "Decision saved against the displayed draft version.",
                )
        with st.expander(
            "Edit the draft",
            icon=":material/edit_document:",
            expanded=bool(st.session_state.get(edit_key)),
        ):
            st.caption(
                "Saving creates a new version that is validated again. The decision above always applies to the version shown."
            )
            with st.form(
                f"edit_draft_{selected['id']}_{selected.get('artifact_id')}",
                border=False,
            ):
                summary = st.text_area(
                    "Recommendation summary",
                    value=str(packet.get("summary", "")),
                    max_chars=600,
                )
                action_rows = [
                    {
                        "Action": row.get("label", ""),
                        "Owner": ACTION_OWNER_LABELS.get(
                            row.get("owner"), "Assigned faculty"
                        ),
                        "Due in days": int(row.get("dueInDays", 7)),
                    }
                    for row in actions
                ]
                edited_actions = st.data_editor(
                    pd.DataFrame(action_rows),
                    column_config={
                        "Action": st.column_config.TextColumn("Action", max_chars=180),
                        "Owner": st.column_config.SelectboxColumn(
                            "Owner",
                            options=list(ACTION_OWNER_LABELS.values()),
                            required=True,
                        ),
                        "Due in days": st.column_config.NumberColumn(
                            "Due in days", min_value=1, max_value=14, step=1
                        ),
                    },
                    hide_index=True,
                    num_rows="fixed",
                    width="stretch",
                    key=f"draft_actions_{selected['id']}_{selected.get('artifact_id')}",
                )
                edit_rationale = st.text_area("Reason for this edit", max_chars=600)
                edit_submitted = st.form_submit_button(
                    "Save new draft version", icon=":material/edit_document:"
                )
            if edit_submitted:
                edited = edited_actions.to_dict(orient="records")
                original_codes = [row.get("code") for row in actions]
                for index, row in enumerate(edited):
                    # packet-v2 keeps each action's personalisation, talking
                    # points and citations; the edit is revalidated server-side.
                    for key, value in (actions[index] or {}).items():
                        if key not in {"code", "label", "owner", "dueInDays"}:
                            row[key] = value
                    row["code"] = original_codes[index]
                    row["label"] = str(row.pop("Action", "")).strip()
                    row["owner"] = {
                        label: code for code, label in ACTION_OWNER_LABELS.items()
                    }.get(
                        str(row.get("Owner", "Assigned faculty")), "assigned_faculty"
                    )
                    row["dueInDays"] = int(row.get("Due in days", 7))
                    row.pop("Owner", None)
                    row.pop("Due in days", None)
                updated_packet = {
                    **packet,
                    "summary": summary.strip(),
                    "actions": edited,
                    "citations": packet.get("citations", []),
                    "prohibited": packet.get("prohibited", []),
                }
                if len(edit_rationale.strip()) < 12:
                    st.error("Enter an edit reason of at least twelve characters.")
                else:
                    save_action(
                        "draft_edit",
                        {
                            "caseId": selected["id"],
                            "expectedRevision": int(selected["revision"]),
                            "artifactId": selected["artifact_id"],
                            "packet": updated_packet,
                            "rationale": edit_rationale.strip(),
                        },
                        "A new draft version was saved.",
                    )
        ui.tech_details(
            [
                ("Case reference", selected.get("id")),
                ("Draft version reference", selected.get("artifact_id")),
                ("Content hash", selected.get("content_hash")),
                ("Case revision", selected.get("revision")),
            ]
        )


def decision_head(selected: dict[str, Any]) -> None:
    """Exact version and content hash of the draft being decided, in small tertiary text."""
    ui.decision_head(
        f"{labels.version_number(selected.get('artifact_version'))} · {labels.nice_time(selected.get('drafted_at'))}",
        selected.get("content_hash"),
    )


def render_legacy_drafts(queue: dict[str, Any], actor: dict[str, Any]) -> None:
    """Drafts written by the retired rule-based path: viewable, read-only, undecided."""
    legacy = queue.get("legacyDrafts") or []
    if not legacy:
        return
    is_mentor = actor.get("role") == "faculty"
    with st.expander(
        f"Legacy drafts ({len(legacy)})", expanded=False, icon=":material/inventory_2:"
    ):
        st.caption(
            "These were written by the rule-based path that has been retired. They stay on record and "
            "undecided: nothing here can be approved, edited or published. Run a new AI review for the "
            "student to replace one."
        )
        dataframe(
            [
                {
                    "Student": labels.pretty_name(row.get("display_name", "Student")),
                    "Register number": row.get("register_number", "Not listed"),
                    "Status": "Undecided, read-only",
                    "Drafted by": labels.mode_label(row.get("mode")),
                    "Drafted": labels.nice_time(row.get("drafted_at")),
                }
                for row in legacy
            ]
        )
        if not is_mentor:
            return
        picked = pick(
            "Legacy draft",
            legacy,
            format_func=lambda row: (
                f"{labels.pretty_name(row.get('display_name', 'Student'))} · "
                f"{row.get('register_number', '')} · {labels.nice_time(row.get('drafted_at'))}"
            ),
            key="legacy_draft",
        )
        packet = picked.get("recommendation") or {}
        ui.plain_text(packet.get("summary") or "No summary recorded.")
        rows = [
            {
                "Action": item.get("label"),
                "Due in days": item.get("dueInDays"),
            }
            for item in packet.get("actions") or []
            if isinstance(item, dict)
        ]
        if rows:
            dataframe(rows)
        ui.tech_details(
            [
                ("Case reference", picked.get("id")),
                ("Draft version reference", picked.get("artifact_id")),
                ("Content hash", picked.get("content_hash")),
            ]
        )


