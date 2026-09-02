from __future__ import annotations

from typing import Any

from student_success.contracts.models import (
    CasePacket,
    DataState,
    EvidenceClaim,
    NormalizedSnapshot,
    PolicyBundle,
    PriorityAssessment,
    ProposedSupport,
)


class DeterministicGenerator:
    name = "deterministic"

    def __init__(self):
        self.call_count = 0

    @staticmethod
    def _content(
        case_id: str,
        snapshot: NormalizedSnapshot,
        assessment: PriorityAssessment,
        bundle: PolicyBundle,
    ) -> dict[str, Any]:
        if assessment.signals:
            claims = [
                EvidenceClaim(
                    claim=signal.description,
                    source_refs=signal.source_refs,
                    reason_code=signal.reason_code,
                )
                for signal in assessment.signals
            ]
        else:
            required_refs = [
                ref
                for ref, record in snapshot.record_index.items()
                if record.source in bundle.policy.required_sources
            ]
            claims = [
                EvidenceClaim(
                    claim="The supplied required-source fields do not cross a fictional concern threshold.",
                    source_refs=required_refs,
                    reason_code="NO_CONCERNING_SIGNALS",
                )
            ]

        unknowns: list[str] = []
        for source, envelope in snapshot.envelopes.items():
            if envelope.data_state != DataState.PRESENT:
                unknowns.append(
                    f"{source.value}: source state is {envelope.data_state.value}; no inference was made."
                )

        items_by_id = {item.id: item for item in bundle.catalogue.items}
        selected: list[ProposedSupport] = []
        selected_ids: set[str] = set()
        reasons = assessment.reason_codes
        for reason in reasons:
            item = next(
                (
                    item
                    for item in bundle.catalogue.items
                    if reason in item.eligible_reason_codes
                ),
                None,
            )
            if item is None or item.id in selected_ids:
                continue
            refs = next(
                (
                    signal.source_refs
                    for signal in assessment.signals
                    if signal.reason_code == reason
                ),
                [],
            )
            if reason == "NO_CONCERNING_SIGNALS":
                refs = claims[0].source_refs
            selected.append(
                ProposedSupport(
                    catalogue_id=item.id,
                    rationale_source_refs=refs,
                    rationale=f"Catalogue option for {reason}; mentor judgement is required before any action.",
                )
            )
            selected_ids.add(item.id)
            if len(selected) == 3:
                break
        if not selected and "SUP-07" in items_by_id:
            selected.append(
                ProposedSupport(
                    catalogue_id="SUP-07",
                    rationale_source_refs=claims[0].source_refs,
                    rationale="No immediate catalogue action is indicated by the fictional policy; mentor judgement remains final.",
                )
            )

        return {
            "case_id": case_id,
            "priority": assessment.priority,
            "evidence_summary": claims,
            "unknowns": unknowns,
            "proposed_support": selected,
            "mentor_questions": [
                "Does the supplied evidence justify this support proposal, and what context is still missing?"
            ],
            "prohibited_action_detected": False,
            "generated_by": "deterministic",
            "generation_note": "Template baseline generated only from supplied reason codes, source references, and catalogue items.",
        }

    def generate(
        self,
        case_id: str,
        snapshot: NormalizedSnapshot,
        assessment: PriorityAssessment,
        bundle: PolicyBundle,
    ) -> CasePacket:
        self.call_count += 1
        return CasePacket.model_validate(
            self._content(case_id, snapshot, assessment, bundle)
        )

    def repair(
        self,
        packet: CasePacket,
        failing_fields: set[str],
        snapshot: NormalizedSnapshot,
        assessment: PriorityAssessment,
        bundle: PolicyBundle,
    ) -> dict[str, Any]:
        self.call_count += 1
        clean = self._content(packet.case_id, snapshot, assessment, bundle)
        return {field: clean[field] for field in failing_fields if field in clean}
