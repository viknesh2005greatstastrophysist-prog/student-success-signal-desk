"""The pages each workspace offers. Every page has its own URL and only the page
being opened runs, so a click never pays for the rest of the app."""

from __future__ import annotations

import streamlit as st

from views import hod, lms, mentor, operations, parent, student


def _page(fn, title: str, icon: str, url_path: str, *, default: bool = False):
    return st.Page(fn, title=title, icon=icon, url_path=url_path, default=default)


def pages_for(portal: str) -> list[st.Page]:
    if portal == "student":
        return [
            _page(
                student.overview_page,
                "Overview",
                ":material/space_dashboard:",
                "overview",
                default=True,
            ),
            _page(student.courses_page, "Courses", ":material/menu_book:", "courses"),
            _page(lms.learning_page, "Learning", ":material/auto_stories:", "learning"),
            _page(
                student.support_page,
                "My support plan",
                ":material/handshake:",
                "support-plan",
            ),
            _page(student.profile_page, "Profile", ":material/person:", "profile"),
        ]
    if portal == "parent":
        return [
            _page(
                parent.overview_page,
                "Overview",
                ":material/space_dashboard:",
                "overview",
                default=True,
            ),
            _page(
                parent.support_page,
                "Support plan and mentor updates",
                ":material/handshake:",
                "support-plan",
            ),
            _page(
                parent.fees_page, "Fees and receipts", ":material/receipt_long:", "fees"
            ),
            _page(parent.profile_page, "Profile", ":material/person:", "profile"),
        ]
    if portal == "faculty":
        return [
            _page(
                mentor.today_page, "Today", ":material/today:", "today", default=True
            ),
            _page(mentor.mentees_page, "Mentees", ":material/groups:", "mentees"),
            _page(mentor.reviews_page, "Reviews", ":material/fact_check:", "reviews"),
            _page(
                mentor.classroom_page, "Classroom", ":material/co_present:", "classroom"
            ),
        ]
    if portal == "hod":
        return [
            _page(
                hod.overview_page,
                "Overview",
                ":material/monitoring:",
                "overview",
                default=True,
            ),
            _page(hod.students_page, "Students", ":material/groups:", "students"),
            _page(
                hod.mentors_page, "Mentors", ":material/supervisor_account:", "mentors"
            ),
            _page(hod.policies_page, "Policies", ":material/policy:", "policies"),
        ]
    if portal == "governance":
        return [
            _page(
                operations.runs_page, "Runs", ":material/history:", "runs", default=True
            ),
            _page(
                operations.graph_page,
                "Agent graph",
                ":material/account_tree:",
                "agent-graph",
            ),
            _page(
                operations.evaluation_page,
                "Evaluation",
                ":material/insights:",
                "evaluation",
            ),
            _page(
                operations.audit_page,
                "Audit and replay",
                ":material/verified_user:",
                "audit",
            ),
        ]
    if portal == "lms":
        return [
            _page(
                lms.learning_page,
                "Learning",
                ":material/auto_stories:",
                "learning",
                default=True,
            )
        ]
    return [
        _page(
            student.overview_page,
            "Overview",
            ":material/space_dashboard:",
            "overview",
            default=True,
        )
    ]
