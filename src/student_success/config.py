from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AppSettings:
    project_root: Path
    database_path: Path
    checkpoint_path: Path
    fixtures_path: Path
    corrections_path: Path
    policies_path: Path
    artifacts_path: Path
    openai_model: str

    @classmethod
    def from_env(cls, project_root: Path | None = None) -> AppSettings:
        root = (project_root or Path(__file__).resolve().parents[2]).resolve()
        runtime = root / "runtime"
        runtime.mkdir(parents=True, exist_ok=True)
        return cls(
            project_root=root,
            database_path=Path(
                os.getenv("STUDENT_SUCCESS_DB", runtime / "student_success.sqlite")
            ),
            checkpoint_path=Path(
                os.getenv(
                    "STUDENT_SUCCESS_CHECKPOINT_DB", runtime / "checkpoints.sqlite"
                )
            ),
            fixtures_path=root / "fixtures" / "synthetic-cohort-v1",
            corrections_path=root / "fixtures" / "synthetic-cohort-v1-corrections",
            policies_path=root / "policies",
            artifacts_path=root / "artifacts",
            openai_model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
        )
