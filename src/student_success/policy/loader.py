from __future__ import annotations

from pathlib import Path

import yaml

from student_success.contracts.models import (
    DemoPolicy,
    InterventionCatalogue,
    PolicyBundle,
)


def _read_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle)
    if not isinstance(payload, dict):
        raise TypeError(f"Expected a mapping in {path}")
    return payload


def load_policy_bundle(policies_path: Path) -> PolicyBundle:
    policy = DemoPolicy.model_validate(
        _read_yaml(policies_path / "demo-policy-v1.yaml")
    )
    catalogue = InterventionCatalogue.model_validate(
        _read_yaml(policies_path / "intervention-catalogue-v1.yaml")
    )
    prohibited = _read_yaml(policies_path / "prohibited-actions-v1.yaml")
    return PolicyBundle(
        policy=policy,
        catalogue=catalogue,
        prohibited_phrases=prohibited.get("phrases", []),
        prohibited_categories=prohibited.get("categories", []),
    )
