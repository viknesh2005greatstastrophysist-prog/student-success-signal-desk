from __future__ import annotations

import sqlite3
import time
import uuid
from typing import Any, Literal, TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from student_success.connectors import GovernedConnector
from student_success.contracts.models import (
    ActorRole,
    CasePacket,
    CaseStatus,
    DecisionType,
    MentorDecision,
    NormalizedSnapshot,
    PolicyBundle,
    PriorityAssessment,
    SourceEnvelope,
    SourceName,
    ValidationReport,
)
from student_success.generation.base import PacketGenerator, merge_named_patch
from student_success.generation.deterministic import DeterministicGenerator
from student_success.persistence import CaseRepository, InvalidTransition
from student_success.persistence.repository import stable_hash
from student_success.policy import PriorityEngine, normalize_snapshot
from student_success.validation import PacketValidator


class WorkflowState(TypedDict, total=False):
    operation: Literal["build", "review_existing"]
    case_id: str
    run_id: str
    envelopes: dict[str, dict[str, Any]]
    snapshot: dict[str, Any]
    assessment: dict[str, Any]
    packet: dict[str, Any]
    validation: dict[str, Any]
    retry_attempt: int
    diagnosis: list[str]
    generator_mode: str
    artifact_version: int
    mentor_decision: dict[str, Any]


class CaseWorkflow:
    def __init__(
        self,
        repository: CaseRepository,
        connector: GovernedConnector,
        bundle: PolicyBundle,
        generator: PacketGenerator,
        checkpoint_path: str,
    ):
        self.repository = repository
        self.connector = connector
        self.bundle = bundle
        self.generator = generator
        self.fallback = DeterministicGenerator()
        self.priority_engine = PriorityEngine(bundle.policy)
        self.validator = PacketValidator(bundle)
        checkpoint_conn = sqlite3.connect(checkpoint_path, check_same_thread=False)
        self.checkpointer = SqliteSaver(checkpoint_conn)
        self.graph = self._build_graph().compile(checkpointer=self.checkpointer)

    def _build_graph(self) -> StateGraph:
        graph = StateGraph(WorkflowState)
        graph.add_node("collect", self._collect)
        graph.add_node("normalize", self._normalize)
        graph.add_node("prioritize", self._prioritize)
        graph.add_node("draft", self._draft)
        graph.add_node("validate", self._validate)
        graph.add_node("repair", self._repair)
        graph.add_node("fallback", self._fallback)
        graph.add_node("persist", self._persist)
        graph.add_node("mentor_interrupt", self._mentor_interrupt)
        graph.add_node("close", self._close)
        graph.add_conditional_edges(
            START, self._route_start, {"build": "collect", "review": "mentor_interrupt"}
        )
        graph.add_edge("collect", "normalize")
        graph.add_conditional_edges(
            "normalize", self._route_snapshot, {"blocked": END, "ready": "prioritize"}
        )
        graph.add_edge("prioritize", "draft")
        graph.add_edge("draft", "validate")
        graph.add_conditional_edges(
            "validate",
            self._route_validation,
            {"pass": "persist", "repair": "repair", "fallback": "fallback"},
        )
        graph.add_edge("repair", "validate")
        graph.add_edge("fallback", "persist")
        graph.add_edge("persist", "mentor_interrupt")
        graph.add_edge("mentor_interrupt", "close")
        graph.add_edge("close", END)
        return graph

    @staticmethod
    def _route_start(state: WorkflowState) -> str:
        return "review" if state.get("operation") == "review_existing" else "build"

    @staticmethod
    def _route_snapshot(state: WorkflowState) -> str:
        snapshot = NormalizedSnapshot.model_validate(state["snapshot"])
        return "ready" if snapshot.is_sufficient else "blocked"

    def _route_validation(self, state: WorkflowState) -> str:
        report = ValidationReport.model_validate(state["validation"])
        if report.is_valid:
            return "pass"
        repairable = report.findings and all(
            finding.repairable for finding in report.findings
        )
        if (
            repairable
            and state.get("retry_attempt", 0) < self.bundle.policy.max_repair_attempts
        ):
            return "repair"
        return "fallback"

    def _collect(self, state: WorkflowState) -> dict[str, Any]:
        case = self.repository.get_case(state["case_id"])
        run_id = state["run_id"]
        if case.status == CaseStatus.CREATED:
            expected = CaseStatus.CREATED
            event_type = "COLLECTION_STARTED"
        elif case.status == CaseStatus.DATA_BLOCKED:
            expected = CaseStatus.DATA_BLOCKED
            event_type = "COLLECTION_RESUMED_AFTER_CORRECTION"
        elif case.status == CaseStatus.COLLECTING:
            expected = CaseStatus.COLLECTING
            event_type = "COLLECTION_RESUMED_AFTER_CRASH"
        else:
            raise InvalidTransition(f"Cannot collect from {case.status.value}")
        if case.status != CaseStatus.COLLECTING:
            self.repository.transition(
                case.case_id,
                expected,
                CaseStatus.COLLECTING,
                event_type,
                ActorRole.RUNTIME,
                "coordinator",
                {"run_id": run_id},
                f"{run_id}:collect:start",
            )
        started = time.perf_counter()
        envelopes = self.connector.collect(
            case.case_id, case.student_ref, parallel=True
        )
        wall_ms = (time.perf_counter() - started) * 1000
        payload = {
            source.value: envelope.model_dump(mode="json")
            for source, envelope in envelopes.items()
        }
        self.repository.append_event(
            case.case_id,
            "COLLECTORS_FAN_IN",
            ActorRole.RUNTIME,
            "coordinator",
            {
                "sources": sorted(payload),
                "parallel": True,
                "wall_ms": round(wall_ms, 3),
            },
            f"{run_id}:collect:complete",
            output_hash=stable_hash(payload),
        )
        self.repository.record_metric(
            case.case_id, "collector_wall_time", wall_ms, "ms", {"parallel": True}
        )
        return {"envelopes": payload, "retry_attempt": 0, "diagnosis": []}

    def _normalize(self, state: WorkflowState) -> dict[str, Any]:
        case = self.repository.get_case(state["case_id"])
        envelopes = {
            SourceName(source): SourceEnvelope.model_validate(payload)
            for source, payload in state["envelopes"].items()
        }
        snapshot = normalize_snapshot(
            case.case_id, case.student_ref, envelopes, self.bundle.policy
        )
        self.repository.save_snapshot(snapshot)
        self.repository.append_event(
            case.case_id,
            "SNAPSHOT_NORMALISED",
            ActorRole.RUNTIME,
            "normaliser",
            {
                "snapshot_id": snapshot.snapshot_id,
                "is_sufficient": snapshot.is_sufficient,
                "data_issues": [
                    issue.model_dump(mode="json") for issue in snapshot.data_issues
                ],
            },
            f"{state['run_id']}:normalise",
            input_hash=stable_hash(state["envelopes"]),
            output_hash=stable_hash(snapshot),
        )
        if not snapshot.is_sufficient:
            self.repository.transition(
                case.case_id,
                CaseStatus.COLLECTING,
                CaseStatus.DATA_BLOCKED,
                "DATA_QUALITY_BLOCKED",
                ActorRole.RUNTIME,
                "normaliser",
                {
                    "snapshot_id": snapshot.snapshot_id,
                    "issues": [
                        issue.model_dump(mode="json") for issue in snapshot.data_issues
                    ],
                },
                f"{state['run_id']}:data-block",
                output_hash=stable_hash(snapshot.data_issues),
            )
        return {"snapshot": snapshot.model_dump(mode="json")}

    def _prioritize(self, state: WorkflowState) -> dict[str, Any]:
        snapshot = NormalizedSnapshot.model_validate(state["snapshot"])
        assessment = self.priority_engine.evaluate(snapshot)
        self.repository.transition(
            snapshot.case_id,
            CaseStatus.COLLECTING,
            CaseStatus.DRAFTING,
            "PRIORITY_ASSIGNED",
            ActorRole.RUNTIME,
            "priority-engine",
            assessment.model_dump(mode="json"),
            f"{state['run_id']}:priority",
            input_hash=stable_hash(snapshot),
            output_hash=stable_hash(assessment),
        )
        return {"assessment": assessment.model_dump(mode="json")}

    def _draft(self, state: WorkflowState) -> dict[str, Any]:
        snapshot = NormalizedSnapshot.model_validate(state["snapshot"])
        assessment = PriorityAssessment.model_validate(state["assessment"])
        diagnosis = list(state.get("diagnosis", []))
        try:
            packet = self.generator.generate(
                snapshot.case_id, snapshot, assessment, self.bundle
            )
            generator_mode = self.generator.name
        except Exception as exc:  # noqa: BLE001 - provider failures must enter the deterministic fallback
            packet = self.fallback.generate(
                snapshot.case_id, snapshot, assessment, self.bundle
            )
            generator_mode = "deterministic_fallback"
            diagnosis.append(
                f"Primary generator unavailable: {type(exc).__name__}: {exc}"
            )
        self.repository.transition(
            snapshot.case_id,
            CaseStatus.DRAFTING,
            CaseStatus.VALIDATING,
            "PACKET_DRAFTED",
            ActorRole.RUNTIME,
            "case-packet-agent",
            {"generator_mode": generator_mode, "diagnosis": diagnosis},
            f"{state['run_id']}:draft:{state.get('retry_attempt', 0)}",
            input_hash=stable_hash({"snapshot": snapshot, "assessment": assessment}),
            output_hash=stable_hash(packet),
        )
        return {
            "packet": packet.model_dump(mode="json"),
            "diagnosis": diagnosis,
            "generator_mode": generator_mode,
        }

    def _validate(self, state: WorkflowState) -> dict[str, Any]:
        snapshot = NormalizedSnapshot.model_validate(state["snapshot"])
        assessment = PriorityAssessment.model_validate(state["assessment"])
        packet = CasePacket.model_validate(state["packet"])
        attempt = state.get("retry_attempt", 0)
        report = self.validator.validate(packet, snapshot, assessment, attempt)
        self.repository.append_event(
            snapshot.case_id,
            "VALIDATION_COMPLETED",
            ActorRole.RUNTIME,
            "validator-suite",
            {
                "is_valid": report.is_valid,
                "retry_attempt": attempt,
                "findings": [
                    finding.model_dump(mode="json") for finding in report.findings
                ],
            },
            f"{state['run_id']}:validate:{attempt}",
            input_hash=stable_hash(packet),
            output_hash=stable_hash(report),
        )
        if (
            not report.is_valid
            and attempt < self.bundle.policy.max_repair_attempts
            and all(f.repairable for f in report.findings)
        ):
            self.repository.transition(
                snapshot.case_id,
                CaseStatus.VALIDATING,
                CaseStatus.DRAFTING,
                "TARGETED_REPAIR_REQUESTED",
                ActorRole.RUNTIME,
                "validator-suite",
                {
                    "fields": sorted({finding.field for finding in report.findings}),
                    "attempt": attempt + 1,
                },
                f"{state['run_id']}:repair-request:{attempt + 1}",
                output_hash=stable_hash(report.findings),
            )
        return {"validation": report.model_dump(mode="json")}

    def _repair(self, state: WorkflowState) -> dict[str, Any]:
        snapshot = NormalizedSnapshot.model_validate(state["snapshot"])
        assessment = PriorityAssessment.model_validate(state["assessment"])
        packet = CasePacket.model_validate(state["packet"])
        report = ValidationReport.model_validate(state["validation"])
        fields = {finding.field for finding in report.findings}
        patch = self.generator.repair(packet, fields, snapshot, assessment, self.bundle)
        repaired = merge_named_patch(packet, patch, fields)
        attempt = state.get("retry_attempt", 0) + 1
        self.repository.transition(
            snapshot.case_id,
            CaseStatus.DRAFTING,
            CaseStatus.VALIDATING,
            "TARGETED_REPAIR_APPLIED",
            ActorRole.RUNTIME,
            "case-packet-agent",
            {"fields": sorted(fields), "attempt": attempt},
            f"{state['run_id']}:repair-applied:{attempt}",
            input_hash=stable_hash(packet),
            output_hash=stable_hash(repaired),
        )
        return {"packet": repaired.model_dump(mode="json"), "retry_attempt": attempt}

    def _fallback(self, state: WorkflowState) -> dict[str, Any]:
        snapshot = NormalizedSnapshot.model_validate(state["snapshot"])
        assessment = PriorityAssessment.model_validate(state["assessment"])
        previous = ValidationReport.model_validate(state["validation"])
        packet = self.fallback.generate(
            snapshot.case_id, snapshot, assessment, self.bundle
        )
        report = self.validator.validate(
            packet, snapshot, assessment, state.get("retry_attempt", 0)
        )
        diagnosis = list(state.get("diagnosis", []))
        diagnosis.append(
            "Primary draft did not pass within the repair budget; deterministic fallback supplied. "
            + "; ".join(finding.code for finding in previous.findings)
        )
        self.repository.append_event(
            snapshot.case_id,
            "DETERMINISTIC_FALLBACK_USED",
            ActorRole.RUNTIME,
            "coordinator",
            {"diagnosis": diagnosis, "fallback_valid": report.is_valid},
            f"{state['run_id']}:fallback",
            input_hash=stable_hash(previous),
            output_hash=stable_hash(packet),
        )
        return {
            "packet": packet.model_dump(mode="json"),
            "validation": report.model_dump(mode="json"),
            "diagnosis": diagnosis,
            "generator_mode": "deterministic_fallback",
        }

    def _persist(self, state: WorkflowState) -> dict[str, Any]:
        snapshot = NormalizedSnapshot.model_validate(state["snapshot"])
        assessment = PriorityAssessment.model_validate(state["assessment"])
        packet = CasePacket.model_validate(state["packet"])
        report = ValidationReport.model_validate(state["validation"])
        artifact = self.repository.save_artifact(
            snapshot.case_id,
            snapshot.snapshot_id,
            assessment,
            packet,
            report,
            state.get("generator_mode", self.generator.name),
            state.get("diagnosis", []),
        )
        self.repository.transition(
            snapshot.case_id,
            CaseStatus.VALIDATING,
            CaseStatus.AWAITING_MENTOR,
            "MENTOR_REVIEW_REQUESTED",
            ActorRole.RUNTIME,
            "coordinator",
            {
                "artifact_version": artifact.version,
                "valid": report.is_valid,
                "diagnosis": artifact.diagnosis,
            },
            f"{state['run_id']}:mentor-request",
            input_hash=stable_hash(report),
            output_hash=stable_hash(artifact),
        )
        return {"artifact_version": artifact.version}

    def _mentor_interrupt(self, state: WorkflowState) -> dict[str, Any]:
        case = self.repository.get_case(state["case_id"])
        artifact = self.repository.get_artifact(case.case_id)
        decision = interrupt(
            {
                "case_id": case.case_id,
                "artifact_version": artifact.version,
                "priority": artifact.packet.priority.value,
                "validation_valid": artifact.validation.is_valid,
                "allowed_decisions": [item.value for item in DecisionType],
                "assigned_mentor": case.assigned_mentor,
            }
        )
        return {"mentor_decision": decision}

    def _close(self, state: WorkflowState) -> dict[str, Any]:
        decision = MentorDecision.model_validate(state["mentor_decision"])
        self.repository.close_with_decision(state["case_id"], decision)
        return {}

    @staticmethod
    def _config(thread_id: str) -> dict[str, Any]:
        return {"configurable": {"thread_id": thread_id}, "recursion_limit": 30}

    def process_case(self, case_id: str) -> Any:
        case = self.repository.get_case(case_id)
        if case.status not in {
            CaseStatus.CREATED,
            CaseStatus.DATA_BLOCKED,
            CaseStatus.COLLECTING,
        }:
            raise InvalidTransition(
                f"Case is already {case.status.value}; it cannot be rebuilt"
            )
        thread_id = f"{case_id}:{uuid.uuid4().hex}"
        run_id = f"RUN-{uuid.uuid4().hex[:12].upper()}"
        self.repository.set_active_thread(case_id, thread_id)
        return self.graph.invoke(
            {
                "operation": "build",
                "case_id": case_id,
                "run_id": run_id,
                "retry_attempt": 0,
                "diagnosis": [],
            },
            config=self._config(thread_id),
        )

    def decide(self, case_id: str, decision: MentorDecision) -> Any:
        case = self.repository.get_case(case_id)
        if case.status != CaseStatus.AWAITING_MENTOR or not case.active_thread_id:
            raise InvalidTransition("No durable mentor interrupt is active")
        if decision.mentor_id != case.assigned_mentor:
            raise PermissionError("Only the assigned mentor may decide this case")
        if decision.decision == DecisionType.EDIT_APPROVE:
            if decision.edited_packet is None:
                raise ValueError("edit_approve requires edited_packet")
            artifact = self.repository.get_artifact(case_id)
            snapshot = self.repository.get_snapshot(artifact.snapshot_id)
            report = self.validator.validate(
                decision.edited_packet, snapshot, artifact.assessment
            )
            if not report.is_valid:
                raise ValueError(
                    "Mentor edit failed validation: "
                    + "; ".join(f.message for f in report.findings)
                )
            edited = self.repository.save_artifact(
                case_id,
                artifact.snapshot_id,
                artifact.assessment,
                decision.edited_packet,
                report,
                "mentor_edit",
                [f"Edited by assigned mentor {decision.mentor_id}."],
            )
            self.repository.append_event(
                case_id,
                "MENTOR_PACKET_EDITED",
                ActorRole.MENTOR,
                decision.mentor_id,
                {"artifact_version": edited.version},
                f"mentor-edit:{decision.nonce}",
                input_hash=stable_hash(artifact.packet),
                output_hash=stable_hash(edited.packet),
            )
        return self.graph.invoke(
            Command(resume=decision.model_dump(mode="json")),
            config=self._config(case.active_thread_id),
        )

    def reopen(
        self,
        case_id: str,
        mentor_id: str,
        reason: str,
        action: str = "reopen",
        source_version: int | None = None,
    ) -> Any:
        case = self.repository.get_case(case_id)
        if case.status != CaseStatus.CLOSED:
            raise InvalidTransition("Only a closed case may be reopened or revoked")
        if case.assigned_mentor != mentor_id:
            raise PermissionError("Only the assigned mentor may reopen this case")
        source_version = source_version or case.latest_artifact_version
        cloned = self.repository.clone_artifact(case_id, source_version)
        event_type = {
            "revoke": "APPROVAL_REVOKED",
            "rollback": "ARTIFACT_ROLLED_BACK",
        }.get(action, "CASE_REOPENED")
        self.repository.transition(
            case_id,
            CaseStatus.CLOSED,
            CaseStatus.AWAITING_MENTOR,
            event_type,
            ActorRole.MENTOR,
            mentor_id,
            {
                "reason": reason,
                "source_version": source_version,
                "new_version": cloned.version,
            },
            f"{action}:{uuid.uuid4().hex}",
            input_hash=stable_hash({"version": source_version}),
            output_hash=stable_hash(cloned),
        )
        thread_id = f"{case_id}:review:{uuid.uuid4().hex}"
        run_id = f"REVIEW-{uuid.uuid4().hex[:12].upper()}"
        self.repository.set_active_thread(case_id, thread_id)
        return self.graph.invoke(
            {
                "operation": "review_existing",
                "case_id": case_id,
                "run_id": run_id,
                "artifact_version": cloned.version,
            },
            config=self._config(thread_id),
        )
