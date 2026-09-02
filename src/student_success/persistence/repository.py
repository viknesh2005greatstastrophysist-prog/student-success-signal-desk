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
    CohortRunRecord,
    CohortRunStatus,
    DecisionType,
    InterventionRecord,
    InterventionStatus,
    MentorDecision,
    NormalizedSnapshot,
    PriorityAssessment,
    SourceName,
    ValidationReport,
    allowed_intervention_statuses,
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
                CREATE TABLE IF NOT EXISTS interventions (
                    intervention_id TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL REFERENCES cases(case_id),
                    artifact_version INTEGER NOT NULL,
                    catalogue_id TEXT NOT NULL,
                    rationale TEXT NOT NULL,
                    status TEXT NOT NULL,
                    owner_id TEXT NOT NULL,
                    due_at TEXT,
                    outcome TEXT,
                    latest_note TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(case_id, catalogue_id)
                );
                CREATE INDEX IF NOT EXISTS idx_interventions_owner
                    ON interventions(owner_id, status);
                CREATE INDEX IF NOT EXISTS idx_cases_student
                    ON cases(student_ref, created_at);
                CREATE TABLE IF NOT EXISTS cohort_runs (
                    run_id TEXT PRIMARY KEY,
                    cohort_id TEXT NOT NULL,
                    requested_by TEXT NOT NULL,
                    status TEXT NOT NULL,
                    total_cases INTEGER NOT NULL,
                    completed_cases INTEGER NOT NULL DEFAULT 0,
                    blocked_cases INTEGER NOT NULL DEFAULT 0,
                    failure_reason TEXT,
                    started_at TEXT NOT NULL,
                    completed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS cohort_run_cases (
                    run_id TEXT NOT NULL REFERENCES cohort_runs(run_id),
                    case_id TEXT NOT NULL REFERENCES cases(case_id),
                    PRIMARY KEY(run_id, case_id)
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

    @staticmethod
    def _cohort_run_from_row(row: sqlite3.Row) -> CohortRunRecord:
        return CohortRunRecord(
            run_id=row["run_id"],
            cohort_id=row["cohort_id"],
            requested_by=row["requested_by"],
            status=CohortRunStatus(row["status"]),
            total_cases=row["total_cases"],
            completed_cases=row["completed_cases"],
            blocked_cases=row["blocked_cases"],
            failure_reason=row["failure_reason"],
            started_at=datetime.fromisoformat(row["started_at"]),
            completed_at=(
                datetime.fromisoformat(row["completed_at"])
                if row["completed_at"]
                else None
            ),
        )

    def start_cohort_run(
        self,
        cohort_id: str,
        requested_by: str,
        total_cases: int,
        *,
        run_id: str | None = None,
    ) -> CohortRunRecord:
        if total_cases < 1:
            raise ValueError("A cohort run requires at least one case")
        run_id = run_id or f"COHORT-{uuid.uuid4().hex[:12].upper()}"
        with self.connection() as conn:
            conn.execute(
                """INSERT INTO cohort_runs
                (run_id,cohort_id,requested_by,status,total_cases,started_at)
                VALUES (?,?,?,?,?,?)""",
                (
                    run_id,
                    cohort_id,
                    requested_by,
                    CohortRunStatus.RUNNING.value,
                    total_cases,
                    _now(),
                ),
            )
            conn.commit()
        return self.get_cohort_run(run_id)

    def attach_case_to_cohort_run(self, run_id: str, case_id: str) -> None:
        with self.connection() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO cohort_run_cases(run_id,case_id) VALUES (?,?)",
                (run_id, case_id),
            )
            conn.commit()

    def get_cohort_run(self, run_id: str) -> CohortRunRecord:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT * FROM cohort_runs WHERE run_id=?", (run_id,)
            ).fetchone()
        if row is None:
            raise KeyError(f"Unknown cohort run {run_id}")
        return self._cohort_run_from_row(row)

    def complete_cohort_run(self, run_id: str) -> CohortRunRecord:
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            run = conn.execute(
                "SELECT * FROM cohort_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            if run is None:
                conn.rollback()
                raise KeyError(f"Unknown cohort run {run_id}")
            rows = conn.execute(
                """SELECT c.status FROM cases c
                JOIN cohort_run_cases crc ON crc.case_id=c.case_id
                WHERE crc.run_id=?""",
                (run_id,),
            ).fetchall()
            blocked = sum(
                row["status"] == CaseStatus.DATA_BLOCKED.value for row in rows
            )
            completed = sum(
                row["status"]
                in {
                    CaseStatus.DATA_BLOCKED.value,
                    CaseStatus.AWAITING_MENTOR.value,
                    CaseStatus.CLOSED.value,
                }
                for row in rows
            )
            status = (
                CohortRunStatus.COMPLETED_WITH_BLOCKS
                if blocked
                else CohortRunStatus.COMPLETED
            )
            conn.execute(
                """UPDATE cohort_runs SET status=?,completed_cases=?,blocked_cases=?,completed_at=?
                WHERE run_id=?""",
                (status.value, completed, blocked, _now(), run_id),
            )
            conn.commit()
        return self.get_cohort_run(run_id)

    def fail_cohort_run(self, run_id: str, reason: str) -> CohortRunRecord:
        if not reason.strip():
            raise ValueError("Failure reason cannot be blank")
        with self.connection() as conn:
            conn.execute(
                """UPDATE cohort_runs SET status=?,failure_reason=?,completed_at=?
                WHERE run_id=?""",
                (CohortRunStatus.FAILED.value, reason, _now(), run_id),
            )
            if conn.total_changes == 0:
                raise KeyError(f"Unknown cohort run {run_id}")
            conn.commit()
        return self.get_cohort_run(run_id)

    def list_cohort_runs(self) -> list[CohortRunRecord]:
        with self.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM cohort_runs ORDER BY started_at DESC"
            ).fetchall()
        return [self._cohort_run_from_row(row) for row in rows]

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
            artifact_row = conn.execute(
                "SELECT packet_json FROM artifacts WHERE case_id=? AND version=?",
                (case_id, version),
            ).fetchone()
            if artifact_row is None:
                conn.rollback()
                raise KeyError(f"No artifact v{version} for {case_id}")
            packet = CasePacket.model_validate_json(artifact_row["packet_json"])
            creates_interventions = decision.decision in {
                DecisionType.APPROVE,
                DecisionType.EDIT_APPROVE,
            }
            support_items = (
                [
                    item
                    for item in packet.proposed_support
                    if item.catalogue_id != "SUP-07"
                ]
                if creates_interventions
                else []
            )
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
                    "interventions_created": len(support_items),
                },
                stable_hash({"case_id": case_id, "version": version}),
                stable_hash(payload),
                f"decision:{decision.nonce}",
            )
            conn.execute(
                "UPDATE cases SET status=?, closed_reason=?, updated_at=? WHERE case_id=?",
                (CaseStatus.CLOSED.value, decision.decision.value, _now(), case_id),
            )
            for item in support_items:
                now = _now()
                conn.execute(
                    """INSERT OR IGNORE INTO interventions
                    (intervention_id,case_id,artifact_version,catalogue_id,rationale,status,owner_id,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?)""",
                    (
                        f"INT-{uuid.uuid4().hex[:12].upper()}",
                        case_id,
                        version,
                        item.catalogue_id,
                        item.rationale,
                        InterventionStatus.PLANNED.value,
                        decision.mentor_id,
                        now,
                        now,
                    ),
                )
            conn.commit()
        return self.get_case(case_id)

    @staticmethod
    def _intervention_from_row(row: sqlite3.Row) -> InterventionRecord:
        return InterventionRecord(
            intervention_id=row["intervention_id"],
            case_id=row["case_id"],
            artifact_version=row["artifact_version"],
            catalogue_id=row["catalogue_id"],
            rationale=row["rationale"],
            status=InterventionStatus(row["status"]),
            owner_id=row["owner_id"],
            due_at=datetime.fromisoformat(row["due_at"]) if row["due_at"] else None,
            outcome=row["outcome"],
            latest_note=row["latest_note"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    def get_intervention(self, intervention_id: str) -> InterventionRecord:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT * FROM interventions WHERE intervention_id=?",
                (intervention_id,),
            ).fetchone()
        if row is None:
            raise KeyError(f"Unknown intervention {intervention_id}")
        return self._intervention_from_row(row)

    def list_interventions(
        self,
        *,
        case_id: str | None = None,
        owner_id: str | None = None,
        student_ref: str | None = None,
    ) -> list[InterventionRecord]:
        clauses: list[str] = []
        values: list[str] = []
        if case_id:
            clauses.append("i.case_id=?")
            values.append(case_id)
        if owner_id:
            clauses.append("i.owner_id=?")
            values.append(owner_id)
        if student_ref:
            clauses.append("c.student_ref=?")
            values.append(student_ref)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connection() as conn:
            rows = conn.execute(
                f"""SELECT i.* FROM interventions i
                JOIN cases c ON c.case_id=i.case_id
                {where} ORDER BY i.updated_at DESC""",
                values,
            ).fetchall()
        return [self._intervention_from_row(row) for row in rows]

    def reconcile_approved_interventions(self) -> int:
        """Backfill the intervention ledger for databases created before it existed."""
        inserted = 0
        touched: set[str] = set()
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute(
                """SELECT d.case_id,d.artifact_version,d.mentor_id,a.packet_json
                FROM decisions d
                JOIN artifacts a ON a.case_id=d.case_id
                    AND a.version=d.artifact_version
                WHERE d.decision_type IN (?,?)
                ORDER BY d.created_at""",
                (DecisionType.APPROVE.value, DecisionType.EDIT_APPROVE.value),
            ).fetchall()
            for row in rows:
                packet = CasePacket.model_validate_json(row["packet_json"])
                for item in packet.proposed_support:
                    if item.catalogue_id == "SUP-07":
                        continue
                    now = _now()
                    result = conn.execute(
                        """INSERT OR IGNORE INTO interventions
                        (intervention_id,case_id,artifact_version,catalogue_id,rationale,status,owner_id,created_at,updated_at)
                        VALUES (?,?,?,?,?,?,?,?,?)""",
                        (
                            f"INT-{uuid.uuid4().hex[:12].upper()}",
                            row["case_id"],
                            row["artifact_version"],
                            item.catalogue_id,
                            item.rationale,
                            InterventionStatus.PLANNED.value,
                            row["mentor_id"],
                            now,
                            now,
                        ),
                    )
                    if result.rowcount:
                        inserted += 1
                        touched.add(row["case_id"])
            for case_id in touched:
                if conn.execute(
                    "SELECT 1 FROM events WHERE case_id=? AND idempotency_key=?",
                    (case_id, "ecosystem:intervention-reconcile:v1"),
                ).fetchone():
                    continue
                status = CaseStatus(
                    conn.execute(
                        "SELECT status FROM cases WHERE case_id=?", (case_id,)
                    ).fetchone()[0]
                )
                self._insert_event(
                    conn,
                    case_id,
                    "INTERVENTION_LEDGER_RECONCILED",
                    status,
                    status,
                    ActorRole.ADMIN,
                    "ecosystem-migration",
                    {"reason": "Backfilled approved support into intervention ledger"},
                    None,
                    None,
                    "ecosystem:intervention-reconcile:v1",
                )
            conn.commit()
        return inserted

    def update_intervention(
        self,
        intervention_id: str,
        owner_id: str,
        status: InterventionStatus,
        *,
        note: str | None = None,
        outcome: str | None = None,
        due_at: datetime | None = None,
    ) -> InterventionRecord:
        if note is not None and not note.strip():
            raise ValueError("Intervention note cannot be blank")
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM interventions WHERE intervention_id=?",
                (intervention_id,),
            ).fetchone()
            if row is None:
                conn.rollback()
                raise KeyError(f"Unknown intervention {intervention_id}")
            if row["owner_id"] != owner_id:
                conn.rollback()
                raise PermissionError(
                    "Only the assigned intervention owner may update it"
                )
            previous = InterventionStatus(row["status"])
            if status not in allowed_intervention_statuses(previous):
                conn.rollback()
                raise InvalidTransition(
                    f"Intervention {previous.value} cannot transition to {status.value}"
                )
            now = _now()
            conn.execute(
                """UPDATE interventions
                SET status=?, due_at=?, outcome=?, latest_note=?, updated_at=?
                WHERE intervention_id=?""",
                (
                    status.value,
                    due_at.isoformat() if due_at else row["due_at"],
                    outcome if outcome is not None else row["outcome"],
                    note if note is not None else row["latest_note"],
                    now,
                    intervention_id,
                ),
            )
            self._insert_event(
                conn,
                row["case_id"],
                "INTERVENTION_STATUS_UPDATED",
                CaseStatus.CLOSED,
                CaseStatus.CLOSED,
                ActorRole.MENTOR,
                owner_id,
                {
                    "intervention_id": intervention_id,
                    "from_status": previous.value,
                    "to_status": status.value,
                    "note": note,
                    "outcome": outcome,
                    "due_at": due_at.isoformat() if due_at else row["due_at"],
                },
                stable_hash({"status": previous.value}),
                stable_hash({"status": status.value, "outcome": outcome}),
                f"intervention:{intervention_id}:{uuid.uuid4().hex}",
            )
            conn.commit()
        return self.get_intervention(intervention_id)

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
