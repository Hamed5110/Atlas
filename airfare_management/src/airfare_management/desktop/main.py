"""Native PySide6 desktop shell for operational modules."""

import sys
from decimal import Decimal

import httpx
from PySide6.QtCore import QAbstractTableModel, QModelIndex, QPersistentModelIndex, Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QApplication,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QMainWindow,
    QMessageBox,
    QPushButton,
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

    def __init__(self, base_url: str = "http://127.0.0.1:8000") -> None:
        """Initialize the HTTP client."""
        self._client = httpx.Client(base_url=base_url, timeout=10.0)
        self.token = ""

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
        button = QPushButton("Calculate entitlement")
        button.clicked.connect(self.calculate)
        layout = QVBoxLayout(self)
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


class ModuleTableScreen(QWidget):
    """Operational table screen shared by register-style modules."""

    def __init__(self, title: str, headers: list[str]) -> None:
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
        table.setModel(RecordTableModel(headers))
        table.setAlternatingRowColors(True)
        table.horizontalHeader().setStretchLastSection(True)
        layout.addWidget(table)


class MainWindow(QMainWindow):
    """Main native desktop workspace with all mandated module entries."""

    def __init__(self) -> None:
        """Compose navigation and functional module screens."""
        super().__init__()
        self.setWindowTitle("ATLAS Airfare Management")
        self.resize(1280, 800)
        api = ApiClient()
        navigation = QListWidget()
        stack = QStackedWidget()
        screens: list[tuple[str, QWidget]] = [
            ("Dashboard", ModuleTableScreen("Dashboard", ["Metric", "Value", "Status"])),
            ("Employees & Import", ModuleTableScreen("Employees", ["Code", "Name", "Company"])),
            (
                "Opening Balances",
                ModuleTableScreen("Opening Balances", ["Employee", "Year", "Days", "Amount"]),
            ),
            ("Airfare Entitlement", EntitlementScreen(api)),
            (
                "Tickets & Excess",
                ModuleTableScreen("Tickets", ["Employee", "Cost", "Excess", "Status"]),
            ),
            ("Loans & EMI", ModuleTableScreen("Loans", ["Employee", "Principal", "EMI", "Status"])),
            ("Preferences", ModuleTableScreen("Preferences", ["Scope", "Key", "Effective Value"])),
            ("Reports & Export", ModuleTableScreen("Reports", ["Report", "Format", "Last Run"])),
            ("ESS & Workflows", ModuleTableScreen("Self Service", ["Request", "Owner", "Status"])),
            (
                "Administration",
                ModuleTableScreen("Administration", ["Operation", "State", "Last Run"]),
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
    window = MainWindow()
    window.show()
    raise SystemExit(application.exec())
