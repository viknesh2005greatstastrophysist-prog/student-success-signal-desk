from __future__ import annotations

from student_success.contracts.models import (
    DataState,
    DemoPolicy,
    NormalizedSnapshot,
    Priority,
    PriorityAssessment,
    Signal,
    SourceName,
)


class PriorityEngine:
    """Applies the fictional, versioned policy. No model is involved."""

    def __init__(self, policy: DemoPolicy):
        self.policy = policy

    @staticmethod
    def _first_ref(snapshot: NormalizedSnapshot, source: SourceName) -> list[str]:
        refs = [
            ref
            for ref, record in snapshot.record_index.items()
            if record.source == source
        ]
        return refs[:1]

    def _signal(
        self,
        snapshot: NormalizedSnapshot,
        source: SourceName,
        reason_code: str,
        value: float,
        threshold: float,
        comparator: str,
        description: str,
        critical: bool = False,
    ) -> Signal:
        return Signal(
            reason_code=reason_code,
            source=source,
            source_refs=self._first_ref(snapshot, source),
            observed_value=value,
            threshold=threshold,
            comparator=comparator,
            critical=critical,
            description=description,
        )

    def evaluate(self, snapshot: NormalizedSnapshot) -> PriorityAssessment:
        if not snapshot.is_sufficient:
            return PriorityAssessment(
                priority=Priority.DATA_BLOCKED,
                concern_index=0,
                reason_codes=sorted(
                    {issue.reason_code for issue in snapshot.data_issues}
                ),
                signals=[],
                policy_version=self.policy.policy_version,
                evaluated_at=self.policy.reference_date,
            )

        signals: list[Signal] = []
        academic = snapshot.envelopes[SourceName.ACADEMIC]
        if academic.data_state == DataState.PRESENT:
            t = self.policy.thresholds["academic"]
            attendance = academic.fields.get("attendance_pct")
            if attendance is not None and attendance < t["attendance_pct_below"]:
                signals.append(
                    self._signal(
                        snapshot,
                        SourceName.ACADEMIC,
                        "ACADEMIC_ATTENDANCE_LOW",
                        attendance,
                        t["attendance_pct_below"],
                        "<",
                        f"Attendance is {attendance}%, below the fictional {t['attendance_pct_below']:g}% threshold.",
                    )
                )
            gpa = academic.fields.get("gpa")
            if gpa is not None and gpa < t["gpa_below"]:
                signals.append(
                    self._signal(
                        snapshot,
                        SourceName.ACADEMIC,
                        "ACADEMIC_GPA_LOW",
                        gpa,
                        t["gpa_below"],
                        "<",
                        f"GPA is {gpa:g}, below the fictional {t['gpa_below']:g} threshold.",
                    )
                )
            failed = academic.fields.get("failed_courses")
            if failed is not None and failed >= t["failed_courses_critical_at_least"]:
                signals.append(
                    self._signal(
                        snapshot,
                        SourceName.ACADEMIC,
                        "ACADEMIC_FAILED_COURSES_CRITICAL",
                        failed,
                        t["failed_courses_critical_at_least"],
                        ">=",
                        f"Failed-course count is {failed}, meeting the fictional critical threshold.",
                        True,
                    )
                )

        lms = snapshot.envelopes[SourceName.LMS]
        if lms.data_state == DataState.PRESENT:
            t = self.policy.thresholds["lms"]
            inactivity = lms.fields.get("inactivity_days")
            if inactivity is not None and inactivity >= t["inactivity_days_at_least"]:
                signals.append(
                    self._signal(
                        snapshot,
                        SourceName.LMS,
                        "LMS_INACTIVITY_HIGH",
                        inactivity,
                        t["inactivity_days_at_least"],
                        ">=",
                        f"LMS inactivity is {inactivity} days, meeting the fictional concern threshold.",
                    )
                )
            overdue = lms.fields.get("overdue_assignments")
            if overdue is not None and overdue >= t["overdue_assignments_at_least"]:
                signals.append(
                    self._signal(
                        snapshot,
                        SourceName.LMS,
                        "LMS_OVERDUE_HIGH",
                        overdue,
                        t["overdue_assignments_at_least"],
                        ">=",
                        f"Overdue assignment count is {overdue}, meeting the fictional concern threshold.",
                    )
                )
            missed = lms.fields.get("missed_assessments")
            if (
                missed is not None
                and missed >= t["missed_assessments_critical_at_least"]
            ):
                signals.append(
                    self._signal(
                        snapshot,
                        SourceName.LMS,
                        "LMS_MISSED_ASSESSMENTS_CRITICAL",
                        missed,
                        t["missed_assessments_critical_at_least"],
                        ">=",
                        f"Missed-assessment count is {missed}, meeting the fictional critical threshold.",
                        True,
                    )
                )

        optional_rules = [
            (
                SourceName.INTERNSHIP,
                "missed_milestones",
                "missed_milestones_at_least",
                "INTERNSHIP_MILESTONE_MISSED",
                "Missed internship milestone count",
            ),
            (
                SourceName.PLACEMENT,
                "missed_required_activities",
                "missed_required_activities_at_least",
                "PLACEMENT_ACTIVITY_MISSED",
                "Missed placement activity count",
            ),
        ]
        for source, field, threshold_key, reason_code, label in optional_rules:
            envelope = snapshot.envelopes[source]
            if envelope.data_state != DataState.PRESENT:
                continue
            value = envelope.fields.get(field)
            threshold = self.policy.thresholds[source.value][threshold_key]
            if value is not None and value >= threshold:
                signals.append(
                    self._signal(
                        snapshot,
                        source,
                        reason_code,
                        value,
                        threshold,
                        ">=",
                        f"{label} is {value}, meeting the fictional concern threshold.",
                    )
                )

        if any(signal.critical for signal in signals) or len(signals) >= 2:
            priority = Priority.HIGH
        elif len(signals) == 1:
            priority = Priority.MEDIUM
        else:
            priority = Priority.LOW
        reason_codes = [signal.reason_code for signal in signals] or [
            "NO_CONCERNING_SIGNALS"
        ]
        # This index is a transparent demo-policy sorting aid, not a
        # probability, diagnosis, or prediction. Critical signals carry an
        # explicit extra policy weight and the result is capped at 100.
        concern_index = min(
            self.policy.concern_index.cap,
            (self.policy.concern_index.signal_points * len(signals))
            + (
                self.policy.concern_index.critical_bonus
                * sum(signal.critical for signal in signals)
            ),
        )
        return PriorityAssessment(
            priority=priority,
            concern_index=concern_index,
            reason_codes=reason_codes,
            signals=signals,
            policy_version=self.policy.policy_version,
            evaluated_at=self.policy.reference_date,
        )
