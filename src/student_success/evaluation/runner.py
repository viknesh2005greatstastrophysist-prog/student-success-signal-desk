from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

from student_success.config import AppSettings
from student_success.connectors import FixtureConnector, GovernedConnector
from student_success.contracts.models import EvaluationResult
from student_success.generation import DeterministicGenerator, OpenAIPacketGenerator
from student_success.policy import (
    PriorityEngine,
    load_policy_bundle,
    normalize_snapshot,
)
from student_success.validation import PacketValidator


class EvaluationRunner:
    """Frozen-input comparison. It never invents human-usability results."""

    def __init__(self, settings: AppSettings):
        self.settings = settings
        self.bundle = load_policy_bundle(settings.policies_path)
        self.connector = GovernedConnector(FixtureConnector(settings.fixtures_path))
        self.engine = PriorityEngine(self.bundle.policy)
        self.validator = PacketValidator(self.bundle)

    def _context(self, evaluation_id: str, student_ref: str):
        case_id = f"EVAL-{evaluation_id[-8:]}-{student_ref}"
        envelopes = self.connector.collect(case_id, student_ref, parallel=True)
        snapshot = normalize_snapshot(
            case_id, student_ref, envelopes, self.bundle.policy
        )
        assessment = self.engine.evaluate(snapshot)
        return case_id, snapshot, assessment

    def run(
        self, students: list[str] | None = None, allow_live_model: bool = False
    ) -> tuple[Path, list[EvaluationResult]]:
        students = students or ["SYN-0001", "SYN-0002", "SYN-0006"]
        evaluation_id = f"EVAL-{uuid.uuid4().hex[:12].upper()}"
        results: list[EvaluationResult] = []
        for student_ref in students:
            case_id, snapshot, assessment = self._context(evaluation_id, student_ref)
            if not snapshot.is_sufficient:
                continue

            deterministic = DeterministicGenerator()
            started = time.perf_counter()
            packet = deterministic.generate(case_id, snapshot, assessment, self.bundle)
            report = self.validator.validate(packet, snapshot, assessment)
            latency = (time.perf_counter() - started) * 1000
            results.append(
                EvaluationResult(
                    evaluation_id=evaluation_id,
                    variant="deterministic_baseline",
                    case_id=case_id,
                    student_ref=student_ref,
                    status="completed",
                    priority=assessment.priority,
                    valid=report.is_valid,
                    unsupported_claims=sum(
                        f.code
                        in {
                            "UNKNOWN_SOURCE_REF",
                            "UNKNOWN_REASON_CODE",
                            "MISALIGNED_SOURCE_REF",
                        }
                        for f in report.findings
                    ),
                    prohibited_actions=sum(
                        f.code == "PROHIBITED_ACTION" for f in report.findings
                    ),
                    retries=0,
                    latency_ms=latency,
                    generator_calls=deterministic.call_count,
                    note="Software validation only; no human usability claim.",
                )
            )

            if allow_live_model and OpenAIPacketGenerator.available():
                generator = OpenAIPacketGenerator(self.settings.openai_model)
                started = time.perf_counter()
                model_packet = generator.generate(
                    case_id, snapshot, assessment, self.bundle
                )
                model_report = self.validator.validate(
                    model_packet, snapshot, assessment
                )
                latency = (time.perf_counter() - started) * 1000
                results.append(
                    EvaluationResult(
                        evaluation_id=evaluation_id,
                        variant="isolated_llm",
                        case_id=case_id,
                        student_ref=student_ref,
                        status="completed",
                        priority=assessment.priority,
                        valid=model_report.is_valid,
                        unsupported_claims=sum(
                            f.code
                            in {
                                "UNKNOWN_SOURCE_REF",
                                "UNKNOWN_REASON_CODE",
                                "MISALIGNED_SOURCE_REF",
                            }
                            for f in model_report.findings
                        ),
                        prohibited_actions=sum(
                            f.code == "PROHIBITED_ACTION" for f in model_report.findings
                        ),
                        retries=0,
                        latency_ms=latency,
                        generator_calls=generator.call_count,
                        note="Same frozen evidence/schema; no repair and no human review.",
                    )
                )
                from student_success.application import StudentSuccessApplication

                governed_generator = OpenAIPacketGenerator(self.settings.openai_model)
                runtime_dir = (
                    self.settings.artifacts_path
                    / "evaluation"
                    / "runtime"
                    / evaluation_id
                    / student_ref
                )
                governed_settings = AppSettings(
                    project_root=self.settings.project_root,
                    database_path=runtime_dir / "governed.sqlite",
                    checkpoint_path=runtime_dir / "checkpoints.sqlite",
                    fixtures_path=self.settings.fixtures_path,
                    corrections_path=self.settings.corrections_path,
                    policies_path=self.settings.policies_path,
                    artifacts_path=runtime_dir / "artifacts",
                    openai_model=self.settings.openai_model,
                )
                governed = StudentSuccessApplication(
                    governed_settings, generator=governed_generator
                )
                started = time.perf_counter()
                governed_case = governed.create_and_process(student_ref)
                governed_artifact = governed.repository.get_artifact(
                    governed_case.case_id
                )
                latency = (time.perf_counter() - started) * 1000
                results.append(
                    EvaluationResult(
                        evaluation_id=evaluation_id,
                        variant="governed_agentic",
                        case_id=governed_case.case_id,
                        student_ref=student_ref,
                        status="completed_pre_review",
                        priority=governed_artifact.packet.priority,
                        valid=governed_artifact.validation.is_valid,
                        unsupported_claims=sum(
                            finding.code
                            in {
                                "UNKNOWN_SOURCE_REF",
                                "UNKNOWN_REASON_CODE",
                                "MISALIGNED_SOURCE_REF",
                            }
                            for finding in governed_artifact.validation.findings
                        ),
                        prohibited_actions=sum(
                            finding.code == "PROHIBITED_ACTION"
                            for finding in governed_artifact.validation.findings
                        ),
                        retries=governed_artifact.validation.retry_attempt,
                        latency_ms=latency,
                        generator_calls=governed_generator.call_count,
                        note="Governed runtime reached the durable mentor interrupt; human usability remains unmeasured.",
                    )
                )
            else:
                results.append(
                    EvaluationResult(
                        evaluation_id=evaluation_id,
                        variant="isolated_llm",
                        case_id=case_id,
                        student_ref=student_ref,
                        status="skipped",
                        priority=assessment.priority,
                        valid=None,
                        unsupported_claims=None,
                        prohibited_actions=None,
                        retries=0,
                        latency_ms=0,
                        generator_calls=0,
                        note="Not run: live-model execution requires --allow-live-model and OPENAI_API_KEY.",
                    )
                )
                results.append(
                    EvaluationResult(
                        evaluation_id=evaluation_id,
                        variant="governed_agentic",
                        case_id=case_id,
                        student_ref=student_ref,
                        status="skipped",
                        priority=assessment.priority,
                        valid=None,
                        unsupported_claims=None,
                        prohibited_actions=None,
                        retries=0,
                        latency_ms=0,
                        generator_calls=0,
                        note="Not run: promotion comparison requires the same live model and a human reviewer protocol.",
                    )
                )

        destination = (
            self.settings.artifacts_path / "evaluation" / f"{evaluation_id}.json"
        )
        destination.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "evaluation_id": evaluation_id,
            "policy_version": self.bundle.policy.policy_version,
            "dataset_version": "synthetic-cohort-v1",
            "controls": "same cases, evidence, policy, catalogue, schema; LLM requires explicit live-model flag",
            "claim_boundary": "software validation results only; mentor usability not measured",
            "results": [result.model_dump(mode="json") for result in results],
        }
        destination.write_text(
            json.dumps(payload, indent=2, default=str), encoding="utf-8"
        )
        return destination, results
