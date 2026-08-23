"""Report import integration tests."""

from __future__ import annotations

from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from airfare_management.api.main import DEFAULT_COMPANY_ID
from tests.helpers import create_employee

pytestmark = pytest.mark.integration


def _employee_workbook(rows: list[tuple[object, ...]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.append(
        ("code", "full_name", "company_id", "join_date", "department", "branch", "email")
    )
    for row in rows:
        sheet.append(list(row))
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _opening_balance_workbook(rows: list[tuple[object, ...]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.append(
        (
            "employee_code",
            "balance_year",
            "opening_days",
            "paid_days",
            "opening_amount",
            "maximum_payout",
        )
    )
    for row in rows:
        sheet.append(list(row))
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_employee_import_valid_file_commits(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    code = f"IMP{uuid4().hex[:5].upper()}"
    payload = _employee_workbook(
        [(code, "Import Valid", DEFAULT_COMPANY_ID, "2025-03-01", "FIN", "HQ", "")]
    )
    preview = client.post(
        "/v1/employees/import/preview",
        headers=admin_headers,
        files={"file": ("employees.xlsx", payload, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert preview.status_code == 200, preview.text
    rows = preview.json()["rows"]
    assert preview.json()["summary"]["ready"] == 1
    commit = client.post(
        "/v1/employees/import/commit",
        headers=admin_headers,
        json={
            "rows": [
                {
                    "row": rows[0]["row"],
                    "code": code,
                    "full_name": "Import Valid",
                    "company_id": DEFAULT_COMPANY_ID,
                    "join_date": "2025-03-01",
                    "department": "FIN",
                    "branch": "HQ",
                    "selected": True,
                }
            ]
        },
    )
    assert commit.status_code == 200, commit.text
    assert commit.json()["imported"] == 1


def test_employee_import_invalid_company_caught_in_dry_run(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    payload = _employee_workbook(
        [
            (
                f"BAD{uuid4().hex[:4].upper()}",
                "Missing Company",
                "99999999-9999-9999-9999-999999999999",
                "2025-01-01",
                "FIN",
                "HQ",
                "",
            )
        ]
    )
    response = client.post(
        "/v1/employees/import",
        headers=admin_headers,
        files={"file": ("employees.xlsx", payload, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        params={"dry_run": "true"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["accepted"] == 0
    assert body["errors"]


def test_employee_import_duplicate_code_rejected(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    existing = create_employee(client, admin_headers)
    payload = _employee_workbook(
        [
            (
                existing["code"],
                "Duplicate Row",
                DEFAULT_COMPANY_ID,
                "2025-01-01",
                "FIN",
                "HQ",
                "",
            )
        ]
    )
    response = client.post(
        "/v1/employees/import/preview",
        headers=admin_headers,
        files={"file": ("employees.xlsx", payload, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert response.status_code == 200
    rows = response.json()["rows"]
    assert any(row["severity"] == "ERROR" for row in rows)


def test_opening_balance_import_leap_year_and_cap(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    employee = create_employee(client, admin_headers)
    payload = _opening_balance_workbook(
        [
            (employee["code"], 2024, 366, 0, 900, 150),
            (employee["code"], 2025, 90, 0, 200, 150),
        ]
    )
    preview = client.post(
        "/v1/opening-balances/import/preview",
        headers=admin_headers,
        files={
            "file": (
                "balances.xlsx",
                payload,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert preview.status_code == 200, preview.text
    rows = preview.json()["rows"]
    assert rows[0]["severity"] == "READY"
    assert rows[1]["severity"] == "READY"


def test_opening_balance_import_rejects_soft_deleted_employee(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    employee = create_employee(client, admin_headers)
    deleted = client.delete(
        f"/v1/employees/{employee['id']}",
        headers={**admin_headers, "If-Match": str(employee["version"])},
    )
    assert deleted.status_code == 204
    payload = _opening_balance_workbook([(employee["code"], 2026, 10, 0, 25, 150)])
    preview = client.post(
        "/v1/opening-balances/import/preview",
        headers=admin_headers,
        files={
            "file": (
                "balances.xlsx",
                payload,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert preview.status_code == 200
    assert preview.json()["rows"][0]["severity"] == "ERROR"


def test_formula_injection_cell_stored_as_text_on_import(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    formula_name = "=CMD|' /C calc'!A0"
    created = client.post(
        "/v1/employees",
        headers=admin_headers,
        json={
            "code": f"FX{uuid4().hex[:4].upper()}",
            "full_name": formula_name,
            "company_id": DEFAULT_COMPANY_ID,
            "join_date": "2025-01-01",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["full_name"] == formula_name


def test_large_attachment_rejected(client: TestClient, admin_headers: dict[str, str]) -> None:
    employee = create_employee(client, admin_headers)
    oversized = b"0" * (25 * 1024 * 1024 + 1)
    response = client.post(
        f"/v1/attachments?entity_type=employee&entity_id={employee['id']}",
        headers=admin_headers,
        files={"file": ("large.pdf", oversized, "application/pdf")},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_attachment_size"
