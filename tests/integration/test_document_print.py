"""Document issue + PDF print layout regression."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.helpers import create_employee, ensure_company

pytestmark = pytest.mark.integration


def test_offer_letter_issue_and_pdf(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    templates = client.get("/v1/documents/templates", headers=admin_headers)
    assert templates.status_code == 200
    offer = next(
        t for t in templates.json()["templates"] if t["key"] == "offer_default"
    )
    employee = create_employee(
        client, admin_headers, company_id=ensure_company(client, admin_headers)
    )
    issued = client.post(
        "/v1/documents",
        headers=admin_headers,
        json={
            "kind": offer["kind"],
            "template_key": offer["key"],
            "employee_id": employee["id"],
            "params": {
                "nature_of_employment": "Permanent",
                "joining_date": "2026-09-01",
                "document_date": "2026-09-01",
                "probation_months": "3",
                "basic": "500",
                "annual_leave_days": "30",
                "offer_valid_until": (date.today() + timedelta(days=14)).isoformat(),
            },
        },
    )
    assert issued.status_code == 201, issued.text
    doc_id = issued.json()["id"]
    pdf = client.get(f"/v1/documents/{doc_id}/pdf", headers=admin_headers)
    assert pdf.status_code == 200, pdf.text
    assert pdf.content[:4] == b"%PDF"
