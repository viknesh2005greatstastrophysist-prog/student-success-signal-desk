from __future__ import annotations

import hashlib
import json
from datetime import datetime

from student_success.contracts.models import (
    DataIssue,
    DataState,
    DemoPolicy,
    EvidenceRecord,
    NormalizedSnapshot,
    SourceEnvelope,
    SourceName,
)


def _stable_hash(payload: object) -> str:
    encoded = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), default=str
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def normalize_snapshot(
    case_id: str,
    student_ref: str,
    envelopes: dict[SourceName, SourceEnvelope],
    policy: DemoPolicy,
) -> NormalizedSnapshot:
    normalized: dict[SourceName, SourceEnvelope] = {}
    issues: list[DataIssue] = []
    record_index: dict[str, EvidenceRecord] = {}

    for source in SourceName:
        envelope = envelopes[source].model_copy(deep=True)
        if (
            envelope.data_state == DataState.PRESENT
            and envelope.observed_at is not None
        ):
            age_days = (
                policy.reference_date - envelope.observed_at
            ).total_seconds() / 86400
            if age_days > policy.windows_days[source]:
                envelope.data_state = DataState.STALE
                envelope.errors.append(
                    f"record age {age_days:.1f} days exceeds {policy.windows_days[source]} day window"
                )
        normalized[source] = envelope

        if envelope.data_state in {
            DataState.MISSING,
            DataState.STALE,
            DataState.CONTRADICTORY,
        }:
            reason = {
                DataState.MISSING: "DATA_MISSING",
                DataState.STALE: "DATA_STALE",
                DataState.CONTRADICTORY: "DATA_CONTRADICTORY",
            }[envelope.data_state]
            issues.append(
                DataIssue(
                    source=source,
                    state=envelope.data_state,
                    reason_code=reason,
                    detail="; ".join(envelope.errors)
                    or f"{source.value} is {envelope.data_state.value}",
                )
            )

        for record_id in envelope.provenance.get("record_ids", []):
            ref = f"{source.value}:{record_id}"
            record_index[ref] = EvidenceRecord(
                ref=ref,
                source=source,
                observed_at=envelope.observed_at,
                fields=envelope.fields,
            )

    required_bad = any(
        normalized[source].data_state
        in {DataState.MISSING, DataState.STALE, DataState.CONTRADICTORY}
        for source in policy.required_sources
    )
    canonical = {
        source.value: envelope.model_dump(mode="json")
        for source, envelope in sorted(
            normalized.items(), key=lambda pair: pair[0].value
        )
    }
    snapshot_id = f"snap-{_stable_hash({'case_id': case_id, 'records': canonical, 'policy': policy.policy_version})[:16]}"
    return NormalizedSnapshot(
        snapshot_id=snapshot_id,
        case_id=case_id,
        student_ref=student_ref,
        collected_at=datetime.fromisoformat(str(policy.reference_date)),
        envelopes=normalized,
        record_index=record_index,
        data_issues=issues,
        is_sufficient=not required_bad,
        policy_version=policy.policy_version,
    )
