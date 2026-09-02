from __future__ import annotations

import json

import pytest

from student_success.access import (
    DEMO_IDENTITIES,
    UserRole,
    allowed_pages,
    require_case_access,
)
from student_success.contracts.models import (
    CohortRunStatus,
    DecisionType,
    InterventionStatus,
    MentorDecision,
)
from student_success.ecosystem import EcosystemService
from student_success.persistence import InvalidTransition


def identity(identity_id: str):
    return next(item for item in DEMO_IDENTITIES if item.identity_id == identity_id)


def approve(app, case, nonce="ecosystem-approve"):
    app.workflow.decide(
        case.case_id,
        MentorDecision(
            decision=DecisionType.APPROVE,
            mentor_id=case.assigned_mentor,
            nonce=nonce,
            reason="Synthetic evidence and policy boundary reviewed.",
        ),
    )


def test_role_navigation_and_case_scope(app_factory):
    app = app_factory()
    case = app.create_and_process("SYN-0001", assigned_mentor="mentor-01")
    mentor_one = identity("mentor-01")
    mentor_two = identity("mentor-02")
    assert "Mentor Workspace" in allowed_pages(mentor_one)
    assert "Leadership Cockpit" not in allowed_pages(mentor_one)
    require_case_access(mentor_one, case)
    with pytest.raises(PermissionError):
        require_case_access(mentor_two, case)


def test_student_portal_is_self_scoped(app_factory, settings):
    app = app_factory()
    app.create_and_process("SYN-0001")
    service = EcosystemService(app.repository, settings.fixtures_path)
    student = identity("student:0001")
    view = service.student_portal(student, "SYN-0001")
    assert view["profile"]["student_ref"] == "SYN-0001"
    assert "priority" not in view
    with pytest.raises(PermissionError):
        service.student_portal(student, "SYN-0002")


def test_approval_creates_interventions_and_rejection_does_not(app_factory, settings):
    app = app_factory()
    approved = app.create_and_process("SYN-0001")
    approve(app, approved)
    interventions = app.repository.list_interventions(case_id=approved.case_id)
    assert interventions
    assert {item.status for item in interventions} == {InterventionStatus.PLANNED}

    rejected = app.create_and_process("SYN-0006")
    app.workflow.decide(
        rejected.case_id,
        MentorDecision(
            decision=DecisionType.REJECT,
            mentor_id=rejected.assigned_mentor,
            nonce="ecosystem-reject",
            reason="No support action is required.",
        ),
    )
    assert not app.repository.list_interventions(case_id=rejected.case_id)


def test_intervention_owner_guard_and_audit(app_factory):
    app = app_factory()
    case = app.create_and_process("SYN-0001")
    approve(app, case)
    intervention = app.repository.list_interventions(case_id=case.case_id)[0]
    with pytest.raises(PermissionError):
        app.repository.update_intervention(
            intervention.intervention_id,
            "mentor-02",
            InterventionStatus.SCHEDULED,
        )
    updated = app.repository.update_intervention(
        intervention.intervention_id,
        "mentor-01",
        InterventionStatus.SCHEDULED,
        note="Synthetic mentor session placed on the demo plan.",
    )
    assert updated.status == InterventionStatus.SCHEDULED
    assert any(
        event.event_type == "INTERVENTION_STATUS_UPDATED"
        for event in app.repository.list_events(case.case_id)
    )
    with pytest.raises(InvalidTransition):
        app.repository.update_intervention(
            intervention.intervention_id,
            "mentor-01",
            InterventionStatus.COMPLETED,
        )


def test_leadership_view_is_aggregate_only(app_factory, settings):
    app = app_factory()
    app.create_and_process("SYN-0001")
    app.create_and_process("SYN-0002")
    service = EcosystemService(app.repository, settings.fixtures_path)
    snapshot = service.leadership_snapshot()
    rendered = json.dumps(snapshot)
    assert snapshot["contains_student_references"] is False
    assert "SYN-" not in rendered


def test_concern_index_and_connector_health_are_deterministic(app_factory, settings):
    app = app_factory()
    high = app.create_and_process("SYN-0002")
    service = EcosystemService(app.repository, settings.fixtures_path)
    artifact = app.repository.get_artifact(high.case_id)
    assert service.concern_index(artifact) == 100
    health = {row["source"]: row for row in service.connector_health()}
    assert health["academic"]["present"] == 1
    assert all(row["simulated"] for row in health.values())
    assert identity("hod-demo").role == UserRole.LEADERSHIP


def test_cohort_run_ledger_tracks_completed_and_blocked_cases(app_factory):
    app = app_factory()
    run = app.repository.start_cohort_run("TEST-COHORT", "demo-admin", 2)
    ready = app.create_and_process("SYN-0001")
    blocked = app.create_and_process("SYN-0003")
    app.repository.attach_case_to_cohort_run(run.run_id, ready.case_id)
    app.repository.attach_case_to_cohort_run(run.run_id, blocked.case_id)
    completed = app.repository.complete_cohort_run(run.run_id)
    assert completed.status == CohortRunStatus.COMPLETED_WITH_BLOCKS
    assert completed.completed_cases == 2
    assert completed.blocked_cases == 1
    assert app.repository.list_cohort_runs() == [completed]
