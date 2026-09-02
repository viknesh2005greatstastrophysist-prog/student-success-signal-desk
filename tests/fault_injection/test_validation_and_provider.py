from __future__ import annotations

from types import SimpleNamespace

import pytest

from student_success.contracts.models import CasePacket
from student_success.evaluation import EvaluationRunner
from student_success.generation.openai_adapter import OpenAIPacketGenerator
from student_success.validation import PacketValidator


def test_validator_rejects_unknown_reference(app_factory):
    app = app_factory()
    case = app.create_and_process("SYN-0001")
    artifact = app.repository.get_artifact(case.case_id)
    snapshot = app.repository.get_snapshot(artifact.snapshot_id)
    payload = artifact.packet.model_dump(mode="json")
    payload["evidence_summary"][0]["source_refs"] = ["academic:invented"]
    bad = CasePacket.model_validate(payload)
    report = PacketValidator(app.bundle).validate(bad, snapshot, artifact.assessment)
    assert not report.is_valid
    assert {finding.code for finding in report.findings} >= {
        "UNKNOWN_SOURCE_REF",
        "MISALIGNED_SOURCE_REF",
    }


def test_mentor_edit_cannot_add_prohibited_action(app_factory):
    app = app_factory()
    case = app.create_and_process("SYN-0001")
    artifact = app.repository.get_artifact(case.case_id)
    payload = artifact.packet.model_dump(mode="json")
    payload["proposed_support"][0]["rationale"] = "Message the student immediately."
    from student_success.contracts.models import DecisionType, MentorDecision

    with pytest.raises(ValueError, match="failed validation"):
        app.workflow.decide(
            case.case_id,
            MentorDecision(
                decision=DecisionType.EDIT_APPROVE,
                mentor_id="mentor-01",
                nonce="unsafe-edit",
                reason="Trying unsafe edit.",
                edited_packet=CasePacket.model_validate(payload),
            ),
        )


def test_openai_adapter_contract_with_fake_client(app_factory):
    app = app_factory()
    case = app.create_and_process("SYN-0001")
    artifact = app.repository.get_artifact(case.case_id)
    snapshot = app.repository.get_snapshot(artifact.snapshot_id)
    fake_response = SimpleNamespace(output_parsed=artifact.packet)
    fake_parse = lambda **kwargs: fake_response
    fake_client = SimpleNamespace(responses=SimpleNamespace(parse=fake_parse))
    generator = OpenAIPacketGenerator("fake-model", client=fake_client)
    packet = generator.generate(case.case_id, snapshot, artifact.assessment, app.bundle)
    assert packet.generated_by == "openai"
    assert generator.call_count == 1


def test_evaluation_is_honest_when_live_model_is_unavailable(settings, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    path, results = EvaluationRunner(settings).run(
        students=["SYN-0001"], allow_live_model=False
    )
    assert path.exists()
    statuses = {(result.variant, result.status) for result in results}
    assert ("deterministic_baseline", "completed") in statuses
    assert ("isolated_llm", "skipped") in statuses
    assert ("governed_agentic", "skipped") in statuses
