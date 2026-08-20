"""Native PySide6 Airfare Allocation Engine with MSSQL-backed auto-preview."""

from __future__ import annotations

from decimal import Decimal

import httpx
from PySide6.QtCore import QDate, QObject, QThread, Signal, Slot
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
    QSpinBox,
    QVBoxLayout,
    QWidget,
)


class AllocationPreviewWorker(QObject):
    """Background caller for POST /v1/allocations/preview."""

    finished = Signal(dict)
    failed = Signal(str)

    def __init__(self, api: object, payload: dict[str, object]) -> None:
        super().__init__()
        self._api = api
        self._payload = payload

    @Slot()
    def run(self) -> None:
        """Execute the preview request off the UI thread."""
        try:
            result = self._api.post("/v1/allocations/preview", self._payload)
            self.finished.emit(result)
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            self.failed.emit(str(exc))


class AllocationEngineScreen(QWidget):
    """Employee-driven allocation UI: select employee → auto ATLAS preview → issue."""

    def __init__(self, api: object) -> None:
        super().__init__()
        self.api = api
        self._employees: list[dict[str, object]] = []
        self._thread: QThread | None = None
        self._worker: AllocationPreviewWorker | None = None
        self._latest: dict[str, object] | None = None
        self._preview_generation = 0

        self.employee = QComboBox()
        self.employee.setEditable(False)
        self.as_of = QDateEdit(QDate.currentDate())
        self.as_of.setCalendarPopup(True)
        self.ticket_amount = QLineEdit("")
        self.ticket_amount.setPlaceholderText("Enter ticket amount")
        self.excess_option = QComboBox()
        self.excess_option.addItems(["", "SELF_PAID", "COMPANY_PAID", "LOAN"])
        self.tenure = QSpinBox()
        self.tenure.setRange(1, 60)
        self.tenure.setValue(6)
        self.origin = QLineEdit("")
        self.origin.setPlaceholderText("Origin airport")
        self.destination = QLineEdit("")
        self.destination.setPlaceholderText("Destination airport")

        self.lbl_scenario = QLabel("—")
        self.lbl_rate = QLabel("—")
        self.lbl_rate_source = QLabel("—")
        self.lbl_daily = QLabel("—")
        self.lbl_days = QLabel("—")
        self.lbl_entitlement = QLabel("—")
        self.lbl_excess = QLabel("—")
        self.lbl_emi = QLabel("—")
        self.lbl_join = QLabel("—")
        self.lbl_last_ticket = QLabel("—")
        self.lbl_opening = QLabel("—")
        self.lbl_status = QLabel(
            "Select an employee to load MSSQL entitlement (ATLAS MaxPayout ÷ 60)."
        )
        self.lbl_status.setWordWrap(True)

        for label in (
            self.lbl_scenario,
            self.lbl_rate,
            self.lbl_rate_source,
            self.lbl_daily,
            self.lbl_days,
            self.lbl_entitlement,
            self.lbl_excess,
            self.lbl_emi,
            self.lbl_join,
            self.lbl_last_ticket,
            self.lbl_opening,
        ):
            label.setStyleSheet(
                "QLabel { background:#edf5fc; border:1px solid #d2e4f3; padding:6px; }"
            )

        review = QFormLayout()
        review.addRow("Detected scenario", self.lbl_scenario)
        review.addRow("Applied MaxPayout", self.lbl_rate)
        review.addRow("Rate source", self.lbl_rate_source)
        review.addRow("Accrual factor (÷ 60)", self.lbl_daily)
        review.addRow("Accrued / days left", self.lbl_days)
        review.addRow("Final entitlement", self.lbl_entitlement)
        review.addRow("Excess cost", self.lbl_excess)
        review.addRow("EMI breakdown", self.lbl_emi)
        review.addRow("Join date", self.lbl_join)
        review.addRow("Last ticket", self.lbl_last_ticket)
        review.addRow("Opening BHD / days", self.lbl_opening)
        review_box = QGroupBox("Entitlement review (read-only, from MSSQL)")
        review_box.setLayout(review)

        form = QFormLayout()
        form.addRow("Employee", self.employee)
        form.addRow("As of date", self.as_of)
        form.addRow("Requested ticket amount", self.ticket_amount)
        form.addRow("Excess settlement", self.excess_option)
        form.addRow("Loan tenure months", self.tenure)
        form.addRow("Origin", self.origin)
        form.addRow("Destination", self.destination)
        form_box = QGroupBox("Issue inputs")
        form_box.setLayout(form)

        issue = QPushButton("Issue ticket")
        issue.clicked.connect(self.issue)
        refresh = QPushButton("Reload employees")
        refresh.clicked.connect(self.reload_employees)
        buttons = QHBoxLayout()
        buttons.addWidget(refresh)
        buttons.addWidget(issue)

        note = QLabel(
            "Engine matches ATLAS MSSQL: Daily_Rate = MaxPayout / 60, 30/360 working days, "
            "opening BHD seed. Hierarchy: Employee → Pay Group → Company → Global."
        )
        note.setWordWrap(True)

        layout = QVBoxLayout(self)
        layout.addWidget(note)
        layout.addWidget(form_box)
        layout.addWidget(review_box)
        layout.addLayout(buttons)
        layout.addWidget(self.lbl_status)
        layout.addStretch()

        self.employee.currentIndexChanged.connect(self.schedule_preview)
        self.as_of.dateChanged.connect(self.schedule_preview)
        self.ticket_amount.textChanged.connect(self.schedule_preview)
        self.excess_option.currentIndexChanged.connect(self.schedule_preview)
        self.tenure.valueChanged.connect(self.schedule_preview)

        self.reload_employees()

    def reload_employees(self) -> None:
        """Load employees from MSSQL via API into the combo box."""
        try:
            rows = self.api.get("/v1/employees?limit=500")
        except httpx.HTTPError as exc:
            QMessageBox.critical(self, "Employee load failed", str(exc))
            return
        self._employees = list(rows)
        self.employee.blockSignals(True)
        self.employee.clear()
        self.employee.addItem("Select employee", "")
        for row in self._employees:
            code = str(row.get("code") or "")
            name = str(row.get("full_name") or "")
            self.employee.addItem(f"{code} — {name}", str(row.get("id") or ""))
        self.employee.blockSignals(False)
        self.lbl_status.setText(f"Loaded {len(self._employees)} employees from MSSQL.")

    def _selected_employee_id(self) -> str | None:
        value = self.employee.currentData()
        text = str(value or "").strip()
        return text or None

    def _preview_payload(self) -> dict[str, object] | None:
        employee_id = self._selected_employee_id()
        if employee_id is None:
            return None
        payload: dict[str, object] = {
            "employee_id": employee_id,
            "as_of_date": self.as_of.date().toString("yyyy-MM-dd"),
        }
        ticket = self.ticket_amount.text().strip()
        if ticket:
            payload["requested_ticket_amount"] = ticket
        excess = self.excess_option.currentText().strip()
        if excess:
            payload["excess_option"] = excess
            if excess == "LOAN":
                payload["tenure_months"] = int(self.tenure.value())
        return payload

    def schedule_preview(self) -> None:
        """Auto preview on employee / date / ticket changes with generation guard."""
        payload = self._preview_payload()
        if payload is None:
            self._clear_review()
            self.lbl_status.setText("Select an employee to load MSSQL entitlement.")
            return
        self._preview_generation += 1
        generation = self._preview_generation
        if self._thread is not None and self._thread.isRunning():
            self._thread.requestInterruption()
            self._thread.quit()
            self._thread.wait(150)
        self.lbl_status.setText("Calculating entitlement from MSSQL…")
        self._thread = QThread(self)
        self._worker = AllocationPreviewWorker(self.api, payload)
        self._worker.moveToThread(self._thread)
        self._thread.started.connect(self._worker.run)

        def _on_ok(result: dict) -> None:
            if generation != self._preview_generation:
                return
            self._on_preview(result)

        def _on_err(message: str) -> None:
            if generation != self._preview_generation:
                return
            self._on_preview_failed(message)

        self._worker.finished.connect(_on_ok)
        self._worker.failed.connect(_on_err)
        self._worker.finished.connect(self._thread.quit)
        self._worker.failed.connect(self._thread.quit)
        self._thread.start()

    def _clear_review(self) -> None:
        self._latest = None
        for label in (
            self.lbl_scenario,
            self.lbl_rate,
            self.lbl_rate_source,
            self.lbl_daily,
            self.lbl_days,
            self.lbl_entitlement,
            self.lbl_excess,
            self.lbl_emi,
            self.lbl_join,
            self.lbl_last_ticket,
            self.lbl_opening,
        ):
            label.setText("—")

    @Slot(dict)
    def _on_preview(self, result: dict) -> None:
        self._latest = result
        scenario = str(result.get("scenario") or "—").replace("_", " ")
        join = result.get("join_date") or result.get("date_of_joining") or "—"
        last = result.get("last_ticket_date") or "none"
        self.lbl_scenario.setText(f"{scenario} · join {join} · last ticket {last}")
        self.lbl_rate.setText(str(result.get("airfare_rate") or result.get("maximum_payout") or "—"))
        self.lbl_rate_source.setText(str(result.get("rate_source") or "—"))
        self.lbl_daily.setText(str(result.get("daily_rate") or result.get("per_day_rate") or "—"))
        accrued = result.get("accrued_days") or result.get("current_year_earned_days") or "—"
        left = result.get("days_left") or result.get("eligible_balance_days") or "—"
        self.lbl_days.setText(f"{accrued} accrued · {left} left")
        self.lbl_entitlement.setText(
            str(result.get("final_entitlement_amount") or result.get("airfare_entitlement_amount") or "—")
        )
        excess = result.get("excess_cost") or "0"
        self.lbl_excess.setText(str(excess))
        emi = result.get("emi") or result.get("monthly_installment")
        tenure = result.get("tenure_months") or self.tenure.value()
        if emi:
            self.lbl_emi.setText(f"{emi} × {tenure} months")
        elif Decimal(str(excess)) > 0 and self.excess_option.currentText() == "LOAN":
            principal = Decimal(str(excess))
            months = max(1, int(self.tenure.value()))
            self.lbl_emi.setText(f"{(principal / months).quantize(Decimal('0.0001'))} × {months} months")
        else:
            self.lbl_emi.setText("—")
        self.lbl_join.setText(str(join))
        self.lbl_last_ticket.setText(str(result.get("last_ticket_date") or "—"))
        opening_amt = result.get("opening_balance_amount") or "0"
        opening_days = result.get("opening_balance_days") or "0"
        self.lbl_opening.setText(f"{opening_amt} BHD · {opening_days} days")
        self.lbl_status.setText("Entitlement auto-loaded from MSSQL (MaxPayout ÷ 60 · 30/360).")

    @Slot(str)
    def _on_preview_failed(self, message: str) -> None:
        self.lbl_status.setText(f"Preview failed: {message}")

    def issue(self) -> None:
        """Issue a ticket for the selected employee."""
        employee_id = self._selected_employee_id()
        if employee_id is None:
            QMessageBox.critical(self, "Issue failed", "Select an employee first.")
            return
        ticket = self.ticket_amount.text().strip()
        if not ticket:
            QMessageBox.critical(self, "Issue failed", "Enter a ticket amount.")
            return
        excess = Decimal(str((self._latest or {}).get("excess_cost") or "0"))
        option = self.excess_option.currentText().strip()
        if excess > 0 and not option:
            QMessageBox.critical(
                self,
                "Issue failed",
                "Ticket exceeds entitlement. Choose SELF_PAID, COMPANY_PAID, or LOAN.",
            )
            return
        payload: dict[str, object] = {
            "employee_id": employee_id,
            "as_of_date": self.as_of.date().toString("yyyy-MM-dd"),
            "requested_ticket_amount": ticket,
            "origin_code": self.origin.text().strip() or "ORG",
            "destination_code": self.destination.text().strip() or "DST",
        }
        if option:
            payload["excess_option"] = option
        if option == "LOAN":
            payload["tenure_months"] = int(self.tenure.value())
        try:
            result = self.api.post("/v1/allocations/issue", payload)
            self.lbl_status.setText(
                result.get("message")
                or (
                    f"Issued {result.get('ticket_code') or result.get('ticket_id')} · "
                    f"Final {result.get('final_entitlement_amount')} · "
                    f"Loan {result.get('loan_code') or result.get('loan_id') or '—'}"
                )
            )
            self.schedule_preview()
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            QMessageBox.critical(self, "Allocation issue failed", str(exc))
