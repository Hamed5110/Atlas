"""MSSQL-backed lookup maintenance for desktop Administration."""

from __future__ import annotations

import httpx
from PySide6.QtWidgets import (
    QComboBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

LOOKUP_TYPES = [
    "departments",
    "pay_groups",
    "designations",
    "sub_sections",
    "nationalities",
    "repair_centers",
]


class LookupsAdminScreen(QWidget):
    """Load and create lookup values from /v1/lookups/{type} (MSSQL)."""

    def __init__(self, api: object) -> None:
        super().__init__()
        self.api = api
        self.lookup_type = QComboBox()
        self.lookup_type.addItems(LOOKUP_TYPES)
        self.table = QTableWidget(0, 3)
        self.table.setHorizontalHeaderLabels(["Code", "Name", "Active"])
        self.code = QLineEdit()
        self.name = QLineEdit()
        self.status = QLabel("Lookups load from MSSQL. No static catalog arrays.")

        form = QFormLayout()
        form.addRow("Lookup type", self.lookup_type)
        form.addRow("Code", self.code)
        form.addRow("Name", self.name)

        reload_btn = QPushButton("Reload from MSSQL")
        reload_btn.clicked.connect(self.reload)
        create_btn = QPushButton("Create lookup")
        create_btn.clicked.connect(self.create_lookup)
        row = QHBoxLayout()
        row.addWidget(reload_btn)
        row.addWidget(create_btn)

        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addLayout(row)
        layout.addWidget(self.table)
        layout.addWidget(self.status)

        self.lookup_type.currentIndexChanged.connect(self.reload)
        self.reload()

    def reload(self) -> None:
        """GET /v1/lookups/{type}."""
        lookup_type = self.lookup_type.currentText()
        try:
            rows = self.api.get(f"/v1/lookups/{lookup_type}")
        except httpx.HTTPError as exc:
            QMessageBox.critical(self, "Lookups", str(exc))
            return
        self.table.setRowCount(0)
        for row in rows:
            index = self.table.rowCount()
            self.table.insertRow(index)
            self.table.setItem(index, 0, QTableWidgetItem(str(row.get("code") or "")))
            self.table.setItem(index, 1, QTableWidgetItem(str(row.get("name") or "")))
            self.table.setItem(
                index, 2, QTableWidgetItem("Yes" if row.get("active") else "No")
            )
        self.status.setText(f"Loaded {len(rows)} {lookup_type} from MSSQL.")

    def create_lookup(self) -> None:
        """POST /v1/lookups/{type}."""
        lookup_type = self.lookup_type.currentText()
        payload = {
            "code": self.code.text().strip(),
            "name": self.name.text().strip(),
            "active": True,
        }
        if not payload["code"] or not payload["name"]:
            QMessageBox.warning(self, "Lookups", "Code and name are required.")
            return
        try:
            self.api.post(f"/v1/lookups/{lookup_type}", payload)
            self.code.clear()
            self.name.clear()
            self.reload()
        except httpx.HTTPError as exc:
            QMessageBox.critical(self, "Create failed", str(exc))
