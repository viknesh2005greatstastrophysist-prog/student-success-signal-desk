from __future__ import annotations

import pytest

from student_success.application import StudentSuccessApplication
from student_success.contracts.models import (
    CaseStatus,
    DecisionType,
    MentorDecision,
    Priority,
)
from student_success.generation import DeterministicGenerator
from student_success.generation.faults import AlwaysUnsafeGenerator, UnsafeOnceGenerator


def build(app, student_ref: str):
    case = app.create_case(student_ref)
    app.workflow.process_case(case.case_id)
    return app.repository.get_case(case.case_id)


@pytest.mark.acceptance
def test_ac01_medium_case_reaches_valid_mentor_interrupt(app_factory):
    app = app_factory()
    case = build(app, "SYN-0001")
    artifact = app.repository.get_artifact(case.case_id)
    assert case.status == CaseStatus.AWAITING_MENTOR
    assert artifact.packet.priority == Priority.MEDIUM
    assert artifact.validation.is_valid
    assert {claim.reason_code for claim in artifact.packet.evidence_summary} == {
        "ACADEMIC_ATTENDANCE_LOW"
    }


@pytest.mark.acceptance
def test_ac02_missing_required_data_blocks_without_generator_call(app_factory):
    generator = DeterministicGenerator()
    app = app_factory(generator)
    case = build(app, "SYN-0003")
    assert case.status == CaseStatus.DATA_BLOCKED
    assert case.latest_artifact_version == 0
    assert generator.call_count == 0


@pytest.mark.acceptance
def test_ac03_stale_lms_blocks_with_freshness_reason(app_factory):
    app = app_factory()
    case = build(app, "SYN-0004")
    snapshot = app.repository.get_snapshot(case.latest_snapshot_id)
    assert case.status == CaseStatus.DATA_BLOCKED
    assert [
        (issue.source.value, issue.reason_code) for issue in snapshot.data_issues
    ] == [("lms", "DATA_STALE")]


@pytest.mark.acceptance
def test_ac04_contradiction_is_preserved_and_blocks(app_factory):
    app = app_factory()
    case = build(app, "SYN-0005")
    snapshot = app.repository.get_snapshot(case.latest_snapshot_id)
    assert case.status == CaseStatus.DATA_BLOCKED
    assert snapshot.envelopes["academic"].fields["attendance_pct_values"] == [68, 82]
    assert any(
        issue.reason_code == "DATA_CONTRADICTORY" for issue in snapshot.data_issues
    )


@pytest.mark.acceptance
def test_ac05_not_applicable_optional_sources_do_not_block(app_factory):
    app = app_factory()
    case = build(app, "SYN-0001")
    snapshot = app.repository.get_snapshot(case.latest_snapshot_id)
    assert case.status == CaseStatus.AWAITING_MENTOR
    assert snapshot.envelopes["internship"].data_state.value == "not_applicable"
    assert snapshot.is_sufficient


@pytest.mark.acceptance
def test_ac06_unsafe_proposal_is_repaired_before_mentor(app_factory):
    app = app_factory(UnsafeOnceGenerator())
    case = build(app, "SYN-0002")
    artifact = app.repository.get_artifact(case.case_id)
    events = app.repository.list_events(case.case_id)
    assert artifact.validation.is_valid
    assert "warn the student" not in artifact.packet.model_dump_json().lower()
    assert [event.event_type for event in events].count("TARGETED_REPAIR_APPLIED") == 1
    failed_report = next(
        event for event in events if event.event_type == "VALIDATION_COMPLETED"
    )
    assert failed_report.payload["is_valid"] is False


@pytest.mark.acceptance
def test_ac07_retry_exhaustion_uses_visible_deterministic_fallback(app_factory):
    app = app_factory(AlwaysUnsafeGenerator())
    case = build(app, "SYN-0002")
    artifact = app.repository.get_artifact(case.case_id)
    assert case.status == CaseStatus.AWAITING_MENTOR
    assert artifact.generator_mode == "deterministic_fallback"
    assert artifact.validation.is_valid
    assert artifact.diagnosis
    assert any(
        event.event_type == "DETERMINISTIC_FALLBACK_USED"
        for event in app.repository.list_events(case.case_id)
    )


@pytest.mark.acceptance
def test_ac08_mentor_rejection_closes_without_approval(app_factory):
    app = app_factory()
    case = build(app, "SYN-0001")
    app.workflow.decide(
        case.case_id,
        MentorDecision(
            decision=DecisionType.REJECT,
            mentor_id="mentor-01",
            nonce="reject-once",
            reason="Context is insufficient.",
        ),
    )
    closed = app.repository.get_case(case.case_id)
    decisions = app.repository.list_decisions(case.case_id)
    assert closed.status == CaseStatus.CLOSED
    assert closed.closed_reason == "reject"
    assert [decision["decision_type"] for decision in decisions] == ["reject"]


@pytest.mark.acceptance
def test_ac09_revoke_preserves_prior_decision_and_versions_artifact(app_factory):
    app = app_factory()
    case = build(app, "SYN-0001")
    app.workflow.decide(
        case.case_id,
        MentorDecision(
            decision=DecisionType.APPROVE,
            mentor_id="mentor-01",
            nonce="approve-v1",
            reason="Reviewed.",
        ),
    )
    app.workflow.reopen(
        case.case_id, "mentor-01", "New context arrived.", action="revoke"
    )
    reopened = app.repository.get_case(case.case_id)
    assert reopened.status == CaseStatus.AWAITING_MENTOR
    assert reopened.latest_artifact_version == 2
    assert len(app.repository.list_decisions(case.case_id)) == 1
    assert any(
        event.event_type == "APPROVAL_REVOKED"
        for event in app.repository.list_events(case.case_id)
    )


@pytest.mark.acceptance
def test_ac10_restart_resumes_interrupt_exactly_once(app_factory, settings):
    first = app_factory()
    case = build(first, "SYN-0001")
    before = len(first.repository.list_events(case.case_id))
    restarted = StudentSuccessApplication(
        settings=settings, generator_mode="deterministic"
    )
    decision = MentorDecision(
        decision=DecisionType.APPROVE,
        mentor_id="mentor-01",
        nonce="resume-once",
        reason="Reviewed after restart.",
    )
    restarted.workflow.decide(case.case_id, decision)
    restarted.repository.close_with_decision(case.case_id, decision)
    after_events = restarted.repository.list_events(case.case_id)
    assert restarted.repository.get_case(case.case_id).status == CaseStatus.CLOSED
    assert len(after_events) == before + 1
    assert len(restarted.repository.list_decisions(case.case_id)) == 1
