from __future__ import annotations

import argparse
import json
import sys
import uuid

from student_success.application import StudentSuccessApplication
from student_success.config import AppSettings
from student_success.contracts.models import DecisionType, MentorDecision
from student_success.evaluation import EvaluationRunner
from student_success.generation.faults import UnsafeOnceGenerator


def _print(payload) -> None:
    if hasattr(payload, "model_dump"):
        payload = payload.model_dump(mode="json")
    print(json.dumps(payload, indent=2, default=str))


def _seed(app: StudentSuccessApplication) -> list[dict]:
    output = []
    for student_ref in [
        "SYN-0001",
        "SYN-0002",
        "SYN-0003",
        "SYN-0004",
        "SYN-0005",
        "SYN-0006",
    ]:
        case = app.create_case(student_ref, request_id=f"SEED:{student_ref}")
        if case.status.value in {"CREATED", "DATA_BLOCKED"}:
            app.workflow.process_case(case.case_id)
        current = app.repository.get_case(case.case_id)
        output.append(
            {
                "student_ref": student_ref,
                "case_id": case.case_id,
                "status": current.status.value,
            }
        )
    return output


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="student-success", description="Mentor-governed synthetic case manager"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed", help="Create and process the six synthetic cases")
    sub.add_parser("list", help="List cases")
    sub.add_parser(
        "demo", help="Build the normal, bad-data correction, and unsafe-repair demos"
    )
    create = sub.add_parser("create")
    create.add_argument("student_ref")
    create.add_argument("--mentor", default="mentor-01")
    run = sub.add_parser("run")
    run.add_argument("case_id")
    decide = sub.add_parser("decide")
    decide.add_argument("case_id")
    decide.add_argument("decision", choices=["approve", "reject"])
    decide.add_argument("--mentor", default="mentor-01")
    decide.add_argument("--reason", required=True)
    correct = sub.add_parser("correct")
    correct.add_argument("case_id")
    show = sub.add_parser("show")
    show.add_argument("case_id")
    export = sub.add_parser("export")
    export.add_argument("case_id")
    reopen = sub.add_parser("reopen")
    reopen.add_argument("case_id")
    reopen.add_argument("--mentor", default="mentor-01")
    reopen.add_argument("--reason", required=True)
    revoke = sub.add_parser("revoke")
    revoke.add_argument("case_id")
    revoke.add_argument("--mentor", default="mentor-01")
    revoke.add_argument("--reason", required=True)
    rollback = sub.add_parser("rollback")
    rollback.add_argument("case_id")
    rollback.add_argument("--version", required=True, type=int)
    rollback.add_argument("--mentor", default="mentor-01")
    rollback.add_argument("--reason", required=True)
    evaluate = sub.add_parser("evaluate")
    evaluate.add_argument("--allow-live-model", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = AppSettings.from_env()
    app = StudentSuccessApplication(settings)
    try:
        if args.command == "seed":
            _print(_seed(app))
        elif args.command == "list":
            _print(
                [case.model_dump(mode="json") for case in app.repository.list_cases()]
            )
        elif args.command == "create":
            _print(app.create_case(args.student_ref, args.mentor))
        elif args.command == "run":
            app.workflow.process_case(args.case_id)
            _print(app.repository.get_case(args.case_id))
        elif args.command == "correct":
            applied = app.apply_bundled_correction(args.case_id)
            app.workflow.process_case(args.case_id)
            _print(
                {
                    "applied": applied,
                    "case": app.repository.get_case(args.case_id).model_dump(
                        mode="json"
                    ),
                }
            )
        elif args.command == "decide":
            decision = MentorDecision(
                decision=DecisionType(args.decision),
                mentor_id=args.mentor,
                nonce=f"CLI-{uuid.uuid4().hex}",
                reason=args.reason,
            )
            app.workflow.decide(args.case_id, decision)
            _print(app.repository.get_case(args.case_id))
        elif args.command in {"reopen", "revoke"}:
            app.workflow.reopen(
                args.case_id, args.mentor, args.reason, action=args.command
            )
            _print(app.repository.get_case(args.case_id))
        elif args.command == "rollback":
            app.workflow.reopen(
                args.case_id,
                args.mentor,
                args.reason,
                action="rollback",
                source_version=args.version,
            )
            _print(app.repository.get_case(args.case_id))
        elif args.command == "show":
            _print(app.repository.export_case(args.case_id))
        elif args.command == "export":
            _print({"path": str(app.export_case_to_file(args.case_id))})
        elif args.command == "evaluate":
            path, results = EvaluationRunner(settings).run(
                allow_live_model=args.allow_live_model
            )
            _print(
                {
                    "path": str(path),
                    "results": [result.model_dump(mode="json") for result in results],
                }
            )
        elif args.command == "demo":
            seeded = _seed(app)
            stale = next(item for item in seeded if item["student_ref"] == "SYN-0004")
            stale_case = app.repository.get_case(stale["case_id"])
            if stale_case.status.value == "DATA_BLOCKED":
                app.apply_bundled_correction(stale_case.case_id)
                app.workflow.process_case(stale_case.case_id)
            unsafe_app = StudentSuccessApplication(
                settings, generator=UnsafeOnceGenerator()
            )
            unsafe_case = unsafe_app.create_case(
                "SYN-0002", request_id="DEMO:UNSAFE-REPAIR"
            )
            if unsafe_case.status.value == "CREATED":
                unsafe_app.workflow.process_case(unsafe_case.case_id)
            _print(
                {
                    "seeded": seeded,
                    "bad_data_correction": app.repository.get_case(
                        stale_case.case_id
                    ).model_dump(mode="json"),
                    "unsafe_repair": unsafe_app.repository.get_case(
                        unsafe_case.case_id
                    ).model_dump(mode="json"),
                }
            )
        return 0
    except (RuntimeError, ValueError, KeyError, PermissionError, OSError) as exc:
        print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
