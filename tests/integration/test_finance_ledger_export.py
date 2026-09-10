"""Backend: Finance ledger Excel/PDF export endpoints (Focus ERP style)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from airfare_management.api.main import create_app
from airfare_management.config import get_settings


def test_finance_ledger_excel_and_pdf_endpoints() -> None:
    get_settings.cache_clear()
    settings = get_settings()
    app = create_app(settings)
    with TestClient(app) as client:
        login = client.post(
            "/v1/auth/login",
            json={
                "username": settings.bootstrap_admin_username,
                "password": settings.bootstrap_admin_password,
            },
        )
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        seed = client.post("/v1/finance/seed", headers=headers, json={})
        assert seed.status_code == 200, seed.text

        xlsx = client.get("/v1/finance/ledger-report.xlsx", headers=headers)
        assert xlsx.status_code == 200, xlsx.text
        assert "spreadsheetml" in xlsx.headers.get("content-type", "")
        assert xlsx.content[:2] == b"PK"
        assert "finance-ledger-report.xlsx" in xlsx.headers.get("content-disposition", "")

        pdf = client.get("/v1/finance/ledger-report.pdf", headers=headers)
        assert pdf.status_code == 200, pdf.text
        assert pdf.headers.get("content-type", "").startswith("application/pdf")
        assert pdf.content.startswith(b"%PDF")
        assert "finance-ledger-report.pdf" in pdf.headers.get("content-disposition", "")
