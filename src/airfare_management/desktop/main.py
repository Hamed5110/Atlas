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
    QFormLayout,
    QHBoxLayout,
    QInputDialog,
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
            else os.environ.get("AIRFARE_API_BASE_URL", "http://127.0.0.1:3388")
        )
        self._client = httpx.Client(base_url=url, timeout=20.0)
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
        return list(response.json())

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

    def preview_entitlement(self, payload: dict[str, str | int]) -> dict[str, object]:
        """Request an entitlement preview.

        Args:
            payload: Validated screen values.

        Returns:
            JSON result.
        """
        response = self._client.post(
            "/v1/entitlements/preview",
            json=payload,
            headers={"Authorization": f"Bearer {self.token}"},
        )
        response.raise_for_status()
        return dict(response.json())


class AllocationEngineScreen(QWidget):
    """Native allocation engine screen with preview and ticket issue."""

    def __init__(self, api: ApiClient) -> None:
        """Build allocation engine controls."""
        super().__init__()
        self.api = api
        self.employee_id = QLineEdit()
        self.as_of = QDateEdit(QDate.currentDate())
        self.as_of.setCalendarPopup(True)
        self.ticket_amount = QLineEdit("0")
        self.custom_rate = QLineEdit()
        self.pay_group_rate = QLineEdit()
        self.global_rate = QLineEdit("150")
        self.cap_rate = QLineEdit()
        self.join_date = QDateEdit(QDate(2024, 1, 1))
        self.join_date.setCalendarPopup(True)
        self.last_ticket = QLineEdit()
        self.opening_days = QLineEdit("0")
        self.opening_amount = QLineEdit("0")
        self.excess_option = QComboBox()
        self.excess_option.addItems(["LOAN", "COMPANY_PAID", "SELF_PAID"])
        self.tenure = QSpinBox()
        self.tenure.setRange(1, 120)
        self.tenure.setValue(6)
        self.origin = QLineEdit("ORG")
        self.destination = QLineEdit("DST")
        self.result = QLabel("Enter values, then preview or issue.")
        self.result.setWordWrap(True)
        form = QFormLayout()
        form.addRow("Employee ID", self.employee_id)
        form.addRow("As of date", self.as_of)
        form.addRow("Date of joining", self.join_date)
        form.addRow("Last ticket date", self.last_ticket)
        form.addRow("Opening balance days", self.opening_days)
        form.addRow("Opening balance amount", self.opening_amount)
        form.addRow("Employee custom rate", self.custom_rate)
        form.addRow("Pay group rate", self.pay_group_rate)
        form.addRow("Global company rate", self.global_rate)
        form.addRow("Max entitlement cap", self.cap_rate)
        form.addRow("Requested ticket amount", self.ticket_amount)
        form.addRow("Excess option", self.excess_option)
        form.addRow("Loan tenure months", self.tenure)
        form.addRow("Origin", self.origin)
        form.addRow("Destination", self.destination)
        preview = QPushButton("Preview entitlement")
        preview.clicked.connect(self.preview)
        issue = QPushButton("Issue ticket")
        issue.clicked.connect(self.issue)
        buttons = QHBoxLayout()
        buttons.addWidget(preview)
        buttons.addWidget(issue)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addLayout(buttons)
        layout.addWidget(self.result)
        layout.addStretch()

    def _optional_text(self, widget: QLineEdit) -> str | None:
        """Return stripped text or None when blank."""
        text = widget.text().strip()
        return text or None

    def _preview_payload(self) -> dict[str, object]:
        """Build a preview JSON payload from the form."""
        payload: dict[str, object] = {
            "as_of_date": self.as_of.date().toString("yyyy-MM-dd"),
            "requested_ticket_amount": self.ticket_amount.text().strip() or "0",
            "excess_option": self.excess_option.currentText(),
        }
        if self.excess_option.currentText() == "LOAN":
            payload["tenure_months"] = int(self.tenure.value())
        employee_id = self._optional_text(self.employee_id)
        if employee_id is not None:
            payload["employee_id"] = employee_id
        else:
            payload.update(
                {
                    "date_of_joining": self.join_date.date().toString("yyyy-MM-dd"),
                    "opening_balance_days": self.opening_days.text().strip() or "0",
                    "opening_balance_amount": self.opening_amount.text().strip() or "0",
                }
            )
            last_ticket = self._optional_text(self.last_ticket)
            if last_ticket is not None:
                payload["last_ticket_date"] = last_ticket
            custom_rate = self._optional_text(self.custom_rate)
            if custom_rate is not None:
                payload["employee_custom_rate"] = custom_rate
            pay_group_rate = self._optional_text(self.pay_group_rate)
            if pay_group_rate is not None:
                payload["pay_group_rate"] = pay_group_rate
            global_rate = self._optional_text(self.global_rate)
            if global_rate is not None:
                payload["global_company_preference_rate"] = global_rate
            cap_rate = self._optional_text(self.cap_rate)
            if cap_rate is not None:
                payload["max_entitlement_cap_rate"] = cap_rate
        return payload

    def preview(self) -> None:
        """Call the allocation preview API."""
        try:
            result = self.api.post("/v1/allocations/preview", self._preview_payload())
            self.result.setText(
                "Scenario {scenario}  Days {accrued_days}  Rate {airfare_rate} "
                "({rate_source})  Daily {daily_rate}  Calculated "
                "{calculated_entitlement_amount}  Final {final_entitlement_amount}  "
                "Excess {excess_cost}  Company {company_payout}  "
                "Employee {employee_payable}  EMI {emi}".format(
                    scenario=result.get("scenario"),
                    accrued_days=result.get("accrued_days"),
                    airfare_rate=result.get("airfare_rate"),
                    rate_source=result.get("rate_source"),
                    daily_rate=result.get("daily_rate"),
                    calculated_entitlement_amount=result.get("calculated_entitlement_amount"),
                    final_entitlement_amount=result.get("final_entitlement_amount"),
                    excess_cost=result.get("excess_cost"),
                    company_payout=result.get("company_payout"),
                    employee_payable=result.get("employee_payable"),
                    emi=result.get("emi"),
                )
            )
        except (ValueError, httpx.HTTPError, KeyError) as exc:
            QMessageBox.critical(self, "Allocation preview failed", str(exc))

    def issue(self) -> None:
        """Issue a ticket through the allocation engine API."""
        employee_id = self._optional_text(self.employee_id)
        if employee_id is None:
            QMessageBox.critical(self, "Issue failed", "Employee ID is required to issue a ticket.")
            return
        payload: dict[str, object] = {
            "employee_id": employee_id,
            "as_of_date": self.as_of.date().toString("yyyy-MM-dd"),
            "requested_ticket_amount": self.ticket_amount.text().strip() or "0",
            "excess_option": self.excess_option.currentText(),
            "origin_code": self.origin.text().strip() or "ORG",
            "destination_code": self.destination.text().strip() or "DST",
        }
        if self.excess_option.currentText() == "LOAN":
            payload["tenure_months"] = int(self.tenure.value())
        try:
            result = self.api.post("/v1/allocations/issue", payload)
            self.result.setText(
                f"Issued ticket {result.get('ticket_id')}  "
                f"Scenario {result.get('scenario')}  "
                f"Final {result.get('final_entitlement_amount')}  "
                f"Company {result.get('company_payout')}  "
                f"Employee {result.get('employee_payable')}  "
                f"Loan {result.get('loan_id')}"
            )
        except (ValueError, httpx.HTTPError, KeyError) as exc:
            QMessageBox.critical(self, "Allocation issue failed", str(exc))


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
        if not username or not password:
            username, accepted = QInputDialog.getText(self, "Sign in", "Username:", text="admin")
            if not accepted:
                raise SystemExit(0)
            password, accepted = QInputDialog.getText(
                self, "Sign in", "Password:", QLineEdit.EchoMode.Password
            )
            if not accepted:
                raise SystemExit(0)
        try:
            api.login(username, password)
        except httpx.HTTPError as exc:
            QMessageBox.critical(self, "Sign in failed", str(exc))
            raise SystemExit(1) from exc
        navigation = QListWidget()
        stack = QStackedWidget()
        screens: list[tuple[str, QWidget]] = [
            ("Dashboard", DashboardScreen(api)),
            (
                "Employees & Import",
                ModuleTableScreen(
                    "Employees",
                    ["Code", "Name", "Company"],
                    api,
                    "/v1/employees",
                    ["code", "full_name", "company_id"],
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
            ("Airfare Entitlement", EntitlementScreen(api)),
            ("Airfare Allocation Engine", AllocationEngineScreen(api)),
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
                "Reports & Export",
                ModuleTableScreen(
                    "Entitlement Rates",
                    ["Scope", "Amount", "Effective From"],
                    api,
                    "/v1/entitlement-rates",
                    ["scope_type", "amount", "effective_from"],
                ),
            ),
            (
                "ESS & Workflows",
                ModuleTableScreen(
                    "Self Service",
                    ["Type", "Travel Date", "Route", "Status"],
                    api,
                    "/v1/ess/requests",
                    ["request_type", "travel_date", "origin_code", "status"],
                ),
            ),
            (
                "Administration",
                ModuleTableScreen(
                    "Departments",
                    ["Code", "Name", "Active"],
                    api,
                    "/v1/lookups/departments",
                    ["code", "name", "active"],
                ),
            ),
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
