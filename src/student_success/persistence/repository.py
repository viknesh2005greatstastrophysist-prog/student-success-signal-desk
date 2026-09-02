from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from student_success.contracts.models import (
    ActorRole,
    AuditEvent,
    CaseArtifact,
    CasePacket,
    CaseRecord,
    CaseStatus,
    MentorDecision,
    NormalizedSnapshot,
    PriorityAssessment,
    SourceName,
    ValidationReport,
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _json(payload: Any) -> str:
    if hasattr(payload, "model_dump"):
        payload = payload.model_dump(mode="json")
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def stable_hash(payload: Any) -> str:
    return hashlib.sha256(_json(payload).encode()).hexdigest()


class InvalidTransition(RuntimeError):
    pass


class CaseRepository:
    """SQLite is the domain authority. LangGraph checkpoints are recovery state only."""

    def __init__(self, path: Path):
        self.path = path.resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")
        try:
            yield conn
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self.connection() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS cases (
                    case_id TEXT PRIMARY KEY,
                    student_ref TEXT NOT NULL,
                    assigned_mentor TEXT NOT NULL,
                    requested_by TEXT NOT NULL,
                    request_id TEXT NOT NULL UNIQUE,
                    status TEXT NOT NULL,
                    policy_version TEXT NOT NULL,
                    latest_snapshot_id TEXT,
                    latest_artifact_version INTEGER NOT NULL DEFAULT 0,
                    active_thread_id TEXT,
                    closed_reason TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL REFERENCES cases(case_id),
                    sequence INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    from_state TEXT,
                    to_state TEXT,
                    actor_role TEXT NOT NULL,
                    actor_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    input_hash TEXT,
                    output_hash TEXT,
                    idempotency_key TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(case_id, sequence),
                    UNIQUE(case_id, idempotency_key)
                );
                CREATE TABLE IF NOT EXISTS snapshots (
                    snapshot_id TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL REFERENCES cases(case_id),
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS artifacts (
                    case_id TEXT NOT NULL REFERENCES cases(case_id),
                    version INTEGER NOT NULL,
                    snapshot_id TEXT NOT NULL,
                    assessment_json TEXT NOT NULL,
                    packet_json TEXT NOT NULL,
                    validation_json TEXT NOT NULL,
                    generator_mode TEXT NOT NULL,
                    diagnosis_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(case_id, version)
                );
                CREATE TABLE IF NOT EXISTS decisions (
                    decision_id TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL REFERENCES cases(case_id),
                    artifact_version INTEGER NOT NULL,
                    decision_type TEXT NOT NULL,
                    mentor_id TEXT NOT NULL,
                    nonce TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(case_id, nonce)
                );
                CREATE TABLE IF NOT EXISTS source_overrides (
                    case_id TEXT NOT NULL REFERENCES cases(case_id),
                    source TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    applied_by TEXT NOT NULL,
                    applied_at TEXT NOT NULL,
                    PRIMARY KEY(case_id, source)
                );
                CREATE TABLE IF NOT EXISTS metrics (
                    metric_id TEXT PRIMARY KEY,
                    case_id TEXT,
                    name TEXT NOT NULL,
                    value REAL NOT NULL,
                    unit TEXT NOT NULL,
                    dimensions_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )

    @staticmethod
    def _case_from_row(row: sqlite3.Row) -> CaseRecord:
        return CaseRecord(
            case_id=row["case_id"],
            student_ref=row["student_ref"],
            assigned_mentor=row["assigned_mentor"],
            requested_by=row["requested_by"],
            request_id=row["request_id"],
            status=CaseStatus(row["status"]),
            policy_version=row["policy_version"],
            latest_snapshot_id=row["latest_snapshot_id"],
            latest_artifact_version=row["latest_artifact_version"],
            active_thread_id=row["active_thread_id"],
            closed_reason=row["closed_reason"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    def create_case(
        self,
        student_ref: str,
        assigned_mentor: str,
        requested_by: str,
        request_id: str,
        policy_version: str,
    ) -> CaseRecord:
        with self.connection() as conn:
            existing = conn.execute(
                "SELECT * FROM cases WHERE request_id=?", (request_id,)
            ).fetchone()
            if existing:
                return self._case_from_row(existing)
            now = _now()
            case_id = f"CASE-{uuid.uuid4().hex[:10].upper()}"
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                """INSERT INTO cases
                (case_id,student_ref,assigned_mentor,requested_by,request_id,status,policy_version,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    case_id,
                    student_ref,
                    assigned_mentor,
                    requested_by,
                    request_id,
                    CaseStatus.CREATED.value,
                    policy_version,
                    now,
                    now,
                ),
            )
            self._insert_event(
                conn,
                case_id,
                "CASE_CREATED",
                None,
                CaseStatus.CREATED,
                ActorRole.ADMIN,
                requested_by,
                {"student_ref": student_ref, "assigned_mentor": assigned_mentor},
                None,
                stable_hash({"case_id": case_id}),
                f"create:{request_id}",
            )
            conn.commit()
        return self.get_case(case_id)

    def get_case(self, case_id: str) -> CaseRecord:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT * FROM cases WHERE case_id=?", (case_id,)
            ).fetchone()
        if row is None:
            raise KeyError(f"Unknown case {case_id}")
        return self._case_from_row(row)

    def list_cases(self) -> list[CaseRecord]:
        with self.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM cases ORDER BY created_at DESC"
            ).fetchall()
        return [self._case_from_row(row) for row in rows]

    def set_active_thread(self, case_id: str, thread_id: str) -> None:
        with self.connection() as conn:
            conn.execute(
                "UPDATE cases SET active_thread_id=?, updated_at=? WHERE case_id=?",
                (thread_id, _now(), case_id),
            )
            conn.commit()

    def _insert_event(
        self,
        conn: sqlite3.Connection,
        case_id: str,
        event_type: str,
        from_state: CaseStatus | None,
        to_state: CaseStatus | None,
        actor_role: ActorRole,
        actor_id: str,
        payload: dict[str, Any],
        input_hash: str | None,
        output_hash: str | None,
        idempotency_key: str,
    ) -> str:
        sequence = conn.execute(
            "SELECT COALESCE(MAX(sequence),0)+1 FROM events WHERE case_id=?", (case_id,)
        ).fetchone()[0]
        event_id = f"EVT-{uuid.uuid4().hex.upper()}"
        conn.execute(
            """INSERT INTO events
            (event_id,case_id,sequence,event_type,from_state,to_state,actor_role,actor_id,payload_json,input_hash,output_hash,idempotency_key,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                event_id,
                case_id,
                sequence,
                event_type,
                from_state.value if from_state else None,
                to_state.value if to_state else None,
                actor_role.value,
                actor_id,
                _json(payload),
                input_hash,
                output_hash,
                idempotency_key,
                _now(),
            ),
        )
        return event_id

    def transition(
        self,
        case_id: str,
        expected: CaseStatus | Iterable[CaseStatus],
        target: CaseStatus,
        event_type: str,
        actor_role: ActorRole,
        actor_id: str,
        payload: dict[str, Any],
        idempotency_key: str,
        input_hash: str | None = None,
        output_hash: str | None = None,
    ) -> CaseRecord:
        allowed = {expected} if isinstance(expected, CaseStatus) else set(expected)
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            duplicate = conn.execute(
                "SELECT event_id FROM events WHERE case_id=? AND idempotency_key=?",
                (case_id, idempotency_key),
            ).fetchone()
            if duplicate:
                conn.rollback()
                return self.get_case(case_id)
            row = conn.execute(
                "SELECT * FROM cases WHERE case_id=?", (case_id,)
            ).fetchone()
            if row is None:
                conn.rollback()
                raise KeyError(f"Unknown case {case_id}")
            current = CaseStatus(row["status"])
            if current not in allowed:
                conn.rollback()
                raise InvalidTransition(
                    f"{current.value} cannot transition to {target.value}"
                )
            self._insert_event(
                conn,
                case_id,
                event_type,
                current,
                target,
                actor_role,
                actor_id,
                payload,
                input_hash,
                output_hash,
                idempotency_key,
            )
            conn.execute(
                "UPDATE cases SET status=?, updated_at=?, closed_reason=NULL WHERE case_id=?",
                (target.value, _now(), case_id),
            )
            conn.commit()
        return self.get_case(case_id)

    def append_event(
        self,
        case_id: str,
        event_type: str,
        actor_role: ActorRole,
        actor_id: str,
        payload: dict[str, Any],
        idempotency_key: str,
        input_hash: str | None = None,
        output_hash: str | None = None,
    ) -> None:
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute(
                "SELECT 1 FROM events WHERE case_id=? AND idempotency_key=?",
                (case_id, idempotency_key),
            ).fetchone():
                conn.rollback()
                return
            status = CaseStatus(
                conn.execute(
                    "SELECT status FROM cases WHERE case_id=?", (case_id,)
                ).fetchone()[0]
            )
            self._insert_event(
                conn,
                case_id,
                event_type,
                status,
                status,
                actor_role,
                actor_id,
                payload,
                input_hash,
                output_hash,
                idempotency_key,
            )
            conn.commit()

    def save_snapshot(self, snapshot: NormalizedSnapshot) -> None:
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "INSERT OR IGNORE INTO snapshots(snapshot_id,case_id,payload_json,created_at) VALUES (?,?,?,?)",
                (snapshot.snapshot_id, snapshot.case_id, _json(snapshot), _now()),
            )
            conn.execute(
                "UPDATE cases SET latest_snapshot_id=?, updated_at=? WHERE case_id=?",
                (snapshot.snapshot_id, _now(), snapshot.case_id),
            )
            conn.commit()

    def get_snapshot(self, snapshot_id: str) -> NormalizedSnapshot:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT payload_json FROM snapshots WHERE snapshot_id=?", (snapshot_id,)
            ).fetchone()
        if row is None:
            raise KeyError(f"Unknown snapshot {snapshot_id}")
        return NormalizedSnapshot.model_validate_json(row[0])

    def save_artifact(
        self,
        case_id: str,
        snapshot_id: str,
        assessment: PriorityAssessment,
        packet: CasePacket,
        validation: ValidationReport,
        generator_mode: str,
        diagnosis: list[str] | None = None,
    ) -> CaseArtifact:
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            version = conn.execute(
                "SELECT COALESCE(MAX(version),0)+1 FROM artifacts WHERE case_id=?",
                (case_id,),
            ).fetchone()[0]
            created_at = _now()
            conn.execute(
                """INSERT INTO artifacts
                (case_id,version,snapshot_id,assessment_json,packet_json,validation_json,generator_mode,diagnosis_json,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    case_id,
                    version,
                    snapshot_id,
                    _json(assessment),
                    _json(packet),
                    _json(validation),
                    generator_mode,
                    _json(diagnosis or []),
                    created_at,
                ),
            )
            conn.execute(
                "UPDATE cases SET latest_artifact_version=?, updated_at=? WHERE case_id=?",
                (version, _now(), case_id),
            )
            conn.commit()
        return self.get_artifact(case_id, version)

    def get_artifact(self, case_id: str, version: int | None = None) -> CaseArtifact:
        with self.connection() as conn:
            if version is None:
                row = conn.execute(
                    "SELECT * FROM artifacts WHERE case_id=? ORDER BY version DESC LIMIT 1",
                    (case_id,),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM artifacts WHERE case_id=? AND version=?",
                    (case_id, version),
                ).fetchone()
        if row is None:
            raise KeyError(f"No artifact for {case_id}")
        return CaseArtifact(
            case_id=row["case_id"],
            version=row["version"],
            snapshot_id=row["snapshot_id"],
            assessment=PriorityAssessment.model_validate_json(row["assessment_json"]),
            packet=CasePacket.model_validate_json(row["packet_json"]),
            validation=ValidationReport.model_validate_json(row["validation_json"]),
            generator_mode=row["generator_mode"],
            diagnosis=json.loads(row["diagnosis_json"]),
            created_at=datetime.fromisoformat(row["created_at"]),
        )

    def list_artifacts(self, case_id: str) -> list[CaseArtifact]:
        with self.connection() as conn:
            versions = [
                row[0]
                for row in conn.execute(
                    "SELECT version FROM artifacts WHERE case_id=? ORDER BY version",
                    (case_id,),
                ).fetchall()
            ]
        return [self.get_artifact(case_id, version) for version in versions]

    def close_with_decision(self, case_id: str, decision: MentorDecision) -> CaseRecord:
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            duplicate = conn.execute(
                "SELECT 1 FROM decisions WHERE case_id=? AND nonce=?",
                (case_id, decision.nonce),
            ).fetchone()
            if duplicate:
                conn.rollback()
                return self.get_case(case_id)
            row = conn.execute(
                "SELECT * FROM cases WHERE case_id=?", (case_id,)
            ).fetchone()
            if row is None:
                conn.rollback()
                raise KeyError(f"Unknown case {case_id}")
            if CaseStatus(row["status"]) != CaseStatus.AWAITING_MENTOR:
                conn.rollback()
                raise InvalidTransition("A mentor decision requires AWAITING_MENTOR")
            if row["assigned_mentor"] != decision.mentor_id:
                conn.rollback()
                raise PermissionError("Only the assigned mentor may decide this case")
            version = row["latest_artifact_version"]
            decision_id = f"DEC-{uuid.uuid4().hex.upper()}"
            payload = decision.model_dump(mode="json")
            conn.execute(
                """INSERT INTO decisions
                (decision_id,case_id,artifact_version,decision_type,mentor_id,nonce,reason,payload_json,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    decision_id,
                    case_id,
                    version,
                    decision.decision.value,
                    decision.mentor_id,
                    decision.nonce,
                    decision.reason,
                    _json(payload),
                    _now(),
                ),
            )
            self._insert_event(
                conn,
                case_id,
                "MENTOR_DECISION",
                CaseStatus.AWAITING_MENTOR,
                CaseStatus.CLOSED,
                ActorRole.MENTOR,
                decision.mentor_id,
                {
                    "decision": decision.decision.value,
                    "reason": decision.reason,
                    "artifact_version": version,
                },
                stable_hash({"case_id": case_id, "version": version}),
                stable_hash(payload),
                f"decision:{decision.nonce}",
            )
            conn.execute(
                "UPDATE cases SET status=?, closed_reason=?, updated_at=? WHERE case_id=?",
                (CaseStatus.CLOSED.value, decision.decision.value, _now(), case_id),
            )
            conn.commit()
        return self.get_case(case_id)

    def list_decisions(self, case_id: str) -> list[dict[str, Any]]:
        with self.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM decisions WHERE case_id=? ORDER BY created_at",
                (case_id,),
            ).fetchall()
        return [
            dict(row) | {"payload": json.loads(row["payload_json"])} for row in rows
        ]

    def apply_source_override(
        self, case_id: str, source: SourceName, payload: dict, applied_by: str
    ) -> None:
        case = self.get_case(case_id)
        if case.status != CaseStatus.DATA_BLOCKED:
            raise InvalidTransition(
                "Source correction is allowed only for DATA_BLOCKED cases"
            )
        with self.connection() as conn:
            conn.execute(
                """INSERT INTO source_overrides(case_id,source,payload_json,applied_by,applied_at)
                VALUES (?,?,?,?,?) ON CONFLICT(case_id,source) DO UPDATE SET payload_json=excluded.payload_json,applied_by=excluded.applied_by,applied_at=excluded.applied_at""",
                (case_id, source.value, _json(payload), applied_by, _now()),
            )
            conn.commit()
        self.append_event(
            case_id,
            "SOURCE_CORRECTION_APPLIED",
            ActorRole.ADMIN,
            applied_by,
            {"source": source.value, "payload_hash": stable_hash(payload)},
            f"override:{source.value}:{stable_hash(payload)[:12]}",
        )

    def get_source_override(self, case_id: str, source: SourceName) -> dict | None:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT payload_json FROM source_overrides WHERE case_id=? AND source=?",
                (case_id, source.value),
            ).fetchone()
        return json.loads(row[0]) if row else None

    def clone_artifact(self, case_id: str, source_version: int) -> CaseArtifact:
        artifact = self.get_artifact(case_id, source_version)
        return self.save_artifact(
            case_id,
            artifact.snapshot_id,
            artifact.assessment,
            artifact.packet,
            artifact.validation,
            f"rollback:{source_version}",
            [f"Cloned from artifact v{source_version} for renewed mentor review."],
        )

    def list_events(self, case_id: str) -> list[AuditEvent]:
        with self.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM events WHERE case_id=? ORDER BY sequence", (case_id,)
            ).fetchall()
        return [
            AuditEvent(
                event_id=row["event_id"],
                case_id=row["case_id"],
                sequence=row["sequence"],
                event_type=row["event_type"],
                from_state=CaseStatus(row["from_state"]) if row["from_state"] else None,
                to_state=CaseStatus(row["to_state"]) if row["to_state"] else None,
                actor_role=ActorRole(row["actor_role"]),
                actor_id=row["actor_id"],
                payload=json.loads(row["payload_json"]),
                input_hash=row["input_hash"],
                output_hash=row["output_hash"],
                idempotency_key=row["idempotency_key"],
                created_at=datetime.fromisoformat(row["created_at"]),
            )
            for row in rows
        ]

    def record_metric(
        self,
        case_id: str | None,
        name: str,
        value: float,
        unit: str,
        dimensions: dict[str, Any] | None = None,
    ) -> None:
        with self.connection() as conn:
            conn.execute(
                "INSERT INTO metrics VALUES (?,?,?,?,?,?,?)",
                (
                    f"MET-{uuid.uuid4().hex.upper()}",
                    case_id,
                    name,
                    value,
                    unit,
                    _json(dimensions or {}),
                    _now(),
                ),
            )
            conn.commit()

    def export_case(self, case_id: str) -> dict[str, Any]:
        case = self.get_case(case_id)
        payload: dict[str, Any] = {
            "case": case.model_dump(mode="json"),
            "events": [
                event.model_dump(mode="json") for event in self.list_events(case_id)
            ],
            "artifacts": [
                artifact.model_dump(mode="json")
                for artifact in self.list_artifacts(case_id)
            ],
            "decisions": self.list_decisions(case_id),
        }
        if case.latest_snapshot_id:
            payload["latest_snapshot"] = self.get_snapshot(
                case.latest_snapshot_id
            ).model_dump(mode="json")
        payload["export_hash"] = stable_hash(payload)
        return payload
