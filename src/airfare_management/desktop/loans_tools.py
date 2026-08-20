"""Native loan deferment and bulk settlement tools (MSSQL-backed)."""

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
    QSpinBox,
    QVBoxLayout,
    QWidget,
)


class LoanToolsScreen(QWidget):
    """Defer one loan or settle multiple loans in a single API batch."""

    def __init__(self, api: object) -> None:
        super().__init__()
        self.api = api
        self._loans: list[dict[str, object]] = []

        self.loan = QComboBox()
        self.defer_until = QDateEdit(QDate.currentDate().addMonths(1))
        self.defer_until.setCalendarPopup(True)
        self.restructure_months = QSpinBox()
        self.restructure_months.setRange(1, 60)
        self.restructure_months.setValue(6)
        self.settle_paid_on = QDateEdit(QDate.currentDate())
        self.settle_paid_on.setCalendarPopup(True)
        self.settle_reference = QLineEdit("BATCH-SETTLE")
        self.status = QLabel("Load loans from MSSQL, then defer or settle.")
        self.status.setWordWrap(True)

        defer_box = QGroupBox("Defer / restructure")
        defer_form = QFormLayout(defer_box)
        defer_form.addRow("Loan", self.loan)
        defer_form.addRow("Defer until", self.defer_until)
        defer_form.addRow("Restructure months", self.restructure_months)
        defer_btn = QPushButton("Defer selected loan")
        defer_btn.clicked.connect(self.defer_selected)
        restructure_btn = QPushButton("Restructure EMI")
        restructure_btn.clicked.connect(self.restructure_selected)
        defer_row = QHBoxLayout()
        defer_row.addWidget(defer_btn)
        defer_row.addWidget(restructure_btn)
        defer_form.addRow(defer_row)

        settle_box = QGroupBox("Batch settle outstanding loans")
        settle_form = QFormLayout(settle_box)
        settle_form.addRow("Paid on", self.settle_paid_on)
        settle_form.addRow("Reference", self.settle_reference)
        settle_btn = QPushButton("Settle ALL active loans for exact outstanding")
        settle_btn.clicked.connect(self.bulk_settle_active)
        settle_form.addRow(settle_btn)

        reload = QPushButton("Reload loans from MSSQL")
        reload.clicked.connect(self.reload_loans)

        layout = QVBoxLayout(self)
        layout.addWidget(
            QLabel(
                "Loan deferment and atomic bulk settlement use /v1/loans/* against MSSQL. "
                "Settlement amounts must match outstanding exactly."
            )
        )
        layout.addWidget(reload)
        layout.addWidget(defer_box)
        layout.addWidget(settle_box)
        layout.addWidget(self.status)
        layout.addStretch()
        self.reload_loans()

    def reload_loans(self) -> None:
        """Refresh active/deferred loans from the API."""
        try:
            rows = self.api.get("/v1/loans?limit=500")
        except httpx.HTTPError as exc:
            QMessageBox.critical(self, "Loan load failed", str(exc))
            return
        self._loans = [
            row
            for row in rows
            if str(row.get("status") or "") in {"active", "deferred"}
        ]
        self.loan.clear()
        for row in self._loans:
            label = (
                f"{row.get('loan_code') or row.get('id')} · "
                f"{row.get('employee_label') or row.get('employee_id')} · "
                f"outstanding {row.get('outstanding')}"
            )
            self.loan.addItem(label, row)
        self.status.setText(f"Loaded {len(self._loans)} active/deferred loans from MSSQL.")

    def _selected(self) -> dict[str, object] | None:
        data = self.loan.currentData()
        return dict(data) if isinstance(data, dict) else None

    def defer_selected(self) -> None:
        """POST /v1/loans/{id}/defer."""
        row = self._selected()
        if row is None:
            QMessageBox.warning(self, "Defer", "Select a loan.")
            return
        loan_id = str(row["id"])
        version = int(row.get("version") or 1)
        payload = {"deferred_until": self.defer_until.date().toString("yyyy-MM-dd")}
        try:
            self.api.post_with_match(
                f"/v1/loans/{loan_id}/defer", payload, if_match=version
            )
            self.status.setText(f"Deferred loan {row.get('loan_code') or loan_id}.")
            self.reload_loans()
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            QMessageBox.critical(self, "Defer failed", str(exc))

    def restructure_selected(self) -> None:
        """POST /v1/loans/{id}/restructure."""
        row = self._selected()
        if row is None:
            QMessageBox.warning(self, "Restructure", "Select a loan.")
            return
        loan_id = str(row["id"])
        version = int(row.get("version") or 1)
        payload = {
            "annual_rate": str(row.get("annual_rate") or "0"),
            "installments": int(self.restructure_months.value()),
            "first_due_date": date.today().isoformat(),
        }
        try:
            self.api.post_with_match(
                f"/v1/loans/{loan_id}/restructure", payload, if_match=version
            )
            self.status.setText(
                f"Restructured loan {row.get('loan_code') or loan_id} to "
                f"{self.restructure_months.value()} months."
            )
            self.reload_loans()
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            QMessageBox.critical(self, "Restructure failed", str(exc))

    def bulk_settle_active(self) -> None:
        """POST /v1/loans/bulk-settle for every active loan outstanding."""
        if not self._loans:
            QMessageBox.information(self, "Settle", "No active loans to settle.")
            return
        paid_on = self.settle_paid_on.date().toString("yyyy-MM-dd")
        reference = self.settle_reference.text().strip() or f"BATCH-{date.today().isoformat()}"
        items = [
            {
                "loan_id": str(row["id"]),
                "amount": str(row["outstanding"]),
                "paid_on": paid_on,
                "reference": reference,
            }
            for row in self._loans
            if str(row.get("status")) == "active"
        ]
        if not items:
            QMessageBox.information(self, "Settle", "No active (non-deferred) loans.")
            return
        confirm = QMessageBox.question(
            self,
            "Confirm bulk settle",
            f"Settle {len(items)} loan(s) for exact outstanding amounts?",
        )
        if confirm != QMessageBox.StandardButton.Yes:
            return
        try:
            result = self.api.post("/v1/loans/bulk-settle", {"items": items})
            self.status.setText(f"Settled {result.get('settled')} loan(s).")
            self.reload_loans()
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            QMessageBox.critical(self, "Bulk settle failed", str(exc))
