from __future__ import annotations

from typing import Any, Protocol

from student_success.contracts.models import (
    CasePacket,
    NormalizedSnapshot,
    PolicyBundle,
    PriorityAssessment,
)


class PacketGenerator(Protocol):
    name: str
    call_count: int

    def generate(
        self,
        case_id: str,
        snapshot: NormalizedSnapshot,
        assessment: PriorityAssessment,
        bundle: PolicyBundle,
    ) -> CasePacket: ...

    def repair(
        self,
        packet: CasePacket,
        failing_fields: set[str],
        snapshot: NormalizedSnapshot,
        assessment: PriorityAssessment,
        bundle: PolicyBundle,
    ) -> dict[str, Any]: ...


def merge_named_patch(
    packet: CasePacket, patch: dict[str, Any], allowed_fields: set[str]
) -> CasePacket:
    disallowed = set(patch) - allowed_fields
    if disallowed:
        raise ValueError(
            f"Repair attempted to modify non-failing fields: {sorted(disallowed)}"
        )
    payload = packet.model_dump(mode="json")
    payload.update(patch)
    return CasePacket.model_validate(payload)
