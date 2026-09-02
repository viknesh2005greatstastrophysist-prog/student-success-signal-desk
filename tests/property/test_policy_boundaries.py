from __future__ import annotations

from hypothesis import HealthCheck, given
from hypothesis import settings as hypothesis_settings
from hypothesis import strategies as st

from student_success.connectors import FixtureConnector, GovernedConnector
from student_success.contracts.models import SourceName
from student_success.policy import (
    PriorityEngine,
    load_policy_bundle,
    normalize_snapshot,
)


def context(settings, student_ref="SYN-0006"):
    bundle = load_policy_bundle(settings.policies_path)
    envelopes = GovernedConnector(FixtureConnector(settings.fixtures_path)).collect(
        "CASE-PROPERTY", student_ref
    )
    return bundle, envelopes


@given(attendance=st.integers(min_value=0, max_value=100))
@hypothesis_settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_attendance_threshold_is_strictly_below(settings, attendance):
    bundle, envelopes = context(settings)
    envelopes[SourceName.ACADEMIC].fields["attendance_pct"] = attendance
    snapshot = normalize_snapshot("CASE-PROPERTY", "SYN-0006", envelopes, bundle.policy)
    assessment = PriorityEngine(bundle.policy).evaluate(snapshot)
    has_reason = "ACADEMIC_ATTENDANCE_LOW" in assessment.reason_codes
    assert has_reason is (attendance < 75)


def test_freshness_at_exact_window_is_not_stale(settings):
    bundle, envelopes = context(settings)
    envelopes[SourceName.LMS].observed_at = bundle.policy.reference_date - __import__(
        "datetime"
    ).timedelta(days=14)
    snapshot = normalize_snapshot("CASE-PROPERTY", "SYN-0006", envelopes, bundle.policy)
    assert snapshot.envelopes[SourceName.LMS].data_state.value == "present"


def test_freshness_beyond_window_is_stale(settings):
    bundle, envelopes = context(settings)
    envelopes[SourceName.LMS].observed_at = bundle.policy.reference_date - __import__(
        "datetime"
    ).timedelta(days=14, seconds=1)
    snapshot = normalize_snapshot("CASE-PROPERTY", "SYN-0006", envelopes, bundle.policy)
    assert snapshot.envelopes[SourceName.LMS].data_state.value == "stale"
