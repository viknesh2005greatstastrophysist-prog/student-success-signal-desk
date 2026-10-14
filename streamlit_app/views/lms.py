from __future__ import annotations

import base64
from datetime import datetime, timedelta
from typing import Any

import streamlit as st

import labels
import ui
from bridge import BridgeError
from common import (
    attachment_payload,
    clear_read_cache,
    load,
    pick,
    request,
    save_action,
    select_id,
)


def render_lms(actor: dict[str, Any]) -> None:
    is_student = actor.get("role") == "student"
    ui.page_header(
        "Learning",
        "Lessons, assignments and feedback for your courses."
        if is_student
        else "Publish lessons and assignments, then review submissions and give feedback.",
    )
    lms = load("lms_overview")
    courses = lms.get("courses") or []
    offering_id = select_id(
        "Course",
        courses,
        lambda row: str(row.get("id", "")),
        lambda row: (
            f"{row.get('code', '')} · {row.get('title', '')} · {row.get('section', '')}"
        ),
        key="lms_course",
    )
    if not offering_id:
        ui.empty_state(
            "No courses yet",
            "Courses appear here once you are enrolled or assigned.",
        )
        return
    detail = load("lms_course", {"courseId": offering_id})
    course = detail.get("course") or {}
    lessons = detail.get("lessons") or []
    assignments = detail.get("assignments") or []
    submissions = detail.get("submissions") or []
    st.subheader(f"{course.get('code', '')} · {course.get('title', '')}", anchor=False)
    ui.section("Lessons", icon=":material/auto_stories:")
    if not lessons:
        ui.empty_state(
            "No lessons yet",
            "Lessons appear here when they are published.",
        )
    for lesson in lessons:
        with st.expander(
            str(lesson.get("title", "Lesson")),
            icon=":material/article:"
            if lesson.get("published", True)
            else ":material/visibility_off:",
        ):
            if lesson.get("body"):
                ui.plain_text(lesson["body"])
            if lesson.get("material_url"):
                st.link_button(
                    "Open course material",
                    lesson["material_url"],
                    icon=":material/open_in_new:",
                )
            if lesson.get("attachment_name"):
                st.caption(
                    f":material/attach_file: {ui.code_span(lesson['attachment_name'])}"
                )
            if is_student and st.button(
                "Mark lesson as opened",
                key=f"open_lesson_{lesson['id']}",
                icon=":material/done:",
            ):
                save_action(
                    "lms_command",
                    {"action": "open-lesson", "lessonId": lesson["id"]},
                    "Lesson activity recorded.",
                )

    if not is_student:
        with st.expander("Add or update a lesson", icon=":material/post_add:"):
            lesson_choices: list[dict[str, Any] | None] = [None, *lessons]
            selected_lesson = pick(
                "Lesson to edit",
                lesson_choices,
                format_func=lambda row: (
                    "New lesson" if row is None else str(row.get("title", "Lesson"))
                ),
                key=f"lesson_edit_{offering_id}",
            )
            with st.form(
                f"lesson_form_{offering_id}_{(selected_lesson or {}).get('id', 'new')}"
            ):
                title = st.text_input(
                    "Lesson title",
                    value=str(
                        selected_lesson.get("title", "") if selected_lesson else ""
                    ),
                    max_chars=160,
                )
                body = st.text_area(
                    "Lesson content",
                    value=str(
                        selected_lesson.get("body", "") if selected_lesson else ""
                    ),
                    max_chars=40000,
                    height=180,
                )
                material_url = st.text_input(
                    "Material link",
                    value=str(
                        selected_lesson.get("material_url", "")
                        if selected_lesson
                        else ""
                    ),
                    max_chars=2000,
                )
                position = st.number_input(
                    "Order",
                    min_value=1,
                    max_value=1000,
                    value=int(
                        selected_lesson.get("position", len(lessons) + 1)
                        if selected_lesson
                        else len(lessons) + 1
                    ),
                    step=1,
                )
                published = st.checkbox(
                    "Make lesson available to students",
                    value=bool(
                        selected_lesson.get("published", False)
                        if selected_lesson
                        else False
                    ),
                )
                lesson_file = st.file_uploader(
                    "Add a lesson file (optional, up to 2 MB)",
                    key=f"lesson_file_{offering_id}_{(selected_lesson or {}).get('id', 'new')}",
                    max_upload_size=2,
                    help="A new file replaces the current attachment. Leave this empty to keep it.",
                )
                submitted = st.form_submit_button("Save lesson", type="primary")
            if submitted:
                if len(title.strip()) < 3:
                    st.error("Enter a lesson title with at least three characters.")
                else:
                    attachment, attachment_error = attachment_payload(lesson_file)
                    if attachment_error:
                        st.error(attachment_error)
                    else:
                        payload = {
                            "action": "save-lesson",
                            "offeringId": offering_id,
                            "title": title.strip(),
                            "body": body,
                            "materialUrl": material_url.strip(),
                            "published": published,
                            "position": int(position),
                        }
                        if attachment:
                            payload["attachment"] = attachment
                        if selected_lesson:
                            payload.update(
                                {
                                    "id": selected_lesson["id"],
                                    "expectedRevision": int(
                                        selected_lesson["revision"]
                                    ),
                                }
                            )
                        save_action("lms_command", payload, "Lesson saved.")

    ui.section("Assignments", icon=":material/assignment:")
    if not assignments:
        ui.empty_state(
            "No assignments yet",
            "Assignments appear here when they are published.",
        )
    submitted_ids = {row.get("assignment_id") for row in submissions}
    late_ids = {
        row.get("assignment_id")
        for row in submissions
        if labels.is_late(
            next(
                (
                    a.get("due_at")
                    for a in assignments
                    if a.get("id") == row.get("assignment_id")
                ),
                None,
            ),
            row.get("submitted_at"),
            row.get("late"),
        )
    }
    for assignment in assignments:
        passed = bool(assignment.get("deadline_passed"))
        with st.expander(
            f"{assignment.get('title', 'Assignment')} · due {labels.nice_time(assignment.get('due_at'))}",
            icon=":material/event_busy:" if passed else ":material/assignment:",
        ):
            badges = [
                ui.badge_md("Deadline passed", "red", ":material/event_busy:")
                if passed
                else ui.badge_md(
                    labels.due_phrase(assignment.get("due_at")),
                    "orange",
                    ":material/schedule:",
                )
            ]
            if is_student:
                badges.append(
                    ui.badge_md("Submitted late", "orange", ":material/schedule:")
                    if assignment.get("id") in late_ids
                    else ui.badge_md("Submitted", "green", ":material/check:")
                    if assignment.get("id") in submitted_ids
                    else ui.badge_md(
                        "Not submitted", "gray", ":material/radio_button_unchecked:"
                    )
                )
            st.markdown(" ".join(badges))
            ui.plain_text(assignment.get("instructions"))
            st.caption(
                f":material/grade: Maximum score: {assignment.get('maximum_score', 'Not recorded')}"
            )
            if assignment.get("attachment_name"):
                st.caption(
                    f":material/attach_file: {ui.code_span(assignment['attachment_name'])}"
                )
    if not is_student:
        with st.expander("Add or update an assignment", icon=":material/post_add:"):
            assignment_choices: list[dict[str, Any] | None] = [None, *assignments]
            selected_assignment = pick(
                "Assignment to edit",
                assignment_choices,
                format_func=lambda row: (
                    "New assignment"
                    if row is None
                    else str(row.get("title", "Assignment"))
                ),
                key=f"assignment_edit_{offering_id}",
            )
            try:
                initial_due = (
                    datetime.fromisoformat(
                        str(selected_assignment.get("due_at"))
                    ).astimezone()
                    if selected_assignment
                    else datetime.now().astimezone() + timedelta(days=7)
                )
            except ValueError:
                initial_due = datetime.now().astimezone() + timedelta(days=7)
            with st.form(
                f"assignment_form_{offering_id}_{(selected_assignment or {}).get('id', 'new')}"
            ):
                title = st.text_input(
                    "Assignment title",
                    value=str(
                        selected_assignment.get("title", "")
                        if selected_assignment
                        else ""
                    ),
                    max_chars=160,
                )
                instructions = st.text_area(
                    "Instructions",
                    value=str(
                        selected_assignment.get("instructions", "")
                        if selected_assignment
                        else ""
                    ),
                    max_chars=40000,
                    height=150,
                )
                due_date = st.date_input("Due date", value=initial_due.date())
                due_time = st.time_input(
                    "Due time",
                    value=initial_due.time().replace(second=0, microsecond=0),
                )
                maximum = st.number_input(
                    "Maximum score",
                    min_value=0.01,
                    max_value=1000.0,
                    value=float(
                        selected_assignment.get("maximum_score", 100)
                        if selected_assignment
                        else 100
                    ),
                    step=1.0,
                )
                published = st.checkbox(
                    "Make assignment available to students",
                    value=bool(
                        selected_assignment.get("published", False)
                        if selected_assignment
                        else False
                    ),
                )
                allow_late = st.checkbox(
                    "Accept late submissions",
                    value=bool(
                        selected_assignment.get("allow_late", True)
                        if selected_assignment
                        else True
                    ),
                )
                assignment_file = st.file_uploader(
                    "Add an assignment file (optional, up to 2 MB)",
                    key=f"assignment_file_{offering_id}_{(selected_assignment or {}).get('id', 'new')}",
                    max_upload_size=2,
                    help="A new file replaces the current attachment. Leave this empty to keep it.",
                )
                submitted = st.form_submit_button("Save assignment", type="primary")
            if submitted:
                if len(title.strip()) < 3 or len(instructions.strip()) < 5:
                    st.error("Enter an assignment title and instructions.")
                else:
                    attachment, attachment_error = attachment_payload(assignment_file)
                    if attachment_error:
                        st.error(attachment_error)
                    else:
                        local_zone = datetime.now().astimezone().tzinfo
                        due_at = datetime.combine(
                            due_date, due_time, tzinfo=local_zone
                        ).isoformat(timespec="seconds")
                        payload = {
                            "action": "save-assignment",
                            "offeringId": offering_id,
                            "title": title.strip(),
                            "instructions": instructions.strip(),
                            "dueAt": due_at,
                            "maximumScore": float(maximum),
                            "published": published,
                            "allowLate": allow_late,
                        }
                        if attachment:
                            payload["attachment"] = attachment
                        if selected_assignment:
                            payload.update(
                                {
                                    "id": selected_assignment["id"],
                                    "expectedRevision": int(
                                        selected_assignment["revision"]
                                    ),
                                }
                            )
                        save_action("lms_command", payload, "Assignment saved.")

    if is_student and assignments:
        ui.section("Submit your work", icon=":material/upload_file:")
        submissions_by_assignment = {
            row.get("assignment_id"): row for row in submissions
        }
        assignment_id = select_id(
            "Assignment",
            assignments,
            lambda row: str(row.get("id", "")),
            lambda row: str(row.get("title", "Assignment")),
            key=f"submit_assignment_{offering_id}",
        )
        assignment = next(
            row for row in assignments if str(row.get("id")) == assignment_id
        )
        current_submission = submissions_by_assignment.get(assignment_id)
        if current_submission:
            was_late = labels.is_late(
                assignment.get("due_at"),
                current_submission.get("submitted_at"),
                current_submission.get("late"),
            )
            st.markdown(
                ui.badge_md(
                    f"Submitted {labels.nice_time(current_submission.get('submitted_at'))}"
                    + (" · late" if was_late else ""),
                    "orange" if was_late else "green",
                    ":material/schedule:" if was_late else ":material/check:",
                )
            )
            if current_submission.get("feedback"):
                with ui.card(f"feedback_{current_submission.get('id')}"):
                    st.html('<p class="aura-eyebrow">Feedback from your teacher</p>')
                    if current_submission.get("score") is not None:
                        st.markdown(f"**Score: {current_submission.get('score')}**")
                    ui.plain_text(current_submission["feedback"])
        with st.form(f"student_submission_{assignment_id}"):
            answer = st.text_area(
                "Your response",
                value=str(
                    current_submission.get("answer", "") if current_submission else ""
                ),
                max_chars=40000,
                height=180,
            )
            submission_file = st.file_uploader(
                "Attach your work (optional, up to 2 MB)",
                key=f"submission_file_{assignment_id}",
                max_upload_size=2,
                help="If you already attached a file, it will be kept when you submit without a replacement.",
            )
            submitted = st.form_submit_button(
                "Submit assignment", type="primary", icon=":material/send:"
            )
        if submitted:
            attachment, attachment_error = attachment_payload(submission_file)
            if attachment_error:
                st.error(attachment_error)
            else:
                if (
                    attachment is None
                    and current_submission
                    and current_submission.get("attachment_name")
                ):
                    try:
                        attachment = request(
                            "lms_attachment",
                            {"kind": "submissions", "id": current_submission["id"]},
                        )
                    except BridgeError as error:
                        st.error(str(error))
                        attachment = None
                if attachment is not None or not (
                    current_submission and current_submission.get("attachment_name")
                ):
                    payload = {
                        "action": "submit-assignment",
                        "assignmentId": assignment_id,
                        "expectedRevision": int(current_submission.get("revision", -1))
                        if current_submission
                        else -1,
                        "answer": answer.strip(),
                    }
                    if attachment:
                        payload["attachment"] = attachment
                    save_action("lms_command", payload, "Assignment submitted.")

    if not is_student and submissions:
        ui.section("Review submissions", icon=":material/rate_review:")
        assignment_by_id = {row.get("id"): row for row in assignments}
        submission = pick(
            "Submission",
            submissions,
            format_func=lambda row: (
                f"{labels.pretty_name(row.get('student_name', 'Student'))} · {assignment_by_id.get(row.get('assignment_id'), {}).get('title', 'Assignment')}"
            ),
            key=f"feedback_submission_{offering_id}",
        )
        current_assignment = assignment_by_id.get(submission.get("assignment_id"), {})
        with st.form(f"feedback_{submission.get('id')}_{submission.get('revision')}"):
            score = st.number_input(
                "Score",
                min_value=0.0,
                max_value=float(current_assignment.get("maximum_score", 100) or 100),
                value=float(submission.get("score") or 0),
                step=0.5,
            )
            feedback = st.text_area(
                "Feedback",
                value=str(submission.get("feedback", "") or ""),
                max_chars=12000,
            )
            submitted = st.form_submit_button(
                "Publish feedback", type="primary", icon=":material/send:"
            )
        if submitted:
            if len(feedback.strip()) < 3:
                st.error("Enter feedback with at least three characters.")
            else:
                save_action(
                    "lms_command",
                    {
                        "action": "publish-feedback",
                        "submissionId": submission["id"],
                        "expectedRevision": int(submission["revision"]),
                        "score": float(score),
                        "feedback": feedback.strip(),
                    },
                    "Feedback published.",
                )

    course_files: list[dict[str, str]] = []
    for kind, rows, label in (
        ("lessons", lessons, "Lesson"),
        ("assignments", assignments, "Assignment"),
        ("submissions", submissions, "Submission"),
    ):
        for row in rows:
            if row.get("attachment_name"):
                course_files.append(
                    {
                        "id": str(row.get("id", "")),
                        "kind": kind,
                        "name": str(row["attachment_name"]),
                        "label": f"{label} · {row.get('title') or labels.pretty_name(row.get('student_name')) or 'Course file'}",
                    }
                )
    if course_files:
        ui.section("Course files", icon=":material/folder_open:")
        file_id = select_id(
            "File",
            course_files,
            lambda row: row["id"],
            lambda row: f"{row['label']} · {row['name']}",
            key=f"lms_file_{offering_id}",
        )
        selected_file = next(
            (row for row in course_files if row["id"] == file_id), None
        )
        if selected_file:
            try:
                file_result = request(
                    "lms_attachment",
                    {"kind": selected_file["kind"], "id": selected_file["id"]},
                )
                file_data = base64.b64decode(file_result["data"], validate=True)
                st.download_button(
                    f"Download {file_result['name']}",
                    data=file_data,
                    file_name=file_result["name"],
                    mime="application/octet-stream",
                    key=f"download_lms_file_{selected_file['id']}",
                    on_click="ignore",
                )
            except BridgeError as error:
                if error.status == 401:
                    clear_read_cache()
                    st.session_state.pop("token", None)
                    st.session_state.pop("actor", None)
                    st.warning("Your session has ended. Sign in again to continue.")
                else:
                    st.error(str(error))
            except (KeyError, TypeError, ValueError):
                st.error("The selected file could not be prepared for download.")


def learning_page() -> None:
    render_lms(st.session_state.get("actor") or {})
