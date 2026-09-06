"""Desktop analytics export screen (PDF / Excel via MSSQL-backed reports)."""

from __future__ import annotations

from pathlib import Path

import httpx
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

REPORTS: list[tuple[str, str]] = [
    ("airfare-payable", "Airfare Payable"),
    ("airfare-payable-summary", "Airfare Payable Summary"),
    ("airfare-payable-exceptions", "Airfare Payable Exceptions"),
    ("entitlement-balance-summary", "Entitlement Balance Summary"),
    ("booking-register", "Booking Register"),
    ("loan-recovery-ledger", "Loan Recovery Ledger"),
    ("liability-projections", "Liability Projections"),
    ("employee-master", "Employee Master"),
    ("opening-balances", "Opening Balances"),
    ("ticket-register", "Ticket Register"),
    ("loan-outstanding", "Loan Outstanding"),
    ("excess-recovery", "Excess Recovery"),
]


class ReportsToolsScreen(QWidget):
    """Export enterprise analytics from /v1/reports/export/*."""

    def __init__(self, api: object) -> None:
        super().__init__()
        self.api = api
        self.report = QComboBox()
        for report_id, label in REPORTS:
            self.report.addItem(label, report_id)
        self.status = QLabel("Select a report and export PDF or Excel from MSSQL.")
        self.status.setWordWrap(True)

        form = QFormLayout()
        form.addRow("Report", self.report)
        pdf = QPushButton("Export PDF")
        pdf.clicked.connect(lambda: self.export("pdf"))
        xlsx = QPushButton("Export Excel")
        xlsx.clicked.connect(lambda: self.export("xlsx"))
        row = QHBoxLayout()
        row.addWidget(pdf)
        row.addWidget(xlsx)

        layout = QVBoxLayout(self)
        layout.addWidget(
            QLabel(
                "Enterprise analytics read live MSSQL rows through the API. "
                "Aliases match Entitlement Balance, Booking Register, Loan Recovery, "
                "and Liability Projections."
            )
        )
        layout.addLayout(form)
        layout.addLayout(row)
        layout.addWidget(self.status)
        layout.addStretch()

    def export(self, extension: str) -> None:
        """Download a report file and save it locally."""
        report_id = str(self.report.currentData() or "")
        if not report_id:
            return
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Save report",
            f"{report_id}.{extension}",
            "PDF (*.pdf)" if extension == "pdf" else "Excel (*.xlsx)",
        )
        if not path:
            return
        try:
            client = getattr(self.api, "_client")
            token = getattr(self.api, "token")
            response = client.get(
                f"/v1/reports/export/{report_id}.{extension}",
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
            Path(path).write_bytes(response.content)
            self.status.setText(f"Saved {Path(path).name} ({len(response.content)} bytes).")
        except (httpx.HTTPError, OSError, AttributeError) as exc:
            QMessageBox.critical(self, "Export failed", str(exc))
