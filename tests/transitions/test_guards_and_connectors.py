from __future__ import annotations

import time

import pytest

from student_success.connectors import FixtureConnector, GovernedConnector
from student_success.contracts.models import CaseStatus, DecisionType, MentorDecision
from student_success.persistence import InvalidTransition


def test_request_id_is_idempotent(app_factory):
    app = app_factory()
    one = app.create_case("SYN-0001", request_id="same-request")
    two = app.create_case("SYN-0001", request_id="same-request")
    assert one.case_id == two.case_id
    assert len(app.repository.list_events(one.case_id)) == 1


def test_only_assigned_mentor_may_decide(app_factory):
    app = app_factory()
    case = app.create_and_process("SYN-0001")
    with pytest.raises(PermissionError):
        app.workflow.decide(
            case.case_id,
            MentorDecision(
                decision=DecisionType.APPROVE,
                mentor_id="intruder",
                nonce="bad",
                reason="No authority.",
            ),
        )


def test_cannot_rebuild_case_awaiting_mentor(app_factory):
    app = app_factory()
    case = app.create_and_process("SYN-0001")
    with pytest.raises(InvalidTransition):
        app.workflow.process_case(case.case_id)


def test_bundled_correction_resumes_data_block(app_factory):
    app = app_factory()
    case = app.create_and_process("SYN-0004")
    assert case.status == CaseStatus.DATA_BLOCKED
    assert app.apply_bundled_correction(case.case_id) == ["lms"]
    app.workflow.process_case(case.case_id)
    assert app.repository.get_case(case.case_id).status == CaseStatus.AWAITING_MENTOR


def test_parallel_collectors_match_sequential_and_are_faster(settings):
    connector = GovernedConnector(
        FixtureConnector(settings.fixtures_path, artificial_delay=0.04)
    )
    started = time.perf_counter()
    sequential = connector.collect("CASE-TIMING", "SYN-0001", parallel=False)
    sequential_time = time.perf_counter() - started
    started = time.perf_counter()
    parallel = connector.collect("CASE-TIMING", "SYN-0001", parallel=True)
    parallel_time = time.perf_counter() - started
    assert {key: value.model_dump(mode="json") for key, value in parallel.items()} == {
        key: value.model_dump(mode="json") for key, value in sequential.items()
    }
    assert parallel_time < sequential_time * 0.7


def test_connector_rejects_non_synthetic_scope(settings):
    connector = FixtureConnector(settings.fixtures_path)
    with pytest.raises(PermissionError):
        connector.read("REAL-123", "academic")


def test_case_request_rejects_real_student_reference(app_factory):
    app = app_factory()
    with pytest.raises(ValueError):
        app.create_case("REAL-123")


def test_rollback_clones_selected_artifact_version(app_factory):
    app = app_factory()
    case = app.create_and_process("SYN-0001")
    app.workflow.decide(
        case.case_id,
        MentorDecision(
            decision=DecisionType.APPROVE,
            mentor_id="mentor-01",
            nonce="approve-before-rollback",
            reason="Reviewed.",
        ),
    )
    app.workflow.reopen(
        case.case_id,
        "mentor-01",
        "Restore the reviewed v1 packet.",
        action="rollback",
        source_version=1,
    )
    current = app.repository.get_case(case.case_id)
    assert current.status == CaseStatus.AWAITING_MENTOR
    assert current.latest_artifact_version == 2
    assert any(
        event.event_type == "ARTIFACT_ROLLED_BACK"
        for event in app.repository.list_events(case.case_id)
    )
