from __future__ import annotations

import html
import json
import os
import uuid

import pandas as pd
import streamlit as st
from pydantic import ValidationError

from student_success.application import StudentSuccessApplication
from student_success.contracts.models import (
    CasePacket,
    CaseStatus,
    DecisionType,
    MentorDecision,
)
from student_success.generation.faults import UnsafeOnceGenerator

st.set_page_config(
    page_title="Signal Desk",
    page_icon="◇",
    layout="wide",
    initial_sidebar_state="expanded",
)

CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Fraunces:opsz,wght@9..144,600;9..144,720&family=Manrope:wght@400;500;600;700&display=swap');
:root { --ink:#102a2d; --paper:#f3efe6; --card:#fffdf7; --coral:#ee5b3e; --mint:#9dd8c8; --sun:#f2cb62; --line:#c9c4b8; }
.stApp { background: var(--paper); color: var(--ink); font-family: 'Manrope', sans-serif; }
.stApp::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.28; background-image: radial-gradient(#7d8c87 0.7px, transparent 0.7px); background-size:18px 18px; }
[data-testid="stSidebar"] { background:#102a2d; color:#f8f2e7; border-right:0; }
[data-testid="stSidebar"] * { color:#f8f2e7; }
[data-testid="stSidebar"] .stButton button { background:var(--coral); color:white; border:0; }
h1,h2,h3 { font-family:'Fraunces', serif !important; color:var(--ink) !important; letter-spacing:-.025em; }
h1 { font-size:3.25rem !important; line-height:.98 !important; margin-bottom:.2rem !important; }
.eyebrow { font-family:'DM Mono',monospace; text-transform:uppercase; letter-spacing:.14em; font-size:.72rem; color:#536965; margin-bottom:.8rem; }
.hero-rule { width:82px; height:7px; background:var(--coral); margin:1rem 0 1.4rem; }
.lede { max-width:760px; font-size:1.02rem; line-height:1.65; color:#39504f; }
.metric-card { background:var(--card); border:1px solid var(--line); padding:18px 20px; min-height:112px; box-shadow:6px 6px 0 #d9d2c5; }
.metric-card .label { font-family:'DM Mono',monospace; font-size:.68rem; letter-spacing:.11em; text-transform:uppercase; color:#60716d; }
.metric-card .value { font-family:'Fraunces',serif; font-size:2.2rem; line-height:1.1; margin-top:8px; }
.source-card { background:var(--card); border-top:7px solid var(--mint); padding:18px; min-height:230px; box-shadow:4px 4px 0 #d8d1c5; }
.source-card.bad { border-top-color:var(--coral); }
.source-card.na { border-top-color:var(--sun); }
.source-name { font-family:'DM Mono',monospace; font-size:.72rem; text-transform:uppercase; letter-spacing:.12em; }
.state-badge { display:inline-block; border:1px solid currentColor; padding:3px 8px; border-radius:999px; font:500 .68rem 'DM Mono'; margin:.5rem 0 1rem; }
.timeline { border-left:2px solid #99aaa5; padding-left:22px; margin-left:10px; }
.event { position:relative; background:var(--card); border:1px solid var(--line); padding:14px 16px; margin:0 0 14px; }
.event:before { content:""; position:absolute; width:12px; height:12px; border-radius:50%; background:var(--coral); left:-29px; top:18px; box-shadow:0 0 0 5px var(--paper); }
.event .seq { font:500 .68rem 'DM Mono'; color:#6a7774; }
.event .type { font-weight:700; margin:.2rem 0; }
.event .meta { color:#61716e; font-size:.78rem; }
.callout { background:#102a2d; color:#f7f1e5; padding:18px 20px; border-left:7px solid var(--coral); }
.callout b { color:#f2cb62; }
code { font-family:'DM Mono',monospace !important; }
[data-testid="stDataFrame"] { border:1px solid var(--line); }
.stTabs [data-baseweb="tab-list"] { gap:0; border-bottom:1px solid var(--line); }
.stTabs [data-baseweb="tab"] { font-family:'DM Mono',monospace; letter-spacing:.04em; border-radius:0; padding:12px 20px; }
.stTabs [aria-selected="true"] { background:#102a2d !important; color:white !important; }
.stButton button { border-radius:0; border:1px solid var(--ink); font-family:'Manrope'; font-weight:700; box-shadow:3px 3px 0 #a8a399; }
.stButton button:hover { border-color:var(--coral); color:var(--coral); transform:translate(-1px,-1px); box-shadow:5px 5px 0 #a8a399; }
footer, #MainMenu { visibility:hidden; }
[data-testid="stAppDeployButton"] { display:none !important; }
header[data-testid="stHeader"] { background:var(--paper); }
</style>
"""
st.markdown(CSS, unsafe_allow_html=True)


@st.cache_resource
def get_app() -> StudentSuccessApplication:
    return StudentSuccessApplication(generator_mode="auto")


app = get_app()
repo = app.repository


def refresh() -> None:
    st.cache_data.clear()
    st.rerun()


def safe(value) -> str:
    return html.escape(str(value))


def seed_cases() -> None:
    for student_ref in [
        "SYN-0001",
        "SYN-0002",
        "SYN-0003",
        "SYN-0004",
        "SYN-0005",
        "SYN-0006",
    ]:
        case = app.create_case(student_ref, request_id=f"SEED:{student_ref}")
        if case.status == CaseStatus.CREATED:
            app.workflow.process_case(case.case_id)

    # Keep one visibly labelled fault-injection case in the demo. This proves
    # that unsafe generated language is rejected and repaired before review.
    unsafe_app = StudentSuccessApplication(
        settings=app.settings,
        generator=UnsafeOnceGenerator(),
    )
    unsafe_case = unsafe_app.create_case(
        "SYN-0002",
        request_id="DEMO:UNSAFE-REPAIR",
    )
    if unsafe_case.status == CaseStatus.CREATED:
        unsafe_app.workflow.process_case(unsafe_case.case_id)


with st.sidebar:
    st.markdown(
        "<div style='font-family:DM Mono;font-size:.72rem;letter-spacing:.15em;color:#9dd8c8'>CHAPTER 11 / BUILD 1.0</div>",
        unsafe_allow_html=True,
    )
    st.markdown(
        "<div style='font-family:Fraunces;font-size:2rem;line-height:1.05;margin:.6rem 0 1.4rem'>Signal<br>Desk</div>",
        unsafe_allow_html=True,
    )
    model_state = (
        "OpenAI composer" if os.getenv("OPENAI_API_KEY") else "Deterministic fallback"
    )
    st.caption(f"Runtime: {model_state}")
    st.caption("Policy: demo-policy-v1")
    st.caption("Data: synthetic-cohort-v1")
    st.divider()
    if st.button("Seed synthetic cohort", width="stretch"):
        with st.spinner("Building governed cases…"):
            seed_cases()
        refresh()
    st.markdown(
        "<div class='callout' style='margin-top:1rem'><b>Boundary</b><br>No prediction. No diagnosis. No direct contact. Mentor authority is mandatory.</div>",
        unsafe_allow_html=True,
    )


if not repo.list_cases():
    with st.spinner("Preparing the governed synthetic demo…"):
        seed_cases()

cases = repo.list_cases()
counts = {status: sum(case.status == status for case in cases) for status in CaseStatus}

st.markdown(
    "<div class='eyebrow'>Mentor-governed support prioritisation</div>",
    unsafe_allow_html=True,
)
st.title("Evidence before intervention.")
st.markdown("<div class='hero-rule'></div>", unsafe_allow_html=True)
st.markdown(
    "<div class='lede'>Four synthetic signal groups enter. Deterministic policy decides what is concerning. One bounded composer may explain the evidence. Validators challenge it. A mentor decides. Every step survives restart and remains replayable.</div>",
    unsafe_allow_html=True,
)

metric_cols = st.columns(4)
metrics = [
    ("All cases", len(cases)),
    ("Awaiting mentor", counts[CaseStatus.AWAITING_MENTOR]),
    ("Data blocked", counts[CaseStatus.DATA_BLOCKED]),
    ("Closed", counts[CaseStatus.CLOSED]),
]
for col, (label, value) in zip(metric_cols, metrics):
    col.markdown(
        f"<div class='metric-card'><div class='label'>{label}</div><div class='value'>{value:02d}</div></div>",
        unsafe_allow_html=True,
    )

st.write("")
tabs = st.tabs(["01  QUEUE", "02  EVIDENCE", "03  REVIEW", "04  REPLAY"])


def case_label(case) -> str:
    return f"{case.student_ref} · {case.status.value} · {case.case_id}"


selected = None
if cases:
    selected_id = st.session_state.get("selected_case_id", cases[0].case_id)
    selected_index = next(
        (index for index, case in enumerate(cases) if case.case_id == selected_id), 0
    )
    with tabs[0]:
        rows = []
        for case in cases:
            priority = "—"
            if case.latest_artifact_version:
                priority = repo.get_artifact(case.case_id).packet.priority.value.upper()
            rows.append(
                {
                    "CASE": case.case_id,
                    "STUDENT": case.student_ref,
                    "PRIORITY": priority,
                    "STATE": case.status.value,
                    "MENTOR": case.assigned_mentor,
                }
            )
        st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)
        left, right = st.columns([2, 1])
        with left:
            chosen = st.selectbox(
                "Open a case", cases, index=selected_index, format_func=case_label
            )
            st.session_state["selected_case_id"] = chosen.case_id
        with right:
            st.markdown("#### Create one case")
            new_student = st.selectbox(
                "Synthetic record",
                [f"SYN-{i:04d}" for i in range(1, 7)],
                key="new_student",
            )
            if st.button("Create and run", width="stretch"):
                new_case = app.create_case(new_student)
                app.workflow.process_case(new_case.case_id)
                st.session_state["selected_case_id"] = new_case.case_id
                refresh()
    selected = repo.get_case(st.session_state["selected_case_id"])
else:
    with tabs[0]:
        st.info("The desk is empty. Seed the six synthetic cases from the sidebar.")


if selected:
    with tabs[1]:
        st.markdown(f"### {selected.student_ref} / evidence snapshot")
        if not selected.latest_snapshot_id:
            st.info("No evidence has been collected yet.")
        else:
            snapshot = repo.get_snapshot(selected.latest_snapshot_id)
            cols = st.columns(4)
            for col, (source, envelope) in zip(cols, snapshot.envelopes.items()):
                cls = (
                    "bad"
                    if envelope.data_state.value
                    in {"missing", "stale", "contradictory"}
                    else ("na" if envelope.data_state.value == "not_applicable" else "")
                )
                fields = (
                    "".join(
                        f"<div><b>{safe(key)}</b><br>{safe(value)}</div><br>"
                        for key, value in envelope.fields.items()
                    )
                    or "<i>No fields supplied</i>"
                )
                col.markdown(
                    f"<div class='source-card {cls}'><div class='source-name'>{safe(source.value)}</div><span class='state-badge'>{safe(envelope.data_state.value)}</span>{fields}<div style='font-size:.72rem;color:#687875'>{safe(envelope.observed_at or 'No observation time')}</div></div>",
                    unsafe_allow_html=True,
                )
            if snapshot.data_issues:
                st.error(
                    "Data gate: "
                    + " | ".join(
                        f"{issue.source.value}: {issue.reason_code}"
                        for issue in snapshot.data_issues
                    )
                )
            else:
                st.success("Required evidence is usable under demo-policy-v1.")
            st.markdown("#### Field-level provenance")
            provenance_rows = [
                {
                    "REFERENCE": ref,
                    "SOURCE": record.source.value,
                    "OBSERVED": record.observed_at,
                    "FIELDS": json.dumps(record.fields),
                }
                for ref, record in snapshot.record_index.items()
            ]
            st.dataframe(
                pd.DataFrame(provenance_rows), width="stretch", hide_index=True
            )
        if selected.status == CaseStatus.DATA_BLOCKED and st.button(
            "Apply bundled synthetic correction and resume", type="primary"
        ):
            with st.spinner(
                "Applying versioned correction and resuming from the data gate…"
            ):
                app.apply_bundled_correction(selected.case_id)
                app.workflow.process_case(selected.case_id)
            refresh()

    with tabs[2]:
        st.markdown(f"### {selected.student_ref} / mentor review")
        st.caption(
            f"Durable state: {selected.status.value} · Assigned mentor: {selected.assigned_mentor}"
        )
        if not selected.latest_artifact_version:
            st.info("No case packet exists. The data gate may be blocking drafting.")
        else:
            artifact = repo.get_artifact(selected.case_id)
            a, b = st.columns([3, 2])
            with a:
                st.markdown(f"#### Priority: {artifact.packet.priority.value.upper()}")
                for claim in artifact.packet.evidence_summary:
                    st.markdown(f"**{claim.claim}**")
                    st.caption(f"{claim.reason_code} · {', '.join(claim.source_refs)}")
                st.markdown("#### Proposed support")
                catalogue = {item.id: item for item in app.bundle.catalogue.items}
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
            with b:
                color = "#9dd8c8" if artifact.validation.is_valid else "#ee5b3e"
                st.markdown(
                    f"<div class='source-card' style='border-top-color:{color}'><div class='source-name'>Validation report</div><div style='font-family:Fraunces;font-size:2rem;margin:.6rem 0'>{'PASS' if artifact.validation.is_valid else 'ATTENTION'}</div><div>{len(artifact.validation.validators_run)} deterministic checks</div><div>{len(artifact.validation.findings)} finding(s)</div><div>{artifact.generator_mode}</div></div>",
                    unsafe_allow_html=True,
                )
                for finding in artifact.validation.findings:
                    st.error(f"{finding.code}: {finding.message}")
                for note in artifact.diagnosis:
                    st.warning(note)

            if selected.status == CaseStatus.AWAITING_MENTOR:
                st.divider()
                st.markdown("#### Human authority")
                reason = st.text_input(
                    "Decision rationale",
                    value="Evidence and uncertainty reviewed against the fictional policy.",
                )
                edit_mode = st.toggle("Edit packet before approval")
                edited_packet = None
                if edit_mode:
                    edited_json = st.text_area(
                        "Validated packet JSON",
                        value=json.dumps(
                            artifact.packet.model_dump(mode="json"), indent=2
                        ),
                        height=320,
                    )
                    try:
                        edited_packet = CasePacket.model_validate_json(edited_json)
                        st.caption(
                            "JSON schema is valid. Policy validation runs again on submission."
                        )
                    except ValidationError as exc:
                        st.error(f"Schema error: {exc}")
                approve_col, reject_col = st.columns(2)
                if approve_col.button(
                    "Edit + approve" if edit_mode else "Approve",
                    type="primary",
                    width="stretch",
                    disabled=edit_mode and edited_packet is None,
                ):
                    decision = MentorDecision(
                        decision=DecisionType.EDIT_APPROVE
                        if edit_mode
                        else DecisionType.APPROVE,
                        mentor_id=selected.assigned_mentor,
                        nonce=f"UI-{uuid.uuid4().hex}",
                        reason=reason,
                        edited_packet=edited_packet,
                    )
                    app.workflow.decide(selected.case_id, decision)
                    refresh()
                if reject_col.button("Reject", width="stretch"):
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
                st.markdown(f"#### Closed: {selected.closed_reason}")
                reopen_reason = st.text_input(
                    "Reopen/revoke rationale",
                    value="New context requires renewed mentor review.",
                )
                rollback_version = st.selectbox(
                    "Rollback source artifact",
                    [
                        artifact.version
                        for artifact in repo.list_artifacts(selected.case_id)
                    ],
                    index=0,
                )
                r1, r2, r3 = st.columns(3)
                if r1.button("Reopen case", width="stretch"):
                    app.workflow.reopen(
                        selected.case_id,
                        selected.assigned_mentor,
                        reopen_reason,
                        "reopen",
                    )
                    refresh()
                if r2.button("Revoke prior approval", width="stretch"):
                    app.workflow.reopen(
                        selected.case_id,
                        selected.assigned_mentor,
                        reopen_reason,
                        "revoke",
                    )
                    refresh()
                if r3.button("Rollback + review", width="stretch"):
                    app.workflow.reopen(
                        selected.case_id,
                        selected.assigned_mentor,
                        reopen_reason,
                        "rollback",
                        source_version=rollback_version,
                    )
                    refresh()

    with tabs[3]:
        st.markdown(f"### {selected.student_ref} / immutable replay")
        events = repo.list_events(selected.case_id)
        timeline = "<div class='timeline'>"
        for event in events:
            transition = f"{event.from_state.value if event.from_state else '∅'} → {event.to_state.value if event.to_state else '∅'}"
            timeline += f"<div class='event'><div class='seq'>#{event.sequence:02d} · {safe(event.created_at)}</div><div class='type'>{safe(event.event_type)}</div><div>{safe(transition)}</div><div class='meta'>{safe(event.actor_role.value)} / {safe(event.actor_id)} · output {safe((event.output_hash or '—')[:12])}</div></div>"
        timeline += "</div>"
        st.markdown(timeline, unsafe_allow_html=True)
        export_payload = repo.export_case(selected.case_id)
        st.download_button(
            "Download audit export",
            data=json.dumps(export_payload, indent=2, default=str),
            file_name=f"{selected.case_id}.json",
            mime="application/json",
        )
        with st.expander("Inspect raw event payloads"):
            st.json(export_payload)
