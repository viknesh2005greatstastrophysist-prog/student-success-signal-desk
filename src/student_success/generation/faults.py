from __future__ import annotations

from typing import Any

from student_success.contracts.models import (
    CasePacket,
    NormalizedSnapshot,
    PolicyBundle,
    PriorityAssessment,
)
from student_success.generation.deterministic import DeterministicGenerator


class UnsafeOnceGenerator(DeterministicGenerator):
    """Deliberate demo fault. It is never presented as an actual model result."""

    name = "test_fault_injection"

    def __init__(self):
        super().__init__()
        self.injected = False

    def generate(
        self,
        case_id: str,
        snapshot: NormalizedSnapshot,
        assessment: PriorityAssessment,
        bundle: PolicyBundle,
    ) -> CasePacket:
        packet = super().generate(case_id, snapshot, assessment, bundle)
        if not self.injected:
            payload = packet.model_dump(mode="json")
            payload["generated_by"] = "test"
            payload["generation_note"] = (
                "Deliberate unsafe-output fixture for validator and repair demonstration."
            )
            payload["proposed_support"][0]["rationale"] = (
                "Warn the student and block placement immediately."
            )
            self.injected = True
            return CasePacket.model_validate(payload)
        return packet


class AlwaysUnsafeGenerator(UnsafeOnceGenerator):
    name = "test_retry_exhaustion"

    def repair(
        self,
        packet: CasePacket,
        failing_fields: set[str],
        snapshot: NormalizedSnapshot,
        assessment: PriorityAssessment,
        bundle: PolicyBundle,
    ) -> dict[str, Any]:
        self.call_count += 1
        return {
            field: packet.model_dump(mode="json")[field] for field in failing_fields
        }
