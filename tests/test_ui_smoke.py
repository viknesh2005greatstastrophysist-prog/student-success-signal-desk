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


def test_all_ecosystem_role_surfaces_render(settings, monkeypatch):
    monkeypatch.setenv("STUDENT_SUCCESS_DB", str(settings.database_path))
    monkeypatch.setenv("STUDENT_SUCCESS_CHECKPOINT_DB", str(settings.checkpoint_path))
    app_path = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "student_success"
        / "ui"
        / "app.py"
    )
    test_app = AppTest.from_file(str(app_path), default_timeout=20).run()

    identity = next(box for box in test_app.selectbox if box.label == "Demo identity")
    identity.select("mentor-01").run()
    workspace = next(radio for radio in test_app.radio if radio.label == "Workspace")
    workspace.set_value("Mentor Workspace").run()
    assert not test_app.exception
    assert any("Review the evidence" in title.value for title in test_app.title)

    workspace = next(radio for radio in test_app.radio if radio.label == "Workspace")
    workspace.set_value("Interventions").run()
    assert not test_app.exception
    assert any("Approval is the start" in title.value for title in test_app.title)

    identity = next(box for box in test_app.selectbox if box.label == "Demo identity")
    identity.select("student:0001").run()
    assert not test_app.exception
    assert any("Your support plan" in title.value for title in test_app.title)

    identity = next(box for box in test_app.selectbox if box.label == "Demo identity")
    identity.select("hod-demo").run()
    workspace = next(radio for radio in test_app.radio if radio.label == "Workspace")
    workspace.set_value("Leadership Cockpit").run()
    assert not test_app.exception
    assert any("Patterns, not dossiers" in title.value for title in test_app.title)

    identity = next(box for box in test_app.selectbox if box.label == "Demo identity")
    identity.select("demo-admin").run()
    workspace = next(radio for radio in test_app.radio if radio.label == "Workspace")
    workspace.set_value("Agent Operations").run()
    assert not test_app.exception
    assert any("Operate the agents" in title.value for title in test_app.title)
