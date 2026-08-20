"""Backup catalog and logical restore tests."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from airfare_management.api.main import DEFAULT_COMPANY_ID, create_app
from airfare_management.config import Settings


def _client(tmp_path: Path) -> tuple[TestClient, dict[str, str]]:
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="z" * 32,
        bootstrap_admin_password="StrongPassword!2026",
        attachment_root=str(tmp_path / "attachments"),
        backup_root=str(tmp_path / "backups"),
        backup_retention_days=30,
    )
    client = TestClient(create_app(settings))
    login = client.post(
        "/v1/auth/login",
        json={"username": "admin", "password": "StrongPassword!2026"},
    )
    assert login.status_code == 200
    return client, {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_logical_backup_restore_round_trip(tmp_path: Path) -> None:
    client, headers = _client(tmp_path)
    created = client.post(
        "/v1/employees",
        headers=headers,
        json={
            "code": "BK-01",
            "full_name": "Backup Emp",
            "company_id": DEFAULT_COMPANY_ID,
            "join_date": "2025-01-01",
        },
    )
    assert created.status_code == 201, created.text
    backup = client.post(
        "/v1/admin/backups",
        headers=headers,
        json={"kind": "logical"},
    )
    assert backup.status_code == 201, backup.text
    body = backup.json()
    assert body["kind"] == "logical"
    assert body["file_name"].endswith(".json")
    assert len(body["sha256"]) == 64
    catalog = client.get("/v1/admin/backups", headers=headers)
    assert catalog.status_code == 200
    assert catalog.json()["count"] >= 1
    erased = client.post(
        "/v1/admin/erase-data",
        headers=headers,
        json={"confirm": "ERASE_ALL_DATA"},
    )
    assert erased.status_code == 200
    assert client.get("/v1/employees", headers=headers).json() == []
    restored = client.post(
        "/v1/admin/backups/restore",
        headers=headers,
        json={"file_name": body["file_name"], "confirm": "RESTORE_CONFIRM"},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["status"] == "restored"
    employees = client.get("/v1/employees", headers=headers).json()
    assert any(item["code"] == "BK-01" for item in employees)


def test_mssql_backup_rejected_on_sqlite(tmp_path: Path) -> None:
    client, headers = _client(tmp_path)
    response = client.post(
        "/v1/admin/backups",
        headers=headers,
        json={"kind": "mssql"},
    )
    assert response.status_code == 422


def test_resolve_login_from_database_url() -> None:
    from airfare_management.infrastructure.backup import parse_mssql_url, resolve_mssql_login

    url = (
        "mssql+pyodbc://sa:Secret%40Pass@sqlhost/HCM_Airfare_Management"
        "?driver=ODBC+Driver+18+for+SQL+Server"
    )
    parsed = parse_mssql_url(url)
    assert parsed["user"] == "sa"
    assert parsed["password"] == "Secret@Pass"
    assert parsed["server"] == "sqlhost"
    assert parsed["database"] == "HCM_Airfare_Management"
    user, password, host, database = resolve_mssql_login(
        url, db_user=None, db_password=None, server="127.0.0.1"
    )
    assert user == "sa"
    assert password == "Secret@Pass"
    assert host == "sqlhost"
    assert database == "HCM_Airfare_Management"
