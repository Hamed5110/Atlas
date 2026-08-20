"""Role-aware JWT login dialog for the PySide6 desktop shell."""

from __future__ import annotations

import httpx
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QVBoxLayout,
)

ROLE_LABELS = {
    "SYSTEM_ADMIN": "Admin",
    "admin": "Admin",
    "HR_MANAGER": "Manager",
    "FINANCE_MANAGER": "Manager",
    "manager": "Manager",
    "hr": "Manager",
    "finance": "Manager",
    "EMPLOYEE": "Employee",
    "employee": "Employee",
}


def primary_role_label(roles: list[str] | set[str]) -> str:
    """Map API role codes to Admin / Manager / Employee."""
    normalized = {str(role) for role in roles}
    for code, label in (
        ("SYSTEM_ADMIN", "Admin"),
        ("admin", "Admin"),
        ("HR_MANAGER", "Manager"),
        ("FINANCE_MANAGER", "Manager"),
        ("manager", "Manager"),
        ("hr", "Manager"),
        ("finance", "Manager"),
    ):
        if code in normalized:
            return label
    if normalized & {"EMPLOYEE", "employee"}:
        return "Employee"
    return "User"


class LoginDialog(QDialog):
    """Collect credentials and authenticate against MSSQL-backed /v1/auth/login."""

    def __init__(self, api: object, parent: object | None = None) -> None:
        super().__init__(parent)  # type: ignore[arg-type]
        self.api = api
        self.profile: dict[str, object] = {}
        self.setWindowTitle("Sign in · ATLAS Airfare")
        self.setModal(True)
        self.resize(420, 220)

        self.username = QLineEdit("admin")
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        self.status = QLabel("Authenticate with MSSQL Users / Roles (JWT + bcrypt).")
        self.status.setWordWrap(True)

        form = QFormLayout()
        form.addRow("Username", self.username)
        form.addRow("Password", self.password)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self.authenticate)
        buttons.rejected.connect(self.reject)

        layout = QVBoxLayout(self)
        layout.addWidget(
            QLabel(
                "Roles: Admin · Manager · Employee — resolved from the JWT after login."
            )
        )
        layout.addLayout(form)
        layout.addWidget(self.status)
        layout.addWidget(buttons)

    def authenticate(self) -> None:
        """POST /v1/auth/login then load /v1/auth/me."""
        user = self.username.text().strip()
        password = self.password.text()
        if not user or not password:
            QMessageBox.warning(self, "Sign in", "Username and password are required.")
            return
        try:
            self.api.login(user, password)
            self.profile = self.api.get_object("/v1/auth/me")
            roles = self.profile.get("roles") or []
            label = primary_role_label(list(roles) if isinstance(roles, (list, set)) else [])
            self.status.setText(f"Signed in as {self.profile.get('username')} · {label}")
            self.accept()
        except httpx.HTTPError as exc:
            QMessageBox.critical(self, "Sign in failed", str(exc))
