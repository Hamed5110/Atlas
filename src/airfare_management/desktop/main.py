"""Native PySide6 desktop shell for operational modules."""

import os
import sys
from decimal import Decimal

import httpx
from PySide6.QtCore import QAbstractTableModel, QDate, QModelIndex, QPersistentModelIndex, Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QDateEdit,
    QDialog,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QStackedWidget,
    QTableView,
    QVBoxLayout,
    QWidget,
)

from airfare_management.desktop.allocation import AllocationEngineScreen
from airfare_management.desktop.ess_portal import EssPortalScreen
from airfare_management.desktop.login import LoginDialog, primary_role_label
from airfare_management.desktop.loans_tools import LoanToolsScreen
from airfare_management.desktop.lookups_admin import LookupsAdminScreen
from airfare_management.desktop.reports_tools import ReportsToolsScreen

EMPTY_INDEX = QModelIndex()


class RecordTableModel(QAbstractTableModel):
    """Generic read-only model with conditional warning-row formatting."""

    def __init__(self, headers: list[str], rows: list[list[object]] | None = None) -> None:
        """Initialize table data.

        Args:
            headers: Display column names.
            rows: Initial records.
        """
        super().__init__()
        self.headers = headers
        self.rows = rows or []

    def replace(self, rows: list[list[object]]) -> None:
        """Replace all displayed rows atomically."""
        self.beginResetModel()
        self.rows = rows
        self.endResetModel()

    def rowCount(self, parent: QModelIndex | QPersistentModelIndex = EMPTY_INDEX) -> int:
        """Return visible row count."""
        return 0 if parent.isValid() else len(self.rows)

    def columnCount(self, parent: QModelIndex | QPersistentModelIndex = EMPTY_INDEX) -> int:
        """Return visible column count."""
        return 0 if parent.isValid() else len(self.headers)

    def data(
        self,
        index: QModelIndex | QPersistentModelIndex,
        role: int = Qt.ItemDataRole.DisplayRole,
    ) -> object:
        """Return display and conditional-formatting data."""
        if not index.isValid():
            return None
        value = self.rows[index.row()][index.column()]
        if role == Qt.ItemDataRole.DisplayRole:
            return str(value)
        if role == Qt.ItemDataRole.BackgroundRole and any(
            str(cell).lower() in {"overdue", "excess", "rejected"}
            for cell in self.rows[index.row()]
        ):
            return QColor("#fff1f0")
        if role == Qt.ItemDataRole.TextAlignmentRole and isinstance(value, (int, Decimal)):
            return Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        return None

    def headerData(
        self, section: int, orientation: Qt.Orientation, role: int = Qt.ItemDataRole.DisplayRole
    ) -> object:
        """Return horizontal header labels."""
        if role == Qt.ItemDataRole.DisplayRole and orientation == Qt.Orientation.Horizontal:
            return self.headers[section]
        return super().headerData(section, orientation, role)


class ApiClient:
    """Small synchronous API adapter used by desktop screens."""

    def __init__(self, base_url: str | None = None) -> None:
        """Initialize the HTTP client."""
        url: str = (
            base_url
            if base_url is not None
            else os.environ.get("AIRFARE_API_BASE_URL", "http://127.0.0.1:3389")
        )
        self._client = httpx.Client(base_url=url, timeout=30.0)
        self.token = ""

    def login(self, username: str, password: str) -> None:
        """Authenticate and retain a short-lived access token."""
        response = self._client.post(
            "/v1/auth/login", json={"username": username, "password": password}
        )
        response.raise_for_status()
        self.token = str(response.json()["access_token"])

    def get(self, path: str) -> list[dict[str, object]]:
        """Fetch a list endpoint with the current identity."""
        response = self._client.get(path, headers={"Authorization": f"Bearer {self.token}"})
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, list):
            return list(payload)
        if isinstance(payload, dict) and "items" in payload:
            return list(payload["items"])
        return [dict(payload)]

    def get_object(self, path: str) -> dict[str, object]:
        """Fetch an object endpoint with the current identity."""
        response = self._client.get(path, headers={"Authorization": f"Bearer {self.token}"})
        response.raise_for_status()
        return dict(response.json())

    def post(self, path: str, payload: dict[str, object]) -> dict[str, object]:
        """Create a record through the API."""
        response = self._client.post(
            path,
            json=payload,
            headers={"Authorization": f"Bearer {self.token}"},
        )
        response.raise_for_status()
        return dict(response.json())

    def post_with_match(
        self, path: str, payload: dict[str, object], *, if_match: int
    ) -> dict[str, object]:
        """POST with optimistic concurrency If-Match header."""
        response = self._client.post(
            path,
            json=payload,
            headers={
                "Authorization": f"Bearer {self.token}",
                "If-Match": str(if_match),
            },
        )
        response.raise_for_status()
        body = response.json()
        return dict(body) if isinstance(body, dict) else {"ok": True}

    def preview_entitlement(self, payload: dict[str, str | int]) -> dict[str, object]:
        """Request a legacy entitlement preview (what-if calculator)."""
        response = self._client.post(
            "/v1/entitlements/preview",
            json=payload,
            headers={"Authorization": f"Bearer {self.token}"},
        )
        response.raise_for_status()
        return dict(response.json())


class EntitlementScreen(QWidget):
    """Functional entitlement calculator screen."""

    def __init__(self, api: ApiClient) -> None:
        """Build calculator controls."""
        super().__init__()
        self.api = api
        self.inputs = {
            "opening_days": QLineEdit("0"),
            "current_working_days": QLineEdit("360"),
            "paid_days": QLineEdit("0"),
            "maximum_payout": QLineEdit("150"),
        }
        form = QFormLayout()
        for name, widget in self.inputs.items():
            form.addRow(name.replace("_", " ").title(), widget)
        self.result = QLabel("Enter values and calculate.")
        note = QLabel(
            "Web clients should use Airfare Allocation for live entitlement review and ticket issue."
        )
        note.setWordWrap(True)
        button = QPushButton("Calculate entitlement")
        button.clicked.connect(self.calculate)
        layout = QVBoxLayout(self)
        layout.addWidget(note)
        layout.addLayout(form)
        layout.addWidget(button)
        layout.addWidget(self.result)
        layout.addStretch()

    def calculate(self) -> None:
        """Call the API and show a formatted result."""
        try:
            payload: dict[str, str | int] = {
                key: int(widget.text()) if key == "current_working_days" else widget.text()
                for key, widget in self.inputs.items()
            }
            result = self.api.preview_entitlement(payload)
            self.result.setText(f"Days: {result['remaining_days']}   Payable: {result['payable']}")
        except (ValueError, httpx.HTTPError, KeyError) as exc:
            QMessageBox.critical(self, "Calculation failed", str(exc))


class DashboardScreen(QWidget):
    """Live operational dashboard backed by the API."""

    def __init__(self, api: ApiClient) -> None:
        """Build dashboard metrics and refresh control."""
        super().__init__()
        self.api = api
        self.metrics = QLabel()
        refresh = QPushButton("Refresh dashboard")
        refresh.clicked.connect(self.refresh)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Operational Dashboard"))
        layout.addWidget(self.metrics)
        layout.addWidget(refresh)
        layout.addStretch()
        self.refresh()

    def refresh(self) -> None:
        """Load current dashboard counters."""
        try:
            data = self.api.get_object("/v1/dashboard")
            self.metrics.setText(
                "\n".join(
                    (
                        f"Employees: {data.get('employees', 0)}",
                        f"Open tickets: {data.get('open_tickets', 0)}",
                        f"Active loans: {data.get('active_loans', 0)}",
                        f"Outstanding: {data.get('outstanding_loans', 0)}",
                    )
                )
            )
        except httpx.HTTPError as exc:
            QMessageBox.critical(self, "Dashboard failed", str(exc))


class PreferenceScreen(QWidget):
    """Editable user theme preference screen."""

    def __init__(self, api: ApiClient) -> None:
        """Build effective-preference controls."""
        super().__init__()
        self.api = api
        self.theme = QComboBox()
        self.theme.addItems(["light", "dark"])
        self.values = QLabel()
        save = QPushButton("Save user theme")
        save.clicked.connect(self.save)
        refresh = QPushButton("Refresh")
        refresh.clicked.connect(self.refresh)
        form = QFormLayout()
        form.addRow("Theme", self.theme)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(save)
        layout.addWidget(refresh)
        layout.addWidget(self.values)
        layout.addStretch()
        self.refresh()

    def refresh(self) -> None:
        """Load effective preferences."""
        try:
            data = self.api.get_object("/v1/preferences/effective")
            self.theme.setCurrentText(str(data.get("theme", "light")))
            self.values.setText("\n".join(f"{key}: {value}" for key, value in data.items()))
        except httpx.HTTPError as exc:
            QMessageBox.critical(self, "Preferences failed", str(exc))

    def save(self) -> None:
        """Persist the selected user preference."""
        try:
            identity = self.api.get_object("/v1/auth/me")
            self.api._client.put(
                "/v1/preferences",
                json={
                    "scope_type": "user",
                    "scope_id": str(identity["id"]),
                    "preference_key": "theme",
                    "value": self.theme.currentText(),
                },
                headers={"Authorization": f"Bearer {self.api.token}"},
            ).raise_for_status()
            self.refresh()
        except httpx.HTTPError as exc:
            QMessageBox.critical(self, "Save failed", str(exc))


class ModuleTableScreen(QWidget):
    """Operational table screen shared by register-style modules."""

    def __init__(
        self,
        title: str,
        headers: list[str],
        api: ApiClient | None = None,
        path: str | None = None,
        fields: list[str] | None = None,
    ) -> None:
        """Build a searchable table screen."""
        super().__init__()
        layout = QVBoxLayout(self)
        heading = QLabel(title)
        heading_font = heading.font()
        heading_font.setPointSize(18)
        heading_font.setBold(True)
        heading.setFont(heading_font)
        layout.addWidget(heading)
        search = QLineEdit()
        search.setPlaceholderText("Filter records")
        layout.addWidget(search)
        table = QTableView()
        self.model = RecordTableModel(headers)
        table.setModel(self.model)
        table.setAlternatingRowColors(True)
        table.horizontalHeader().setStretchLastSection(True)
        layout.addWidget(table)
        if api is not None and path is not None:
            refresh = QPushButton("Refresh")
            refresh.clicked.connect(
                lambda: self.refresh(api, path, fields or [header.lower() for header in headers])
            )
            layout.addWidget(refresh)

    def refresh(self, api: ApiClient, path: str, fields: list[str]) -> None:
        """Load current records from an API list endpoint."""
        try:
            records = api.get(path)
            self.model.replace([[record.get(field, "") for field in fields] for record in records])
        except httpx.HTTPError as exc:
            QMessageBox.critical(self, "Refresh failed", str(exc))


class MainWindow(QMainWindow):
    """Main native desktop workspace with all mandated module entries."""

    def __init__(self) -> None:
        """Compose navigation and functional module screens."""
        super().__init__()
        self.setWindowTitle("ATLAS Airfare Management")
        self.resize(1280, 800)
        api = ApiClient()
        username = os.environ.get("AIRFARE_USERNAME", "").strip()
        password = os.environ.get("AIRFARE_PASSWORD", "")
        profile: dict[str, object] = {}
        if username and password:
            try:
                api.login(username, password)
                profile = api.get_object("/v1/auth/me")
            except httpx.HTTPError as exc:
                QMessageBox.critical(self, "Sign in failed", str(exc))
                raise SystemExit(1) from exc
        else:
            dialog = LoginDialog(api, self)
            if dialog.exec() != QDialog.DialogCode.Accepted:
                raise SystemExit(0)
            profile = dialog.profile
        role = primary_role_label(list(profile.get("roles") or []))  # type: ignore[arg-type]
        self.setWindowTitle(
            f"ATLAS Airfare Management · {profile.get('username')} ({role})"
        )
        navigation = QListWidget()
        stack = QStackedWidget()
        screens: list[tuple[str, QWidget]] = [
            ("Dashboard", DashboardScreen(api)),
            (
                "Employees & Import",
                ModuleTableScreen(
                    "Employees",
                    ["Code", "Name", "Department", "Pay Group", "Designation"],
                    api,
                    "/v1/employees",
                    ["code", "full_name", "department", "pay_group", "designation"],
                ),
            ),
            (
                "Opening Balances",
                ModuleTableScreen(
                    "Opening Balances",
                    ["Employee", "Year", "Days", "Amount"],
                    api,
                    "/v1/opening-balances",
                    ["employee_id", "balance_year", "opening_days", "opening_amount"],
                ),
            ),
            ("Airfare Allocation Engine", AllocationEngineScreen(api)),
            ("Loans · Defer & Batch Settle", LoanToolsScreen(api)),
            ("Analytics · Export", ReportsToolsScreen(api)),
            (
                "Tickets & Excess",
                ModuleTableScreen(
                    "Tickets",
                    ["Employee", "Cost", "Excess", "Status"],
                    api,
                    "/v1/tickets",
                    ["employee_id", "ticket_cost", "excess_amount", "status"],
                ),
            ),
            (
                "Loans & EMI",
                ModuleTableScreen(
                    "Loans",
                    ["Employee", "Principal", "EMI", "Status"],
                    api,
                    "/v1/loans",
                    ["employee_id", "principal", "monthly_installment", "status"],
                ),
            ),
            ("Preferences", PreferenceScreen(api)),
            (
                "Reports & Rates",
                ModuleTableScreen(
                    "Entitlement Rates",
                    ["Scope", "Amount", "Effective From"],
                    api,
                    "/v1/entitlement-rates",
                    ["scope_type", "amount", "effective_from"],
                ),
            ),
            ("ESS Portal", EssPortalScreen(api)),
            ("Lookups (MSSQL)", LookupsAdminScreen(api)),
        ]
        for name, screen in screens:
            navigation.addItem(name)
            stack.addWidget(screen)
        navigation.currentRowChanged.connect(stack.setCurrentIndex)
        navigation.setCurrentRow(0)
        root = QWidget()
        layout = QHBoxLayout(root)
        layout.addWidget(navigation, 1)
        layout.addWidget(stack, 5)
        self.setCentralWidget(root)


def run() -> None:
    """Start the native desktop event loop."""
    application = QApplication(sys.argv)
    if os.environ.get("AIRFARE_THEME", "light").lower() == "dark":
        application.setStyleSheet(
            "QWidget { background:#172735; color:#e8f0f6; } "
            "QLineEdit,QTableView,QComboBox { background:#0e1b26; }"
        )
    window = MainWindow()
    window.show()
    raise SystemExit(application.exec())


if __name__ == "__main__":
    run()
