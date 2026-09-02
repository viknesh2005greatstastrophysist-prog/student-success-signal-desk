from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from student_success.contracts.models import CaseRecord


class UserRole(str, Enum):
    STUDENT = "student"
    MENTOR = "mentor"
    LEADERSHIP = "leadership"
    ADMIN = "admin"


@dataclass(frozen=True)
class DemoIdentity:
    identity_id: str
    label: str
    role: UserRole
    student_ref: str | None = None
    mentor_id: str | None = None


DEMO_IDENTITIES = (
    DemoIdentity("demo-admin", "AURA Coordinator", UserRole.ADMIN),
    DemoIdentity(
        "mentor-01",
        "Faculty Mentor 01",
        UserRole.MENTOR,
        mentor_id="mentor-01",
    ),
    DemoIdentity(
        "mentor-02",
        "Faculty Mentor 02",
        UserRole.MENTOR,
        mentor_id="mentor-02",
    ),
    DemoIdentity("hod-demo", "Head of Department", UserRole.LEADERSHIP),
    DemoIdentity("dean-demo", "Dean of Student Affairs", UserRole.LEADERSHIP),
    *(
        DemoIdentity(
            f"student:{index:04d}",
            f"Synthetic Student {index:04d}",
            UserRole.STUDENT,
            student_ref=f"SYN-{index:04d}",
        )
        for index in range(1, 7)
    ),
)


ROLE_PAGES = {
    UserRole.ADMIN: (
        "Ecosystem Map",
        "Command Centre",
        "Agent Operations",
        "Governance",
    ),
    UserRole.MENTOR: (
        "Ecosystem Map",
        "Command Centre",
        "Mentor Workspace",
        "Interventions",
    ),
    UserRole.LEADERSHIP: (
        "Ecosystem Map",
        "Leadership Cockpit",
        "Governance",
    ),
    UserRole.STUDENT: ("Student Portal",),
}


def allowed_pages(identity: DemoIdentity) -> tuple[str, ...]:
    return ROLE_PAGES[identity.role]


def can_access_case(identity: DemoIdentity, case: CaseRecord) -> bool:
    if identity.role == UserRole.ADMIN:
        return True
    if identity.role == UserRole.MENTOR:
        return identity.mentor_id == case.assigned_mentor
    if identity.role == UserRole.STUDENT:
        return identity.student_ref == case.student_ref
    return False


def require_case_access(identity: DemoIdentity, case: CaseRecord) -> None:
    if not can_access_case(identity, case):
        raise PermissionError(
            f"{identity.identity_id} cannot access case {case.case_id}"
        )


def require_student_scope(identity: DemoIdentity, student_ref: str) -> None:
    if identity.role != UserRole.STUDENT or identity.student_ref != student_ref:
        raise PermissionError(
            f"{identity.identity_id} cannot access student view {student_ref}"
        )
