from __future__ import annotations

import html
import json
import os
import uuid
from collections import Counter
from datetime import UTC, datetime, time, timedelta

import pandas as pd
import streamlit as st
from pydantic import ValidationError

from student_success.access import (
    DEMO_IDENTITIES,
    DemoIdentity,
    UserRole,
    allowed_pages,
    require_case_access,
)
from student_success.application import StudentSuccessApplication
from student_success.contracts.models import (
    CasePacket,
    CaseStatus,
    DataState,
    DecisionType,
    InterventionStatus,
    MentorDecision,
    allowed_intervention_statuses,
)
from student_success.ecosystem import EcosystemService
from student_success.generation.faults import UnsafeOnceGenerator
from student_success.ui.theme import CSS

st.set_page_config(
    page_title="AURA Student Success",
    page_icon="◇",
    layout="wide",
    initial_sidebar_state="expanded",
)
st.markdown(CSS, unsafe_allow_html=True)


@st.cache_resource
def get_app() -> StudentSuccessApplication:
    return StudentSuccessApplication(generator_mode="auto")


def safe(value: object) -> str:
    return html.escape(str(value))


def refresh() -> None:
    st.cache_data.clear()
    st.rerun()


def metric_cards(items: list[tuple[str, object, str]]) -> None:
    columns = st.columns(len(items))
    for column, (label, value, sub) in zip(columns, items):
        column.markdown(
            "<div class='metric-card'>"
            f"<div class='label'>{safe(label)}</div>"
            f"<div class='value'>{safe(value)}</div>"
            f"<div class='sub'>{safe(sub)}</div>"
            "</div>",
            unsafe_allow_html=True,
        )


def page_header(kicker: str, title: str, lede: str, identity: DemoIdentity) -> None:
    st.markdown(f"<div class='eyebrow'>{safe(kicker)}</div>", unsafe_allow_html=True)
    st.title(title)
    st.markdown("<div class='hero-rule'></div>", unsafe_allow_html=True)
    st.markdown(f"<div class='lede'>{safe(lede)}</div>", unsafe_allow_html=True)
    st.write("")
    st.markdown(
        f"<span class='role-ribbon'>{safe(identity.label)} · {safe(identity.role.value)}</span>",
        unsafe_allow_html=True,
    )
    st.write("")


def latest_case_for(app: StudentSuccessApplication, student_ref: str):
    return next(
        (
            case
            for case in app.repository.list_cases()
            if case.student_ref == student_ref
        ),
        None,
    )


def seed_ecosystem(app: StudentSuccessApplication) -> None:
    service = EcosystemService(app.repository, app.settings.fixtures_path)
    if app.repository.list_cases():
        app.repository.reconcile_approved_interventions()
        if not app.repository.list_cohort_runs():
            latest_cases = list(service.latest_cases().values())
            imported = app.repository.start_cohort_run(
                service.roster["cohort_id"],
                "ecosystem-migration",
                len(latest_cases),
                run_id="COHORT-LEGACY-IMPORT-V1",
            )
            for case in latest_cases:
                app.repository.attach_case_to_cohort_run(imported.run_id, case.case_id)
            app.repository.complete_cohort_run(imported.run_id)
        return
    cohort_run = app.repository.start_cohort_run(
        service.roster["cohort_id"],
        "demo-admin",
        len(service.roster["students"]),
        run_id="COHORT-BOOTSTRAP-V1",
    )
    try:
        for profile in service.roster["students"]:
            student_ref = profile["student_ref"]
            builder = app
            if student_ref == "SYN-0002":
                builder = StudentSuccessApplication(
                    settings=app.settings,
                    generator=UnsafeOnceGenerator(),
                )
            case = builder.create_case(
                student_ref,
                assigned_mentor=profile["mentor_id"],
                request_id=f"ECOSYSTEM-SEED:{student_ref}",
            )
            app.repository.attach_case_to_cohort_run(cohort_run.run_id, case.case_id)
            if case.status == CaseStatus.CREATED:
                builder.workflow.process_case(case.case_id)

        stale_case = latest_case_for(app, "SYN-0004")
        if stale_case and stale_case.status == CaseStatus.DATA_BLOCKED:
            app.apply_bundled_correction(stale_case.case_id)
            app.workflow.process_case(stale_case.case_id)

        approved_case = latest_case_for(app, "SYN-0001")
        if approved_case and approved_case.status == CaseStatus.AWAITING_MENTOR:
            app.workflow.decide(
                approved_case.case_id,
                MentorDecision(
                    decision=DecisionType.APPROVE,
                    mentor_id=approved_case.assigned_mentor,
                    nonce="ECOSYSTEM-SEED:APPROVE:SYN-0001",
                    reason="Synthetic evidence reviewed for the ecosystem demonstration.",
                ),
            )

        interventions = app.repository.list_interventions(owner_id="mentor-01")
        if interventions:
            app.repository.update_intervention(
                interventions[0].intervention_id,
                "mentor-01",
                InterventionStatus.SCHEDULED,
                note="Synthetic mentor check-in added to the demonstration plan.",
                due_at=app.bundle.policy.reference_date + timedelta(days=5),
            )
    except Exception as exc:
        app.repository.fail_cohort_run(cohort_run.run_id, str(exc))
        raise
    app.repository.complete_cohort_run(cohort_run.run_id)


def run_new_cycle(app: StudentSuccessApplication) -> None:
    service = EcosystemService(app.repository, app.settings.fixtures_path)
    cycle_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    cohort_run = app.repository.start_cohort_run(
        service.roster["cohort_id"],
        "demo-admin",
        len(service.roster["students"]),
    )
    try:
        for profile in service.roster["students"]:
            case = app.create_case(
                profile["student_ref"],
                assigned_mentor=profile["mentor_id"],
                request_id=f"CYCLE:{cycle_id}:{profile['student_ref']}",
            )
            app.repository.attach_case_to_cohort_run(cohort_run.run_id, case.case_id)
            app.workflow.process_case(case.case_id)
    except Exception as exc:
        app.repository.fail_cohort_run(cohort_run.run_id, str(exc))
        raise
    app.repository.complete_cohort_run(cohort_run.run_id)


def pipeline_html() -> str:
    nodes = [
        ("Gate 01", "Authorised intake", "agent"),
        ("Parallel 02", "Four collectors", "agent"),
        ("Gate 03", "Policy analysis", "agent"),
        ("Bounded 04", "Packet composer", "agent"),
        ("Loop 05", "Validate + repair", "agent"),
        ("Human 06", "Mentor decision", "human"),
        ("Ledger 07", "Intervention + audit", "human"),
    ]
    parts = ["<div class='pipeline'>"]
    for index, (number, title, kind) in enumerate(nodes):
        if index:
            parts.append("<div class='arrow'>→</div>")
        parts.append(
            f"<div class='node {kind}'><div class='n'>{number}</div>"
            f"<div class='t'>{title}</div></div>"
        )
    parts.append("</div>")
    return "".join(parts)


def render_ecosystem_map(
    app: StudentSuccessApplication,
    service: EcosystemService,
    identity: DemoIdentity,
) -> None:
    page_header(
        "Student-success operating system",
        "Evidence before intervention.",
        "One governed ecosystem joins source operations, agentic case work, human decisions, support delivery, student self-service, leadership intelligence, and audit.",
        identity,
    )
    overview = service.overview()
    metric_cards(
        [
            (
                "Students monitored",
                f"{overview['students_monitored']:02d}",
                "synthetic cohort",
            ),
            ("Awaiting mentor", f"{overview['awaiting_mentor']:02d}", "human gate"),
            ("Data blocked", f"{overview['data_blocked']:02d}", "no inference allowed"),
            ("Interventions", f"{overview['interventions']:02d}", "approved only"),
        ]
    )
    st.write("")
    st.markdown("### The operating loop")
    st.markdown(pipeline_html(), unsafe_allow_html=True)
    columns = st.columns(4)
    cards = [
        (
            "Faculty",
            "Mentor workspace",
            "Case queue, source evidence, validated recommendations, approval, correction, rollback, and intervention logging.",
            "coral",
        ),
        (
            "Students",
            "Private support portal",
            "One synthetic identity sees only its approved plan and source-update status. No peer ranking and no predictive label.",
            "teal",
        ),
        (
            "HoD / Dean",
            "Leadership cockpit",
            "Aggregate concern patterns, connector quality, workload, and intervention outcomes without student-level drill-down.",
            "sun",
        ),
        (
            "Operations",
            "AURA control room",
            "Connector health, agent runs, retries, policy versions, permissions, model boundary, and immutable audit exports.",
            "",
        ),
    ]
    for column, (kicker, title, copy, colour) in zip(columns, cards):
        column.markdown(
            f"<div class='surface-card {colour}'><div class='kicker'>{safe(kicker)}</div>"
            f"<div class='title'>{safe(title)}</div><div class='copy'>{safe(copy)}</div></div>",
            unsafe_allow_html=True,
        )
    st.write("")
    st.markdown(
        "<div class='callout'><b>Reality boundary</b><br>All identities, records, connectors, thresholds, interventions, and outcomes are synthetic. The identity switcher demonstrates authorization rules; it is not institutional authentication.</div>",
        unsafe_allow_html=True,
    )


def render_bars(values: dict[str, int], *, coral: bool = False) -> None:
    maximum = max(values.values(), default=1) or 1
    for label, value in values.items():
        width = round(100 * value / maximum)
        colour = " coral" if coral else ""
        st.markdown(
            f"<div class='bar-row'><div>{safe(label)}</div><div class='bar-track'>"
            f"<div class='bar-fill{colour}' style='width:{width}%'></div></div>"
            f"<div>{value}</div></div>",
            unsafe_allow_html=True,
        )


def render_command_centre(service: EcosystemService, identity: DemoIdentity) -> None:
    mentor_id = identity.mentor_id if identity.role == UserRole.MENTOR else None
    page_header(
        "Live cohort snapshot",
        "See the work before it becomes late.",
        "The command centre prioritises review work without pretending a policy index is a prediction. Every row resolves to source evidence and a human-owned action.",
        identity,
    )
    overview = service.overview(mentor_id)
    metric_cards(
        [
            (
                "Students in scope",
                overview["students_monitored"],
                "latest case per student",
            ),
            ("High priority", overview["high_priority"], "fictional policy"),
            (
                "Awaiting review",
                overview["awaiting_mentor"],
                "mentor decision required",
            ),
            (
                "Active supports",
                overview["interventions_active"],
                "approved ledger items",
            ),
        ]
    )
    st.write("")
    left, right = st.columns([3, 2])
    with left:
        st.markdown("### Priority worklist")
        rows = service.risk_rows(mentor_id)
        if rows:
            frame = pd.DataFrame(rows).rename(
                columns={
                    "student_ref": "STUDENT",
                    "section": "SECTION",
                    "mentor": "MENTOR",
                    "priority": "PRIORITY",
                    "concern_index": "CONCERN INDEX",
                    "signals": "SIGNALS",
                    "state": "WORKFLOW STATE",
                    "case_id": "CASE",
                }
            )
            st.dataframe(frame, width="stretch", hide_index=True)
        else:
            st.info("No cases are currently assigned to this identity.")
    with right:
        st.markdown("### Signals by source")
        render_bars(
            {
                name.upper(): value
                for name, value in service.signals_by_source().items()
            },
            coral=True,
        )
        st.markdown(
            "<div class='soft-callout'><b>Concern index</b><br>15 points per policy signal plus a 20-point critical-signal bonus, capped at 100. It is a sortable demo-policy index, not failure probability.</div>",
            unsafe_allow_html=True,
        )


def case_label(service: EcosystemService, case) -> str:
    artifact = service.latest_artifact(case)
    priority = (
        artifact.assessment.priority.value.upper() if artifact else "DATA BLOCKED"
    )
    return f"{case.student_ref} · {priority} · {case.status.value}"


def render_evidence(app: StudentSuccessApplication, selected) -> None:
    if not selected.latest_snapshot_id:
        st.info("No evidence snapshot has been persisted yet.")
        return
    snapshot = app.repository.get_snapshot(selected.latest_snapshot_id)
    columns = st.columns(4)
    for column, (source, envelope) in zip(columns, snapshot.envelopes.items()):
        class_name = ""
        if envelope.data_state in {
            DataState.MISSING,
            DataState.STALE,
            DataState.CONTRADICTORY,
        }:
            class_name = "bad"
        elif envelope.data_state == DataState.NOT_APPLICABLE:
            class_name = "na"
        body = "".join(
            f"<div><small>{safe(key)}</small><br><b>{safe(value)}</b></div><br>"
            for key, value in envelope.fields.items()
        )
        column.markdown(
            f"<div class='source-card {class_name}'><div class='source-name'>{safe(source.value)}</div>"
            f"<span class='status-pill'>{safe(envelope.data_state.value)}</span><br><br>{body}"
            f"<small>{safe(envelope.observed_at or 'not supplied')}</small></div>",
            unsafe_allow_html=True,
        )
    if snapshot.data_issues:
        st.error(
            "Data gate: "
            + "; ".join(
                f"{issue.source.value}: {issue.reason_code}"
                for issue in snapshot.data_issues
            )
        )
    else:
        st.success(f"Required evidence is usable under {snapshot.policy_version}.")
    provenance_rows = [
        {
            "REFERENCE": ref,
            "SOURCE": record.source.value,
            "OBSERVED": record.observed_at,
            "FIELDS": json.dumps(record.fields, sort_keys=True),
        }
        for ref, record in snapshot.record_index.items()
    ]
    st.markdown("#### Field-level provenance")
    st.dataframe(pd.DataFrame(provenance_rows), width="stretch", hide_index=True)

    if selected.status == CaseStatus.DATA_BLOCKED:
        correction_path = app.settings.corrections_path / selected.student_ref
        if correction_path.exists() and st.button(
            "Apply bundled synthetic correction and resume", type="primary"
        ):
            with st.spinner("Applying the versioned correction and resuming…"):
                app.apply_bundled_correction(selected.case_id)
                app.workflow.process_case(selected.case_id)
            refresh()


def render_case_review(app: StudentSuccessApplication, selected) -> None:
    if not selected.latest_artifact_version:
        st.info("No case packet exists. The data-quality gate is blocking drafting.")
        return
    artifact = app.repository.get_artifact(selected.case_id)
    catalogue = {item.id: item for item in app.bundle.catalogue.items}
    left, right = st.columns([3, 2])
    with left:
        st.markdown(
            f"### {artifact.packet.priority.value.upper()} priority · concern index {EcosystemService.concern_index(artifact)}/100"
        )
        st.caption("Fictional policy index, not a probability or diagnosis.")
        for claim in artifact.packet.evidence_summary:
            st.markdown(f"**{claim.claim}**")
            st.caption(f"{claim.reason_code} · {', '.join(claim.source_refs)}")
        st.markdown("#### Proposed support")
        for proposal in artifact.packet.proposed_support:
            item = catalogue.get(proposal.catalogue_id)
            st.markdown(
                f"**{proposal.catalogue_id} · {item.label if item else 'Unknown item'}**"
            )
            st.write(proposal.rationale)
            st.caption(", ".join(proposal.rationale_source_refs))
        if artifact.packet.unknowns:
            st.markdown("#### Unknowns")
            for unknown in artifact.packet.unknowns:
                st.write(f"• {unknown}")
    with right:
        colour = "#9dd8c8" if artifact.validation.is_valid else "#ee5b3e"
        st.markdown(
            f"<div class='source-card' style='border-top-color:{colour}'>"
            "<div class='source-name'>Validation report</div>"
            f"<div style='font-family:Fraunces;font-size:2rem;margin:.6rem 0'>{'PASS' if artifact.validation.is_valid else 'ATTENTION'}</div>"
            f"<div>{len(artifact.validation.validators_run)} deterministic checks</div>"
            f"<div>{len(artifact.validation.findings)} finding(s)</div>"
            f"<div>{safe(artifact.generator_mode)}</div></div>",
            unsafe_allow_html=True,
        )
        for finding in artifact.validation.findings:
            st.error(f"{finding.code}: {finding.message}")
        for note in artifact.diagnosis:
            st.warning(note)

    if selected.status == CaseStatus.AWAITING_MENTOR:
        st.divider()
        st.markdown("### Human authority")
        reason = st.text_input(
            "Decision rationale",
            value="Evidence and uncertainty reviewed against the fictional policy.",
            key=f"reason:{selected.case_id}",
        )
        edit_mode = st.toggle(
            "Edit packet before approval", key=f"edit:{selected.case_id}"
        )
        edited_packet = None
        if edit_mode:
            edited_json = st.text_area(
                "Validated packet JSON",
                value=json.dumps(artifact.packet.model_dump(mode="json"), indent=2),
                height=320,
                key=f"packet:{selected.case_id}",
            )
            try:
                edited_packet = CasePacket.model_validate_json(edited_json)
                st.caption("Schema valid. Policy validation runs again on submission.")
            except ValidationError as exc:
                st.error(f"Schema error: {exc}")
        approve_col, reject_col = st.columns(2)
        if approve_col.button(
            "Edit + approve" if edit_mode else "Approve and create support plan",
            type="primary",
            width="stretch",
            disabled=edit_mode and edited_packet is None,
            key=f"approve:{selected.case_id}",
        ):
            app.workflow.decide(
                selected.case_id,
                MentorDecision(
                    decision=(
                        DecisionType.EDIT_APPROVE if edit_mode else DecisionType.APPROVE
                    ),
                    mentor_id=selected.assigned_mentor,
                    nonce=f"UI-{uuid.uuid4().hex}",
                    reason=reason,
                    edited_packet=edited_packet,
                ),
            )
            refresh()
        if reject_col.button(
            "Reject without intervention",
            width="stretch",
            key=f"reject:{selected.case_id}",
        ):
            app.workflow.decide(
                selected.case_id,
                MentorDecision(
                    decision=DecisionType.REJECT,
                    mentor_id=selected.assigned_mentor,
                    nonce=f"UI-{uuid.uuid4().hex}",
                    reason=reason,
                ),
            )
            refresh()
    elif selected.status == CaseStatus.CLOSED:
        st.divider()
        interventions = app.repository.list_interventions(case_id=selected.case_id)
        st.markdown(f"### Closed: {selected.closed_reason}")
        st.caption(f"{len(interventions)} approved intervention item(s) in the ledger.")
        reopen_reason = st.text_input(
            "Reopen/revoke rationale",
            value="New context requires renewed mentor review.",
            key=f"reopen-reason:{selected.case_id}",
        )
        rollback_version = st.selectbox(
            "Rollback source artifact",
            [item.version for item in app.repository.list_artifacts(selected.case_id)],
            key=f"rollback-version:{selected.case_id}",
        )
        first, second, third = st.columns(3)
        if first.button("Reopen", width="stretch", key=f"reopen:{selected.case_id}"):
            app.workflow.reopen(
                selected.case_id,
                selected.assigned_mentor,
                reopen_reason,
                "reopen",
            )
            refresh()
        if second.button("Revoke", width="stretch", key=f"revoke:{selected.case_id}"):
            app.workflow.reopen(
                selected.case_id,
                selected.assigned_mentor,
                reopen_reason,
                "revoke",
            )
            refresh()
        if third.button(
            "Rollback + review", width="stretch", key=f"rollback:{selected.case_id}"
        ):
            app.workflow.reopen(
                selected.case_id,
                selected.assigned_mentor,
                reopen_reason,
                "rollback",
                source_version=rollback_version,
            )
            refresh()


def render_replay(app: StudentSuccessApplication, selected) -> None:
    events = app.repository.list_events(selected.case_id)
    timeline = ["<div class='timeline'>"]
    for event in events:
        before = event.from_state.value if event.from_state else "∅"
        after = event.to_state.value if event.to_state else "∅"
        timeline.append(
            "<div class='event'>"
            f"<div class='seq'>#{event.sequence:02d} · {safe(event.created_at)}</div>"
            f"<div class='type'>{safe(event.event_type)}</div>"
            f"<div>{safe(before)} → {safe(after)}</div>"
            f"<div class='meta'>{safe(event.actor_role.value)} / {safe(event.actor_id)} · output {safe((event.output_hash or '—')[:12])}</div>"
            "</div>"
        )
    timeline.append("</div>")
    st.markdown("".join(timeline), unsafe_allow_html=True)
    payload = app.repository.export_case(selected.case_id)
    st.download_button(
        "Download immutable case export",
        data=json.dumps(payload, indent=2, default=str),
        file_name=f"{selected.case_id}.json",
        mime="application/json",
    )
    with st.expander("Inspect raw event payloads"):
        st.json(payload)


def render_mentor_workspace(
    app: StudentSuccessApplication,
    service: EcosystemService,
    identity: DemoIdentity,
) -> None:
    page_header(
        "Assigned casework",
        "Review the evidence. Own the decision.",
        "The agent may collect, compose, challenge, and repair. It cannot approve support, contact a student, or conceal missing evidence.",
        identity,
    )
    cases = service.cases_for_identity(identity)
    if not cases:
        st.info("No cases are assigned to this mentor.")
        return
    selected = st.selectbox(
        "Open assigned case",
        cases,
        format_func=lambda case: case_label(service, case),
        key=f"mentor-case:{identity.identity_id}",
    )
    require_case_access(identity, selected)
    artifact = service.latest_artifact(selected)
    metric_cards(
        [
            ("Student", selected.student_ref, "synthetic identity"),
            (
                "Priority",
                artifact.assessment.priority.value.upper() if artifact else "BLOCKED",
                "fictional policy",
            ),
            (
                "Concern index",
                f"{service.concern_index(artifact):02d}",
                "not probability",
            ),
            ("State", selected.status.value, "durable workflow"),
        ]
    )
    st.write("")
    queue_tab, evidence_tab, review_tab, replay_tab = st.tabs(
        ["01  QUEUE", "02  EVIDENCE", "03  REVIEW", "04  REPLAY"]
    )
    with queue_tab:
        rows = service.risk_rows(identity.mentor_id)
        st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)
    with evidence_tab:
        render_evidence(app, selected)
    with review_tab:
        render_case_review(app, selected)
    with replay_tab:
        render_replay(app, selected)


def render_interventions(
    app: StudentSuccessApplication,
    identity: DemoIdentity,
) -> None:
    page_header(
        "Approved support ledger",
        "Approval is the start, not the finish.",
        "Track the delivery state and outcome of mentor-approved support. This ledger records work; it does not send messages or contact students.",
        identity,
    )
    interventions = app.repository.list_interventions(owner_id=identity.mentor_id)
    counts = Counter(item.status.value for item in interventions)
    metric_cards(
        [
            ("All items", len(interventions), "approved catalogue actions"),
            ("Planned", counts[InterventionStatus.PLANNED.value], "not scheduled"),
            (
                "In motion",
                counts[InterventionStatus.SCHEDULED.value]
                + counts[InterventionStatus.IN_PROGRESS.value],
                "scheduled or active",
            ),
            ("Completed", counts[InterventionStatus.COMPLETED.value], "outcome logged"),
        ]
    )
    st.write("")
    if not interventions:
        st.info("No approved support items exist for this mentor yet.")
        return
    catalogue = {item.id: item for item in app.bundle.catalogue.items}
    rows = []
    for item in interventions:
        case = app.repository.get_case(item.case_id)
        rows.append(
            {
                "INTERVENTION": item.intervention_id,
                "STUDENT": case.student_ref,
                "SUPPORT": catalogue[item.catalogue_id].label,
                "STATUS": item.status.value,
                "DUE": item.due_at.date().isoformat() if item.due_at else "—",
                "OUTCOME": item.outcome or "—",
            }
        )
    intervention_frame = pd.DataFrame(rows)
    st.dataframe(intervention_frame, width="stretch", hide_index=True)
    st.download_button(
        "Export intervention log as CSV",
        data=intervention_frame.to_csv(index=False),
        file_name=f"{identity.mentor_id}-intervention-log.csv",
        mime="text/csv",
    )
    selected = st.selectbox(
        "Update one intervention",
        interventions,
        format_func=lambda item: (
            f"{app.repository.get_case(item.case_id).student_ref} · "
            f"{catalogue[item.catalogue_id].label} · {item.status.value}"
        ),
    )
    st.markdown(f"#### {catalogue[selected.catalogue_id].label}")
    st.write(selected.rationale)
    allowed_statuses = list(allowed_intervention_statuses(selected.status))
    status = st.selectbox(
        "Delivery status",
        allowed_statuses,
        index=allowed_statuses.index(selected.status),
        format_func=lambda value: value.value.replace("_", " ").title(),
        key=f"intervention-status:{selected.intervention_id}",
    )
    due_default = (
        selected.due_at.date()
        if selected.due_at
        else app.bundle.policy.reference_date.date() + timedelta(days=7)
    )
    due_date = st.date_input(
        "Planned date",
        value=due_default,
        key=f"intervention-due:{selected.intervention_id}",
    )
    note = st.text_input(
        "Mentor note",
        value=selected.latest_note or "",
        key=f"intervention-note:{selected.intervention_id}",
    )
    outcome_options = [
        "Not recorded",
        "Support accepted",
        "Support declined",
        "Referral completed",
        "No longer required",
    ]
    current_outcome = selected.outcome or "Not recorded"
    outcome = st.selectbox(
        "Synthetic outcome",
        outcome_options,
        index=(
            outcome_options.index(current_outcome)
            if current_outcome in outcome_options
            else 0
        ),
        key=f"intervention-outcome:{selected.intervention_id}",
    )
    if st.button("Record audited update", type="primary"):
        app.repository.update_intervention(
            selected.intervention_id,
            identity.mentor_id or "",
            status,
            note=note.strip() or None,
            outcome=None if outcome == "Not recorded" else outcome,
            due_at=datetime.combine(due_date, time.min, tzinfo=UTC),
        )
        refresh()


def render_student_portal(
    app: StudentSuccessApplication,
    service: EcosystemService,
    identity: DemoIdentity,
) -> None:
    student_ref = identity.student_ref or ""
    view = service.student_portal(identity, student_ref)
    profile = view["profile"]
    page_header(
        "Private synthetic student view",
        "Your support plan, without a label.",
        "This portal shows source-update status and only mentor-approved support. It deliberately hides peer comparison, internal concern scoring, and other students' records.",
        identity,
    )
    metric_cards(
        [
            ("Student", profile["student_ref"], "synthetic identity"),
            ("Programme", "CSE (AI)", "demonstration cohort"),
            ("Section", profile["section"], "current synthetic roster"),
            ("Review", view["review_state"].replace("_", " "), "support workflow"),
        ]
    )
    st.write("")
    st.markdown(
        f"<div class='soft-callout'>{safe(view['privacy_notice'])}</div>",
        unsafe_allow_html=True,
    )
    st.markdown("### Your source-update status")
    columns = st.columns(4)
    for column, source in zip(columns, view["source_status"]):
        colour = (
            "bad" if source["state"] in {"missing", "stale", "contradictory"} else ""
        )
        column.markdown(
            f"<div class='source-card {colour}'><div class='source-name'>{safe(source['source'])}</div>"
            f"<br><span class='status-pill'>{safe(source['state'])}</span><br><br>"
            f"<small>Observed</small><br><b>{safe(source['observed_at'])}</b></div>",
            unsafe_allow_html=True,
        )
    st.markdown("### Mentor-approved support")
    catalogue = {item.id: item for item in app.bundle.catalogue.items}
    if not view["support_plan"]:
        st.info("No mentor-approved support plan is currently published to this view.")
    for item in view["support_plan"]:
        st.markdown(
            f"<div class='surface-card teal'><div class='kicker'>{safe(item.status.value)}</div>"
            f"<div class='title'>{safe(catalogue[item.catalogue_id].label)}</div>"
            f"<div class='copy'>{safe(catalogue[item.catalogue_id].description)}<br><br>"
            f"Planned date: {safe(item.due_at.date() if item.due_at else 'To be arranged')}"
            f"{('<br>Outcome: ' + safe(item.outcome)) if item.outcome else ''}</div></div>",
            unsafe_allow_html=True,
        )
    st.caption(
        "This demonstration does not send notifications. Real contact remains an institutional, human-owned action."
    )


def render_leadership(
    app: StudentSuccessApplication,
    service: EcosystemService,
    identity: DemoIdentity,
) -> None:
    snapshot = service.leadership_snapshot()
    metrics = snapshot["metrics"]
    page_header(
        "Aggregate-only leadership view",
        "Patterns, not dossiers.",
        "HoD and Dean views answer whether the support system is working as an operation. They do not expose student records or invite individual ranking.",
        identity,
    )
    metric_cards(
        [
            ("Monitored", metrics["students_monitored"], snapshot["term"]),
            ("At-risk flags", metrics["at_risk"], "medium + high policy bands"),
            ("High priority", metrics["high_priority"], "multi-signal or critical"),
            ("Interventions", metrics["interventions"], "approved support items"),
        ]
    )
    st.write("")
    left, right = st.columns(2)
    with left:
        st.markdown("### Priority distribution")
        render_bars(
            {
                key.upper(): value
                for key, value in snapshot["priority_distribution"].items()
            },
            coral=True,
        )
    with right:
        st.markdown("### Flags by signal source")
        render_bars(
            {key.upper(): value for key, value in snapshot["signals_by_source"].items()}
        )
    st.markdown("### Connector data quality")
    st.dataframe(
        pd.DataFrame(snapshot["connector_quality"]),
        width="stretch",
        hide_index=True,
    )
    statuses = Counter(
        item.status.value for item in app.repository.list_interventions()
    )
    st.markdown("### Intervention delivery")
    render_bars(dict(statuses) or {"NO APPROVED ITEMS": 0})
    st.markdown(
        "<div class='callout'><b>Deliberate restriction</b><br>This page contains no student reference, case identifier, raw evidence, or free-text mentor note. Leadership gets operational intelligence, not a surveillance console.</div>",
        unsafe_allow_html=True,
    )


def render_agent_operations(
    app: StudentSuccessApplication,
    service: EcosystemService,
    identity: DemoIdentity,
) -> None:
    page_header(
        "AURA control room",
        "Operate the agents. Inspect the seams.",
        "Connector health, execution topology, retries, blocked data, and state transitions are visible here. All four connectors are simulated adapters over versioned fixtures.",
        identity,
    )
    connector_rows = service.connector_health()
    columns = st.columns(4)
    for column, row in zip(columns, connector_rows):
        colour = "bad" if row["attention"] else ""
        column.markdown(
            f"<div class='source-card {colour}'><div class='source-name'>{safe(row['source'])} connector</div>"
            "<br><span class='status-pill'>SIMULATED</span><br><br>"
            f"<b>{row['coverage_pct']}%</b> run coverage<br>"
            f"{row['present']} present · {row['attention']} attention<br>"
            f"<small>Latest source record<br>{safe(row['latest_observed'])}</small></div>",
            unsafe_allow_html=True,
        )
    st.markdown("### Hybrid agent graph")
    st.markdown(pipeline_html(), unsafe_allow_html=True)
    left, right = st.columns([1, 2])
    with left:
        st.markdown("#### Run control")
        st.write(
            "Create a new six-student synthetic collection cycle. Existing cases and audit history remain immutable."
        )
        if st.button("Run new synthetic cycle", type="primary", width="stretch"):
            with st.spinner("Running four-source fan-out and governed fan-in…"):
                run_new_cycle(app)
            refresh()
        st.caption("No external system is contacted.")
    with right:
        st.markdown("#### Recent orchestration events")
        recent = service.recent_events(40)
        st.dataframe(pd.DataFrame(recent), width="stretch", hide_index=True)
    cohort_runs = app.repository.list_cohort_runs()
    if cohort_runs:
        st.markdown("### Cohort run ledger")
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "RUN": run.run_id,
                        "COHORT": run.cohort_id,
                        "STATUS": run.status.value,
                        "CASES": f"{run.completed_cases}/{run.total_cases}",
                        "BLOCKED": run.blocked_cases,
                        "STARTED": run.started_at,
                        "COMPLETED": run.completed_at,
                    }
                    for run in cohort_runs
                ]
            ),
            width="stretch",
            hide_index=True,
        )


def render_governance(
    app: StudentSuccessApplication,
    service: EcosystemService,
    identity: DemoIdentity,
) -> None:
    page_header(
        "Policy, permissions, and proof",
        "Governance is part of the product.",
        "The model is optional. Policy, validation, human authority, durable state, and audit are mandatory.",
        identity,
    )
    model_state = (
        "OpenAI packet composer"
        if os.getenv("OPENAI_API_KEY")
        else "Deterministic composer"
    )
    metric_cards(
        [
            ("Policy", app.bundle.policy.policy_version, "versioned YAML"),
            ("Model mode", model_state, "composer only"),
            (
                "Repair budget",
                app.bundle.policy.max_repair_attempts,
                "named fields only",
            ),
            ("Direct contact", "DISABLED", "mentor-owned action"),
        ]
    )
    st.write("")
    policy_tab, access_tab, audit_tab = st.tabs(
        ["01  POLICY", "02  ACCESS", "03  AUDIT"]
    )
    with policy_tab:
        st.markdown("### Non-predictive policy")
        st.json(app.bundle.policy.model_dump(mode="json"))
        st.markdown("### Approved intervention catalogue")
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "ID": item.id,
                        "LABEL": item.label,
                        "DESCRIPTION": item.description,
                        "ELIGIBLE REASONS": ", ".join(item.eligible_reason_codes),
                    }
                    for item in app.bundle.catalogue.items
                ]
            ),
            width="stretch",
            hide_index=True,
        )
    with access_tab:
        st.markdown("### Demo authorization matrix")
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "ROLE": role.value,
                        "SURFACES": ", ".join(
                            allowed_pages(
                                next(
                                    item
                                    for item in DEMO_IDENTITIES
                                    if item.role == role
                                )
                            )
                        ),
                        "STUDENT-LEVEL ACCESS": (
                            "Self only"
                            if role == UserRole.STUDENT
                            else "Assigned only"
                            if role == UserRole.MENTOR
                            else "All synthetic cases"
                            if role == UserRole.ADMIN
                            else "None; aggregate only"
                        ),
                    }
                    for role in UserRole
                ]
            ),
            width="stretch",
            hide_index=True,
        )
        st.warning(
            "The selector is a demo harness, not login. Production requires SSO and server-side role provisioning."
        )
    with audit_tab:
        if identity.role == UserRole.LEADERSHIP:
            payload = service.leadership_snapshot()
            st.info("Leadership export is aggregate-only by design.")
            filename = "leadership-aggregate-snapshot.json"
        else:
            payload = {
                "scope": "synthetic_demo_only",
                "exported_at": datetime.now(UTC).isoformat(),
                "cases": [
                    app.repository.export_case(case.case_id)
                    for case in app.repository.list_cases()
                ],
                "interventions": [
                    item.model_dump(mode="json")
                    for item in app.repository.list_interventions()
                ],
            }
            filename = "ecosystem-audit-export.json"
            st.info("Administrator export contains synthetic student-level records.")
        st.download_button(
            "Download governed JSON export",
            data=json.dumps(payload, indent=2, default=str),
            file_name=filename,
            mime="application/json",
        )
        events = service.recent_events(80)
        st.dataframe(pd.DataFrame(events), width="stretch", hide_index=True)


def main() -> None:
    app = get_app()
    seed_ecosystem(app)
    app.repository.reconcile_approved_interventions()
    service = EcosystemService(app.repository, app.settings.fixtures_path)

    identity_by_id = {item.identity_id: item for item in DEMO_IDENTITIES}
    with st.sidebar:
        st.markdown(
            "<div style='font:500 .68rem DM Mono;letter-spacing:.15em;color:#9dd8c8'>CHAPTER 11 / ECOSYSTEM 2.0</div>",
            unsafe_allow_html=True,
        )
        st.markdown(
            "<div style='font-family:Fraunces;font-size:2rem;line-height:1.02;margin:.65rem 0 1.2rem'>AURA<br>Student Success</div>",
            unsafe_allow_html=True,
        )
        identity_id = st.selectbox(
            "Demo identity",
            list(identity_by_id),
            format_func=lambda key: identity_by_id[key].label,
        )
        identity = identity_by_id[identity_id]
        st.caption(f"Role: {identity.role.value}")
        if identity.student_ref:
            st.caption(f"Scope: {identity.student_ref} only")
        elif identity.mentor_id:
            st.caption(f"Scope: assigned to {identity.mentor_id}")
        elif identity.role == UserRole.LEADERSHIP:
            st.caption("Scope: aggregate only")
        else:
            st.caption("Scope: synthetic operations")
        st.divider()
        page = st.radio(
            "Workspace",
            allowed_pages(identity),
            key=f"workspace:{identity.role.value}",
        )
        st.divider()
        st.markdown(
            "<div class='callout'><b>Boundary</b><br>No prediction. No diagnosis. No autonomous contact. Human authority is mandatory.</div>",
            unsafe_allow_html=True,
        )
        st.caption("Synthetic data · ephemeral demo storage")

    routes = {
        "Ecosystem Map": lambda: render_ecosystem_map(app, service, identity),
        "Command Centre": lambda: render_command_centre(service, identity),
        "Mentor Workspace": lambda: render_mentor_workspace(app, service, identity),
        "Interventions": lambda: render_interventions(app, identity),
        "Student Portal": lambda: render_student_portal(app, service, identity),
        "Leadership Cockpit": lambda: render_leadership(app, service, identity),
        "Agent Operations": lambda: render_agent_operations(app, service, identity),
        "Governance": lambda: render_governance(app, service, identity),
    }
    routes[page]()


if __name__ == "__main__":
    main()
