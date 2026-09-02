from __future__ import annotations

import json
import os
from typing import Any

from student_success.contracts.models import (
    CasePacket,
    NormalizedSnapshot,
    PolicyBundle,
    PriorityAssessment,
)

SYSTEM_INSTRUCTIONS = """You are the bounded Case Packet Agent for a fictional student-support demonstration.
Use only the supplied snapshot, deterministic assessment, and intervention catalogue.
Do not rescore, diagnose, compare students, contact anyone, mutate records, or invent an intervention.
Every evidence claim must use one supplied reason_code and its exact source_refs.
Make uncertainty explicit. Mentor judgement is mandatory. Return the requested schema only."""


class OpenAIPacketGenerator:
    name = "openai"

    def __init__(self, model: str, client: Any | None = None):
        if client is None:
            if not os.getenv("OPENAI_API_KEY"):
                raise RuntimeError("OPENAI_API_KEY is not set")
            from openai import OpenAI

            client = OpenAI()
        self.client = client
        self.model = model
        self.call_count = 0

    @staticmethod
    def available() -> bool:
        return bool(os.getenv("OPENAI_API_KEY"))

    @staticmethod
    def _context(
        case_id: str,
        snapshot: NormalizedSnapshot,
        assessment: PriorityAssessment,
        bundle: PolicyBundle,
    ) -> dict[str, Any]:
        return {
            "case_id": case_id,
            "snapshot": snapshot.model_dump(mode="json"),
            "deterministic_assessment": assessment.model_dump(mode="json"),
            "catalogue": bundle.catalogue.model_dump(mode="json"),
            "prohibited_phrases": bundle.prohibited_phrases,
        }

    def generate(
        self,
        case_id: str,
        snapshot: NormalizedSnapshot,
        assessment: PriorityAssessment,
        bundle: PolicyBundle,
    ) -> CasePacket:
        self.call_count += 1
        response = self.client.responses.parse(
            model=self.model,
            input=[
                {"role": "system", "content": SYSTEM_INSTRUCTIONS},
                {
                    "role": "user",
                    "content": json.dumps(
                        self._context(case_id, snapshot, assessment, bundle),
                        default=str,
                    ),
                },
            ],
            text_format=CasePacket,
        )
        packet = response.output_parsed
        if packet is None:
            raise RuntimeError("Model returned no parsed case packet")
        payload = packet.model_dump(mode="json")
        payload["generated_by"] = "openai"
        payload["generation_note"] = (
            f"Schema-constrained composition by {self.model}; deterministic validation still required."
        )
        return CasePacket.model_validate(payload)

    def repair(
        self,
        packet: CasePacket,
        failing_fields: set[str],
        snapshot: NormalizedSnapshot,
        assessment: PriorityAssessment,
        bundle: PolicyBundle,
    ) -> dict[str, Any]:
        clean = self.generate(packet.case_id, snapshot, assessment, bundle)
        payload = clean.model_dump(mode="json")
        return {field: payload[field] for field in failing_fields if field in payload}
