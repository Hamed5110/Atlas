"""Offscreen smoke tests for the native allocation engine screen."""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

pytest.importorskip("PySide6")

from PySide6.QtWidgets import QApplication, QMessageBox

from airfare_management.desktop.main import AllocationEngineScreen, ApiClient, MainWindow


def test_allocation_engine_screen_builds_and_requires_employee_to_issue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The allocation widget constructs and blocks issue without an employee id."""
    application = QApplication.instance() or QApplication([])
    screen = AllocationEngineScreen(ApiClient("http://127.0.0.1:3388"))
    payload = screen._preview_payload()
    assert payload["excess_option"] == "LOAN"
    assert payload["global_company_preference_rate"] == "150"
    messages: list[str] = []
    monkeypatch.setattr(
        QMessageBox,
        "critical",
        lambda _parent, title, text: messages.append(f"{title}: {text}"),
    )
    screen.issue()
    assert messages
    assert "Employee ID is required" in messages[0]
    screen.api._client.close()
    screen.deleteLater()
    assert MainWindow.__name__ == "MainWindow"
    assert application is not None
