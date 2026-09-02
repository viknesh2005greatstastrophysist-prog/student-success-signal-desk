from __future__ import annotations

from pathlib import Path

import pytest

from student_success.application import StudentSuccessApplication
from student_success.config import AppSettings

PROJECT_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def settings(tmp_path: Path) -> AppSettings:
    return AppSettings(
        project_root=PROJECT_ROOT,
        database_path=tmp_path / "student_success.sqlite",
        checkpoint_path=tmp_path / "checkpoints.sqlite",
        fixtures_path=PROJECT_ROOT / "fixtures" / "synthetic-cohort-v1",
        corrections_path=PROJECT_ROOT / "fixtures" / "synthetic-cohort-v1-corrections",
        policies_path=PROJECT_ROOT / "policies",
        artifacts_path=tmp_path / "artifacts",
        openai_model="test-model",
    )


@pytest.fixture
def app_factory(settings):
    def factory(generator=None):
        return StudentSuccessApplication(
            settings=settings, generator_mode="deterministic", generator=generator
        )

    return factory
