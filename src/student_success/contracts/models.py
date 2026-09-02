from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utc_now() -> datetime:
    return datetime.now(UTC)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=False)


class DataState(str, Enum):
    PRESENT = "present"
    MISSING = "missing"
    STALE = "stale"
    CONTRADICTORY = "contradictory"
    NOT_APPLICABLE = "not_applicable"


class SourceName(str, Enum):
    ACADEMIC = "academic"
    LMS = "lms"
    INTERNSHIP = "internship"
    PLACEMENT = "placement"


class CaseStatus(str, Enum):
    CREATED = "CREATED"
    COLLECTING = "COLLECTING"
    DATA_BLOCKED = "DATA_BLOCKED"
    DRAFTING = "DRAFTING"
    VALIDATING = "VALIDATING"
    AWAITING_MENTOR = "AWAITING_MENTOR"
    CLOSED = "CLOSED"


class Priority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    DATA_BLOCKED = "data_blocked"


class ActorRole(str, Enum):
    RUNTIME = "runtime"
    MENTOR = "mentor"
    ADMIN = "admin"
    STUDENT = "student"
    LEADERSHIP = "leadership"


class DecisionType(str, Enum):
    APPROVE = "approve"
    EDIT_APPROVE = "edit_approve"
    REJECT = "reject"


class InterventionStatus(str, Enum):
    PLANNED = "PLANNED"
    SCHEDULED = "SCHEDULED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class CohortRunStatus(str, Enum):
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    COMPLETED_WITH_BLOCKS = "COMPLETED_WITH_BLOCKS"
    FAILED = "FAILED"


INTERVENTION_TRANSITIONS = {
    InterventionStatus.PLANNED: {
        InterventionStatus.PLANNED,
        InterventionStatus.SCHEDULED,
        InterventionStatus.CANCELLED,
    },
    InterventionStatus.SCHEDULED: {
        InterventionStatus.SCHEDULED,
        InterventionStatus.IN_PROGRESS,
        InterventionStatus.CANCELLED,
    },
    InterventionStatus.IN_PROGRESS: {
        InterventionStatus.IN_PROGRESS,
        InterventionStatus.COMPLETED,
        InterventionStatus.CANCELLED,
    },
    InterventionStatus.COMPLETED: {InterventionStatus.COMPLETED},
    InterventionStatus.CANCELLED: {InterventionStatus.CANCELLED},
}


def allowed_intervention_statuses(
    current: InterventionStatus,
) -> tuple[InterventionStatus, ...]:
    return tuple(
        status
        for status in InterventionStatus
        if status in INTERVENTION_TRANSITIONS[current]
    )


class SourceEnvelope(StrictModel):
    source: SourceName
    student_ref: str
    observed_at: datetime | None
    retrieved_at: datetime
    data_state: DataState
    fields: dict[str, Any]
    provenance: dict[str, Any]
    errors: list[str] = Field(default_factory=list)


class CaseRequest(StrictModel):
    student_ref: str = Field(pattern=r"^SYN-\d{4}$")
    assigned_mentor: str = Field(min_length=2, max_length=100)
    requested_by: str = Field(min_length=2, max_length=100)
    request_id: str = Field(min_length=2, max_length=150)
    policy_version: str


class DataIssue(StrictModel):
    source: SourceName
    state: DataState
    reason_code: str
    detail: str


class EvidenceRecord(StrictModel):
    ref: str
    source: SourceName
    observed_at: datetime | None
    fields: dict[str, Any]


class Signal(StrictModel):
    reason_code: str
    source: SourceName
    source_refs: list[str]
    observed_value: int | float
    threshold: int | float
    comparator: str
    critical: bool = False
    description: str


class NormalizedSnapshot(StrictModel):
    snapshot_id: str
    case_id: str
    student_ref: str
    collected_at: datetime
    envelopes: dict[SourceName, SourceEnvelope]
    record_index: dict[str, EvidenceRecord]
    data_issues: list[DataIssue] = Field(default_factory=list)
    is_sufficient: bool
    policy_version: str


class PriorityAssessment(StrictModel):
    priority: Priority
    concern_index: int = Field(default=0, ge=0, le=100)
    reason_codes: list[str]
    signals: list[Signal]
    policy_version: str
    evaluated_at: datetime


class EvidenceClaim(StrictModel):
    claim: str = Field(min_length=1, max_length=500)
    source_refs: list[str] = Field(min_length=1)
    reason_code: str


class ProposedSupport(StrictModel):
    catalogue_id: str
    rationale_source_refs: list[str]
    rationale: str = Field(min_length=1, max_length=500)


class CasePacket(StrictModel):
    case_id: str
    priority: Priority
    evidence_summary: list[EvidenceClaim]
    unknowns: list[str]
    proposed_support: list[ProposedSupport]
    mentor_questions: list[str] = Field(min_length=1)
    prohibited_action_detected: bool = False
    generated_by: Literal["deterministic", "openai", "test"]
    generation_note: str

    @field_validator("unknowns", "mentor_questions")
    @classmethod
    def no_blank_strings(cls, values: list[str]) -> list[str]:
        if any(not value.strip() for value in values):
            raise ValueError("blank strings are not allowed")
        return values


class ValidationFinding(StrictModel):
    validator: str
    field: str
    code: str
    message: str
    repairable: bool


class ValidationReport(StrictModel):
    is_valid: bool
    findings: list[ValidationFinding]
    validators_run: list[str]
    validated_at: datetime = Field(default_factory=utc_now)
    retry_attempt: int = 0


class CaseRecord(StrictModel):
    case_id: str
    student_ref: str
    assigned_mentor: str
    requested_by: str
    request_id: str
    status: CaseStatus
    policy_version: str
    latest_snapshot_id: str | None = None
    latest_artifact_version: int = 0
    active_thread_id: str | None = None
    closed_reason: str | None = None
    created_at: datetime
    updated_at: datetime


class CaseArtifact(StrictModel):
    case_id: str
    version: int
    snapshot_id: str
    assessment: PriorityAssessment
    packet: CasePacket
    validation: ValidationReport
    generator_mode: str
    diagnosis: list[str] = Field(default_factory=list)
    created_at: datetime


class MentorDecision(StrictModel):
    decision: DecisionType
    mentor_id: str
    nonce: str
    reason: str = Field(min_length=2, max_length=1000)
    edited_packet: CasePacket | None = None


class InterventionRecord(StrictModel):
    intervention_id: str
    case_id: str
    artifact_version: int
    catalogue_id: str
    rationale: str
    status: InterventionStatus
    owner_id: str
    due_at: datetime | None = None
    outcome: str | None = None
    latest_note: str | None = None
    created_at: datetime
    updated_at: datetime


class CohortRunRecord(StrictModel):
    run_id: str
    cohort_id: str
    requested_by: str
    status: CohortRunStatus
    total_cases: int
    completed_cases: int
    blocked_cases: int
    failure_reason: str | None = None
    started_at: datetime
    completed_at: datetime | None = None


class AuditEvent(StrictModel):
    event_id: str
    case_id: str
    sequence: int
    event_type: str
    from_state: CaseStatus | None
    to_state: CaseStatus | None
    actor_role: ActorRole
    actor_id: str
    payload: dict[str, Any]
    input_hash: str | None
    output_hash: str | None
    idempotency_key: str
    created_at: datetime


class InterventionItem(StrictModel):
    id: str
    label: str
    description: str
    eligible_reason_codes: list[str]


class InterventionCatalogue(StrictModel):
    catalogue_version: str
    items: list[InterventionItem]


class ConcernIndexPolicy(StrictModel):
    signal_points: int = Field(ge=0, le=100)
    critical_bonus: int = Field(ge=0, le=100)
    cap: int = Field(ge=1, le=100)
    meaning: Literal["triage_sorting_aid_not_probability"]


class DemoPolicy(StrictModel):
    policy_version: str
    scope: Literal["synthetic_demo_only"]
    reference_date: datetime
    required_sources: list[SourceName]
    windows_days: dict[SourceName, int]
    thresholds: dict[str, dict[str, float]]
    priority_rules: dict[str, str]
    concern_index: ConcernIndexPolicy
    mentor_required: bool
    direct_student_contact: bool
    max_repair_attempts: int = Field(ge=0, le=5)


class PolicyBundle(StrictModel):
    policy: DemoPolicy
    catalogue: InterventionCatalogue
    prohibited_phrases: list[str]
    prohibited_categories: list[str]


class EvaluationResult(StrictModel):
    evaluation_id: str
    variant: str
    case_id: str
    student_ref: str
    status: str
    priority: Priority | None
    valid: bool | None
    unsupported_claims: int | None
    prohibited_actions: int | None
    retries: int
    latency_ms: float
    generator_calls: int
    note: str
