from __future__ import annotations

from pathlib import Path

from streamlit.testing.v1 import AppTest


def test_streamlit_app_starts_with_empty_database(settings, monkeypatch):
    monkeypatch.setenv("STUDENT_SUCCESS_DB", str(settings.database_path))
    monkeypatch.setenv("STUDENT_SUCCESS_CHECKPOINT_DB", str(settings.checkpoint_path))
    app_path = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "student_success"
        / "ui"
        / "app.py"
    )
    test_app = AppTest.from_file(str(app_path), default_timeout=15).run()
    assert not test_app.exception
    assert any(
        "Evidence before intervention" in title.value for title in test_app.title
    )
