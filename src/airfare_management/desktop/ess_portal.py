"""Employee self-service portal with live MaxPayout entitlement snapshot."""

from __future__ import annotations

from datetime import date

import httpx
from PySide6.QtCore import QDate
from PySide6.QtWidgets import (
    QComboBox,
    QDateEdit,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


class EssPortalScreen(QWidget):
    """Live ESS: entitlement balance, last ticket, loans, and request submit."""

    def __init__(self, api: object) -> None:
        super().__init__()
        self.api = api
        self._employees: list[dict[str, object]] = []

        self.employee = QComboBox()
        self.lbl_balance = QLabel("—")
        self.lbl_days = QLabel("—")
        self.lbl_last_ticket = QLabel("—")
        self.lbl_loans = QLabel("—")
        self.lbl_scenario = QLabel("—")
        self.lbl_rate = QLabel("—")
        self.status = QLabel("Select an employee to load live MSSQL ESS data.")
        self.status.setWordWrap(True)

        for label in (
            self.lbl_balance,
            self.lbl_days,
            self.lbl_last_ticket,
            self.lbl_loans,
            self.lbl_scenario,
            self.lbl_rate,
        ):
            label.setStyleSheet(
                "QLabel { background:#edf5fc; border:1px solid #d2e4f3; padding:6px; }"
            )

        snapshot = QFormLayout()
        snapshot.addRow("Employee", self.employee)
        snapshot.addRow("Detected scenario", self.lbl_scenario)
        snapshot.addRow("Applied MaxPayout / source", self.lbl_rate)
        snapshot.addRow("Final entitlement", self.lbl_balance)
        snapshot.addRow("Accrued / days left", self.lbl_days)
        snapshot.addRow("Last ticket booking", self.lbl_last_ticket)
        snapshot.addRow("Active loans", self.lbl_loans)
        snap_box = QGroupBox("Live entitlement (MaxPayout ÷ 60 · 30/360)")
        snap_box.setLayout(snapshot)

        self.request_type = QComboBox()
        self.request_type.addItems(["airfare", "ticket", "loan"])
        self.travel_date = QDateEdit(QDate.currentDate())
        self.travel_date.setCalendarPopup(True)
        self.origin = QLineEdit("BAH")
        self.destination = QLineEdit("DEL")
        self.notes = QTextEdit()
        self.notes.setMaximumHeight(80)

        form = QFormLayout()
        form.addRow("Request type", self.request_type)
        form.addRow("Travel date", self.travel_date)
        form.addRow("Origin", self.origin)
        form.addRow("Destination", self.destination)
        form.addRow("Notes", self.notes)
        form_box = QGroupBox("Submit ESS request")
        form_box.setLayout(form)

        refresh = QPushButton("Refresh snapshot")
        refresh.clicked.connect(self.reload_snapshot)
        submit = QPushButton("Submit request")
        submit.clicked.connect(self.submit_request)
        row = QHBoxLayout()
        row.addWidget(refresh)
        row.addWidget(submit)

        layout = QVBoxLayout(self)
        layout.addWidget(
            QLabel(
                "ESS portal reads entitlement via /v1/allocations/preview (ATLAS MaxPayout engine) "
                "and loans/tickets from MSSQL."
            )
        )
        layout.addWidget(snap_box)
        layout.addWidget(form_box)
        layout.addLayout(row)
        layout.addWidget(self.status)
        layout.addStretch()

        self.employee.currentIndexChanged.connect(self.reload_snapshot)
        self.reload_employees()

    def reload_employees(self) -> None:
        """Load employees for manager/admin ESS view."""
        try:
            rows = self.api.get("/v1/employees?limit=500")
        except httpx.HTTPError as exc:
            QMessageBox.critical(self, "ESS", str(exc))
            return
        self._employees = list(rows)
        self.employee.blockSignals(True)
        self.employee.clear()
        for row in self._employees:
            self.employee.addItem(
                f"{row.get('code')} — {row.get('full_name')}", str(row.get("id") or "")
            )
        self.employee.blockSignals(False)
        self.reload_snapshot()

    def _employee_id(self) -> str | None:
        value = str(self.employee.currentData() or "").strip()
        return value or None

    def reload_snapshot(self) -> None:
        """Refresh live entitlement, last ticket, and loans."""
        employee_id = self._employee_id()
        if employee_id is None:
            return
        try:
            dash = self.api.get_object(f"/v1/ess/dashboard?employee_id={employee_id}")
            preview = self.api.post(
                "/v1/allocations/preview",
                {
                    "employee_id": employee_id,
                    "as_of_date": date.today().isoformat(),
                },
            )
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            self.status.setText(f"Snapshot failed: {exc}")
            return
        scenario = str(preview.get("scenario") or "—").replace("_", " ")
        self.lbl_scenario.setText(scenario)
        rate = preview.get("airfare_rate") or preview.get("maximum_payout") or "—"
        source = preview.get("rate_source") or "—"
        self.lbl_rate.setText(f"{rate} · {source}")
        self.lbl_balance.setText(
            str(
                preview.get("final_entitlement_amount")
                or preview.get("airfare_entitlement_amount")
                or "—"
            )
        )
        accrued = preview.get("accrued_days") or preview.get("current_year_earned_days") or "—"
        left = preview.get("days_left") or preview.get("eligible_balance_days") or "—"
        self.lbl_days.setText(f"{accrued} accrued · {left} left")
        self.lbl_last_ticket.setText(
            str(dash.get("last_ticket_date") or preview.get("last_ticket_date") or "None")
        )
        loans = dash.get("active_loans") or []
        if isinstance(loans, list) and loans:
            self.lbl_loans.setText(
                "; ".join(
                    f"{item.get('loan_code') or item.get('id')}: "
                    f"outstanding {item.get('outstanding')}"
                    for item in loans[:5]
                )
            )
        else:
            self.lbl_loans.setText("None")
        self.status.setText("ESS snapshot loaded from MSSQL (MaxPayout ÷ 60).")

    def submit_request(self) -> None:
        """POST /v1/ess/requests."""
        employee_id = self._employee_id()
        if employee_id is None:
            QMessageBox.warning(self, "ESS", "Select an employee.")
            return
        payload = {
            "employee_id": employee_id,
            "request_type": self.request_type.currentText(),
            "travel_date": self.travel_date.date().toString("yyyy-MM-dd"),
            "origin_code": self.origin.text().strip().upper(),
            "destination_code": self.destination.text().strip().upper(),
            "notes": self.notes.toPlainText().strip(),
        }
        try:
            created = self.api.post("/v1/ess/requests", payload)
            self.status.setText(f"Submitted ESS request {created.get('id')}.")
            self.reload_snapshot()
        except httpx.HTTPError as exc:
            QMessageBox.critical(self, "ESS submit failed", str(exc))
