from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from student_success.config import AppSettings
from student_success.connectors import FixtureConnector, GovernedConnector
from student_success.contracts.models import CaseRequest, SourceName
from student_success.generation import DeterministicGenerator, OpenAIPacketGenerator
from student_success.graph import CaseWorkflow
from student_success.persistence import CaseRepository
from student_success.policy import load_policy_bundle


class StudentSuccessApplication:
    def __init__(
        self,
        settings: AppSettings | None = None,
        generator_mode: str = "auto",
        generator: Any | None = None,
    ):
        self.settings = settings or AppSettings.from_env()
        self.repository = CaseRepository(self.settings.database_path)
        self.bundle = load_policy_bundle(self.settings.policies_path)
        if generator is None:
            if generator_mode == "openai" or (
                generator_mode == "auto" and OpenAIPacketGenerator.available()
            ):
                generator = OpenAIPacketGenerator(self.settings.openai_model)
            else:
                generator = DeterministicGenerator()
        self.generator = generator
        connector = GovernedConnector(
            FixtureConnector(self.settings.fixtures_path),
            override_resolver=self.repository.get_source_override,
        )
        self.workflow = CaseWorkflow(
            self.repository,
            connector,
            self.bundle,
            generator,
            str(self.settings.checkpoint_path),
        )

    def create_case(
        self,
        student_ref: str,
        assigned_mentor: str = "mentor-01",
        requested_by: str = "demo-admin",
        request_id: str | None = None,
    ):
        request = CaseRequest(
            student_ref=student_ref,
            assigned_mentor=assigned_mentor,
            requested_by=requested_by,
            request_id=request_id or f"REQ-{uuid.uuid4().hex.upper()}",
            policy_version=self.bundle.policy.policy_version,
        )
        return self.repository.create_case(
            request.student_ref,
            request.assigned_mentor,
            request.requested_by,
            request.request_id,
            request.policy_version,
        )

    def create_and_process(self, student_ref: str, assigned_mentor: str = "mentor-01"):
        case = self.create_case(student_ref, assigned_mentor)
        self.workflow.process_case(case.case_id)
        return self.repository.get_case(case.case_id)

    def apply_bundled_correction(
        self, case_id: str, applied_by: str = "demo-admin"
    ) -> list[str]:
        case = self.repository.get_case(case_id)
        student_dir = self.settings.corrections_path / case.student_ref
        if not student_dir.exists():
            raise FileNotFoundError(f"No bundled correction for {case.student_ref}")
        applied: list[str] = []
        for path in sorted(student_dir.glob("*.json")):
            source = SourceName(path.stem)
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            self.repository.apply_source_override(case_id, source, payload, applied_by)
            applied.append(source.value)
        return applied

    def export_case_to_file(self, case_id: str) -> Path:
        payload = self.repository.export_case(case_id)
        destination = self.settings.artifacts_path / "traces" / f"{case_id}.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            json.dumps(payload, indent=2, default=str), encoding="utf-8"
        )
        return destination
