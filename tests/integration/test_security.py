"""Security integration tests for injection, auth, uploads, and IDOR."""

from __future__ import annotations

from io import BytesIO
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from airfare_management.config import Settings
from airfare_management.infrastructure.documents import EMPLOYEE_COLUMNS, export_workbook
from airfare_management.infrastructure.security import issue_access_token
from tests.helpers import create_employee, ensure_company

pytestmark = pytest.mark.integration


def test_sql_injection_search_returns_empty_not_500(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.get(
        "/v1/employees",
        headers=admin_headers,
        params={"search": "'; DROP TABLE employees;--"},
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_xss_employee_name_stored_as_plain_text(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    payload_name = "<script>alert(1)</script>"
    employee = create_employee(client, admin_headers, full_name=payload_name)
    assert employee["full_name"] == payload_name


def test_formula_injection_prefixed_in_excel_export() -> None:
    from io import BytesIO

    from openpyxl import load_workbook

    from airfare_management.infrastructure.documents import export_workbook

    workbook_bytes = export_workbook(
        "Employees",
        ("full_name",),
        [{"full_name": "=CMD|' /C calc'!A0"}],
    )
    sheet = load_workbook(BytesIO(workbook_bytes)).active
    assert sheet is not None
    assert str(sheet["A2"].value).startswith("'=")


def test_jwt_tampering_returns_401(client: TestClient) -> None:
    bad = issue_access_token(uuid4(), {"admin"}, Settings(jwt_secret="e" * 32))
    parts = bad.split(".")
    parts[1] = parts[1][::-1]
    response = client.get(
        "/v1/auth/me",
        headers={"Authorization": f"Bearer {'.'.join(parts)}"},
    )
    assert response.status_code == 401


def test_expired_jwt_returns_401() -> None:
    from datetime import UTC, datetime, timedelta

    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="f" * 32,
        access_token_minutes=5,
    )
    past = datetime.now(UTC) - timedelta(hours=2)
    token = issue_access_token(uuid4(), {"admin"}, settings, now=past)
    from airfare_management.api.main import create_app

    client = TestClient(create_app(settings))
    response = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_revoked_refresh_after_logout(client: TestClient) -> None:
    login = client.post(
        "/v1/auth/login",
        json={"username": "admin", "password": "StrongPassword!2026"},
    )
    tokens = login.json()
    client.post("/v1/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    refresh = client.post("/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh.status_code == 401


def test_exe_upload_rejected(client: TestClient, admin_headers: dict[str, str]) -> None:
    employee = create_employee(client, admin_headers)
    response = client.post(
        f"/v1/attachments?entity_type=employee&entity_id={employee['id']}",
        headers=admin_headers,
        files={"file": ("malware.exe", b"MZ", "application/x-msdownload")},
    )
    assert response.status_code == 422


def test_account_lockout_after_repeated_failures(client: TestClient) -> None:
    for _ in range(5):
        client.post(
            "/v1/auth/login",
            json={"username": "admin", "password": "bad-password-value"},
        )
    locked = client.post(
        "/v1/auth/login",
        json={"username": "admin", "password": "StrongPassword!2026"},
    )
    assert locked.status_code == 403
