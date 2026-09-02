from __future__ import annotations

import json

from student_success.contracts.models import (
    CasePacket,
    DataState,
    NormalizedSnapshot,
    PolicyBundle,
    PriorityAssessment,
    ValidationFinding,
    ValidationReport,
)

VALIDATORS = [
    "priority_lock",
    "citation_existence",
    "signal_alignment",
    "reason_coverage",
    "unknown_disclosure",
    "catalogue_policy",
    "prohibited_action",
    "mentor_question",
]


class PacketValidator:
    def __init__(self, bundle: PolicyBundle):
        self.bundle = bundle

    @staticmethod
    def _finding(
        validator: str, field: str, code: str, message: str, repairable: bool = True
    ) -> ValidationFinding:
        return ValidationFinding(
            validator=validator,
            field=field,
            code=code,
            message=message,
            repairable=repairable,
        )

    def validate(
        self,
        packet: CasePacket,
        snapshot: NormalizedSnapshot,
        assessment: PriorityAssessment,
        retry_attempt: int = 0,
    ) -> ValidationReport:
        findings: list[ValidationFinding] = []
        valid_refs = set(snapshot.record_index)
        signal_refs = {
            signal.reason_code: set(signal.source_refs) for signal in assessment.signals
        }

        if packet.case_id != snapshot.case_id or packet.priority != assessment.priority:
            findings.append(
                self._finding(
                    "priority_lock",
                    "priority",
                    "PRIORITY_MISMATCH",
                    "Packet identity or priority differs from the deterministic assessment.",
                )
            )

        for claim in packet.evidence_summary:
            if not set(claim.source_refs).issubset(valid_refs):
                findings.append(
                    self._finding(
                        "citation_existence",
                        "evidence_summary",
                        "UNKNOWN_SOURCE_REF",
                        f"Claim cites an unknown source reference: {claim.source_refs}.",
                    )
                )
            if claim.reason_code not in assessment.reason_codes:
                findings.append(
                    self._finding(
                        "signal_alignment",
                        "evidence_summary",
                        "UNKNOWN_REASON_CODE",
                        f"{claim.reason_code} was not emitted by the priority engine.",
                    )
                )
            expected_refs = signal_refs.get(claim.reason_code)
            if expected_refs is not None and not set(claim.source_refs).issubset(
                expected_refs
            ):
                findings.append(
                    self._finding(
                        "signal_alignment",
                        "evidence_summary",
                        "MISALIGNED_SOURCE_REF",
                        f"{claim.reason_code} is not supported by the cited record.",
                    )
                )

        claimed_reasons = {claim.reason_code for claim in packet.evidence_summary}
        missing_reasons = set(assessment.reason_codes) - claimed_reasons
        if missing_reasons:
            findings.append(
                self._finding(
                    "reason_coverage",
                    "evidence_summary",
                    "MISSING_REASON_COVERAGE",
                    f"Evidence summary omits deterministic reason codes: {sorted(missing_reasons)}.",
                )
            )

        unknown_text = " ".join(packet.unknowns).lower()
        for source, envelope in snapshot.envelopes.items():
            if (
                envelope.data_state != DataState.PRESENT
                and source.value not in unknown_text
            ):
                findings.append(
                    self._finding(
                        "unknown_disclosure",
                        "unknowns",
                        "UNDISCLOSED_SOURCE_STATE",
                        f"{source.value} state {envelope.data_state.value} is not disclosed.",
                    )
                )

        catalogue = {item.id: item for item in self.bundle.catalogue.items}
        for proposal in packet.proposed_support:
            item = catalogue.get(proposal.catalogue_id)
            if item is None:
                findings.append(
                    self._finding(
                        "catalogue_policy",
                        "proposed_support",
                        "UNKNOWN_CATALOGUE_ID",
                        f"{proposal.catalogue_id} is not approved.",
                    )
                )
                continue
            if not set(item.eligible_reason_codes).intersection(
                assessment.reason_codes
            ):
                findings.append(
                    self._finding(
                        "catalogue_policy",
                        "proposed_support",
                        "INELIGIBLE_CATALOGUE_ID",
                        f"{proposal.catalogue_id} is not eligible for {assessment.reason_codes}.",
                    )
                )
            if not set(proposal.rationale_source_refs).issubset(valid_refs):
                findings.append(
                    self._finding(
                        "citation_existence",
                        "proposed_support",
                        "UNKNOWN_RATIONALE_REF",
                        f"{proposal.catalogue_id} cites an unknown record.",
                    )
                )
        if not packet.proposed_support:
            findings.append(
                self._finding(
                    "catalogue_policy",
                    "proposed_support",
                    "EMPTY_SUPPORT_PROPOSAL",
                    "At least one catalogue-constrained disposition is required.",
                )
            )

        searchable = json.dumps(packet.model_dump(mode="json"), sort_keys=True).lower()
        matched = sorted(
            {
                phrase
                for phrase in self.bundle.prohibited_phrases
                if phrase.lower() in searchable
            }
        )
        if matched or packet.prohibited_action_detected:
            findings.append(
                self._finding(
                    "prohibited_action",
                    "proposed_support",
                    "PROHIBITED_ACTION",
                    f"Prohibited content detected: {matched or ['model flag']}.",
                )
            )

        if not packet.mentor_questions:
            findings.append(
                self._finding(
                    "mentor_question",
                    "mentor_questions",
                    "MENTOR_QUESTION_REQUIRED",
                    "The packet must make the human judgement point explicit.",
                )
            )

        return ValidationReport(
            is_valid=not findings,
            findings=findings,
            validators_run=VALIDATORS,
            retry_attempt=retry_attempt,
        )
