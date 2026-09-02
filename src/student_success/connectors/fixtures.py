from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from student_success.contracts.models import SourceEnvelope, SourceName

STUDENT_REF_PATTERN = re.compile(r"^SYN-\d{4}$")
ALL_SOURCES = tuple(SourceName)


class FixtureConnector:
    """The only reader for source fixtures; path and envelope scope are enforced."""

    def __init__(self, fixtures_path: Path, artificial_delay: float = 0.0):
        self.fixtures_path = fixtures_path.resolve()
        self.artificial_delay = artificial_delay

    def read(
        self,
        student_ref: str,
        source: SourceName,
        override: dict | None = None,
    ) -> SourceEnvelope:
        if not STUDENT_REF_PATTERN.fullmatch(student_ref):
            raise PermissionError(
                "Only scoped synthetic student references are allowed"
            )
        if self.artificial_delay:
            time.sleep(self.artificial_delay)
        if override is None:
            path = (self.fixtures_path / student_ref / f"{source.value}.json").resolve()
            if self.fixtures_path not in path.parents:
                raise PermissionError("Fixture path escaped the authorised root")
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        else:
            payload = override
        envelope = SourceEnvelope.model_validate(payload)
        if envelope.student_ref != student_ref or envelope.source != source:
            raise ValueError("Source envelope does not match the authorised request")
        return envelope


class GovernedConnector:
    """Exposes all and only the four authorised signal groups."""

    def __init__(
        self,
        connector: FixtureConnector,
        override_resolver: Callable[[str, SourceName], dict | None] | None = None,
    ):
        self.connector = connector
        self.override_resolver = override_resolver or (lambda _case_id, _source: None)

    def _one(
        self, case_id: str, student_ref: str, source: SourceName
    ) -> SourceEnvelope:
        return self.connector.read(
            student_ref,
            source,
            override=self.override_resolver(case_id, source),
        )

    def collect(
        self, case_id: str, student_ref: str, parallel: bool = True
    ) -> dict[SourceName, SourceEnvelope]:
        if not parallel:
            return {
                source: self._one(case_id, student_ref, source)
                for source in ALL_SOURCES
            }
        with ThreadPoolExecutor(
            max_workers=4, thread_name_prefix="source-collector"
        ) as pool:
            futures = {
                source: pool.submit(self._one, case_id, student_ref, source)
                for source in ALL_SOURCES
            }
            return {source: future.result() for source, future in futures.items()}
