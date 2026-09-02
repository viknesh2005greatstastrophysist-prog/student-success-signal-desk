from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

import yaml

from student_success.access import DemoIdentity, UserRole, require_student_scope
from student_success.contracts.models import (
    CaseArtifact,
    CaseRecord,
    CaseStatus,
    DataState,
    InterventionStatus,
    Priority,
    SourceName,
)
from student_success.persistence import CaseRepository


class EcosystemService:
    """Read models for role-scoped product surfaces.

    The service derives analytics from durable domain records. It does not
    invent educational outcomes or expose student-level records to leadership.
    """

    def __init__(self, repository: CaseRepository, fixtures_path: Path):
        self.repository = repository
        roster_path = fixtures_path / "roster.yaml"
        with roster_path.open("r", encoding="utf-8") as handle:
            self.roster = yaml.safe_load(handle)
        self.profiles = {item["student_ref"]: item for item in self.roster["students"]}

    def latest_cases(self) -> dict[str, CaseRecord]:
        latest: dict[str, CaseRecord] = {}
        for case in self.repository.list_cases():
            latest.setdefault(case.student_ref, case)
        return latest

    def latest_artifact(self, case: CaseRecord) -> CaseArtifact | None:
        if not case.latest_artifact_version:
            return None
        return self.repository.get_artifact(case.case_id)

    @staticmethod
    def concern_index(artifact: CaseArtifact | None) -> int:
        if artifact is None:
            return 0
        assessment = artifact.assessment
        if assessment.concern_index or not assessment.signals:
            return assessment.concern_index
        return min(
            100,
            (15 * len(assessment.signals))
            + (20 * sum(signal.critical for signal in assessment.signals)),
        )

    def overview(self, mentor_id: str | None = None) -> dict[str, Any]:
        cases = list(self.latest_cases().values())
        if mentor_id:
            cases = [case for case in cases if case.assigned_mentor == mentor_id]
        artifacts = [self.latest_artifact(case) for case in cases]
        priorities = Counter(
            artifact.assessment.priority.value
            for artifact in artifacts
            if artifact is not None
        )
        interventions = self.repository.list_interventions(owner_id=mentor_id)
        return {
            "students_monitored": len(cases) if mentor_id else len(self.profiles),
            "at_risk": priorities[Priority.HIGH.value]
            + priorities[Priority.MEDIUM.value],
            "high_priority": priorities[Priority.HIGH.value],
            "awaiting_mentor": sum(
                case.status == CaseStatus.AWAITING_MENTOR for case in cases
            ),
            "data_blocked": sum(
                case.status == CaseStatus.DATA_BLOCKED for case in cases
            ),
            "interventions": len(interventions),
            "interventions_active": sum(
                item.status
                not in {InterventionStatus.COMPLETED, InterventionStatus.CANCELLED}
                for item in interventions
            ),
            "priority_distribution": dict(priorities),
        }

    def risk_rows(self, mentor_id: str | None = None) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for case in self.latest_cases().values():
            if mentor_id and case.assigned_mentor != mentor_id:
                continue
            artifact = self.latest_artifact(case)
            profile = self.profiles.get(case.student_ref, {})
            rows.append(
                {
                    "student_ref": case.student_ref,
                    "section": profile.get("section", "—"),
                    "mentor": case.assigned_mentor,
                    "priority": (
                        artifact.assessment.priority.value.upper()
                        if artifact
                        else "DATA BLOCKED"
                    ),
                    "concern_index": self.concern_index(artifact),
                    "signals": len(artifact.assessment.signals) if artifact else 0,
                    "state": case.status.value,
                    "case_id": case.case_id,
                }
            )
        priority_order = {"HIGH": 0, "MEDIUM": 1, "DATA BLOCKED": 2, "LOW": 3}
        return sorted(
            rows,
            key=lambda row: (
                priority_order.get(row["priority"], 9),
                -row["concern_index"],
                row["student_ref"],
            ),
        )

    def signals_by_source(self) -> dict[str, int]:
        counts = Counter({source.value: 0 for source in SourceName})
        for case in self.latest_cases().values():
            artifact = self.latest_artifact(case)
            if artifact:
                counts.update(
                    signal.source.value for signal in artifact.assessment.signals
                )
        return dict(counts)

    def connector_health(self) -> list[dict[str, Any]]:
        state_counts = {
            source: Counter({state.value: 0 for state in DataState})
            for source in SourceName
        }
        observed = Counter({source: 0 for source in SourceName})
        latest_observed: dict[SourceName, str | None] = {
            source: None for source in SourceName
        }
        for case in self.latest_cases().values():
            if not case.latest_snapshot_id:
                continue
            snapshot = self.repository.get_snapshot(case.latest_snapshot_id)
            for source, envelope in snapshot.envelopes.items():
                state_counts[source][envelope.data_state.value] += 1
                observed[source] += 1
                if envelope.observed_at:
                    stamp = envelope.observed_at.isoformat()
                    if (
                        latest_observed[source] is None
                        or stamp > latest_observed[source]
                    ):
                        latest_observed[source] = stamp
        rows = []
        total = len(self.profiles)
        for source in SourceName:
            counts = state_counts[source]
            attention = sum(
                counts[state.value]
                for state in (
                    DataState.MISSING,
                    DataState.STALE,
                    DataState.CONTRADICTORY,
                )
            )
            rows.append(
                {
                    "source": source.value,
                    "simulated": True,
                    "records_seen": observed[source],
                    "coverage_pct": round(100 * observed[source] / total)
                    if total
                    else 0,
                    "present": counts[DataState.PRESENT.value],
                    "not_applicable": counts[DataState.NOT_APPLICABLE.value],
                    "attention": attention,
                    "latest_observed": latest_observed[source] or "No run",
                }
            )
        return rows

    def leadership_snapshot(self) -> dict[str, Any]:
        overview = self.overview()
        return {
            "cohort_id": self.roster["cohort_id"],
            "department": self.roster["department"],
            "term": self.roster["term"],
            "metrics": overview,
            "priority_distribution": overview["priority_distribution"],
            "signals_by_source": self.signals_by_source(),
            "connector_quality": [
                {
                    "source": row["source"],
                    "coverage_pct": row["coverage_pct"],
                    "attention": row["attention"],
                }
                for row in self.connector_health()
            ],
            "contains_student_references": False,
        }

    def recent_events(self, limit: int = 80) -> list[dict[str, Any]]:
        events = []
        for case in self.repository.list_cases():
            for event in self.repository.list_events(case.case_id):
                events.append(
                    {
                        "created_at": event.created_at,
                        "case_id": case.case_id,
                        "student_ref": case.student_ref,
                        "event_type": event.event_type,
                        "actor": f"{event.actor_role.value}/{event.actor_id}",
                        "state": event.to_state.value if event.to_state else "—",
                    }
                )
        events.sort(key=lambda item: item["created_at"], reverse=True)
        return events[:limit]

    def student_portal(
        self, identity: DemoIdentity, student_ref: str
    ) -> dict[str, Any]:
        require_student_scope(identity, student_ref)
        profile = self.profiles[student_ref]
        case = self.latest_cases().get(student_ref)
        source_status: list[dict[str, str]] = []
        if case and case.latest_snapshot_id:
            snapshot = self.repository.get_snapshot(case.latest_snapshot_id)
            source_status = [
                {
                    "source": source.value,
                    "state": envelope.data_state.value,
                    "observed_at": (
                        envelope.observed_at.date().isoformat()
                        if envelope.observed_at
                        else "Not supplied"
                    ),
                }
                for source, envelope in snapshot.envelopes.items()
            ]
        interventions = self.repository.list_interventions(student_ref=student_ref)
        return {
            "profile": profile,
            "review_state": case.status.value if case else "NO_ACTIVE_REVIEW",
            "source_status": source_status,
            "support_plan": interventions,
            "privacy_notice": (
                "This demo view is scoped to one synthetic identity and does not "
                "show peer rankings or a predictive risk label."
            ),
        }

    def cases_for_identity(self, identity: DemoIdentity) -> list[CaseRecord]:
        if identity.role == UserRole.ADMIN:
            return self.repository.list_cases()
        if identity.role == UserRole.MENTOR:
            return [
                case
                for case in self.repository.list_cases()
                if case.assigned_mentor == identity.mentor_id
            ]
        return []
