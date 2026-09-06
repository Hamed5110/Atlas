"""Integration tests for loan create → pay → restructure → defer → settle."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from tests.helpers import create_employee, create_loan

pytestmark = pytest.mark.integration


class TestLoanCreateAndSchedule:
    """Loan creation must persist a full amortization schedule."""

    def test_create_loan_installment_count_matches_term(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        loan = create_loan(
            client, admin_headers, str(employee["id"]), installments=12
        )
        schedule = client.get(
            f"/v1/loans/{loan['id']}/schedule", headers=admin_headers
        )
        assert schedule.status_code == 200
        assert len(schedule.json()) == 12

    def test_schedule_opening_balance_equals_principal(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        loan = create_loan(
            client,
            admin_headers,
            str(employee["id"]),
            principal="1200",
            installments=12,
        )
        schedule = client.get(
            f"/v1/loans/{loan['id']}/schedule", headers=admin_headers
        ).json()
        assert Decimal(str(schedule[0]["opening_balance"])) == Decimal("1200")


class TestLoanPayments:
    """Payments reduce outstanding and rebuild schedules."""

    def test_partial_payment_reduces_outstanding_and_schedule(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        loan = create_loan(
            client,
            admin_headers,
            str(employee["id"]),
            principal="1200",
            installments=12,
        )
        paid = client.post(
            f"/v1/loans/{loan['id']}/payments",
            headers=admin_headers,
            json={
                "amount": "100",
                "paid_on": date.today().isoformat(),
                "reference": "PYRAMID-TEST",
            },
        )
        assert paid.status_code == 201
        assert Decimal(str(paid.json()["outstanding"])) == Decimal("1100")
        schedule = client.get(
            f"/v1/loans/{loan['id']}/schedule", headers=admin_headers
        ).json()
        assert Decimal(str(schedule[0]["opening_balance"])) == Decimal("1100")

    def test_overpayment_rejected(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        loan = create_loan(
            client, admin_headers, str(employee["id"]), principal="500"
        )
        over = client.post(
            f"/v1/loans/{loan['id']}/payments",
            headers=admin_headers,
            json={
                "amount": "501",
                "paid_on": date.today().isoformat(),
                "reference": "OVER",
            },
        )
        assert over.status_code == 422
        assert over.json()["code"] == "overpayment"

    def test_full_payment_settles_loan(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        loan = create_loan(
            client, admin_headers, str(employee["id"]), principal="300", installments=6
        )
        paid = client.post(
            f"/v1/loans/{loan['id']}/payments",
            headers=admin_headers,
            json={
                "amount": "300",
                "paid_on": date.today().isoformat(),
                "reference": "FULL",
            },
        )
        assert paid.status_code == 201
        assert paid.json()["status"] == "settled"
        assert Decimal(str(paid.json()["outstanding"])) == Decimal("0")


class TestLoanRestructureAndDefer:
    """Restructure and deferment refresh persisted schedules."""

    def test_restructure_updates_terms_and_schedule(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        loan = create_loan(
            client,
            admin_headers,
            str(employee["id"]),
            principal="600",
            installments=12,
        )
        restructured = client.post(
            f"/v1/loans/{loan['id']}/restructure",
            headers={**admin_headers, "If-Match": str(loan["version"])},
            json={
                "annual_rate": "6",
                "installments": 6,
                "first_due_date": "2026-10-01",
            },
        )
        assert restructured.status_code == 200
        schedule = client.get(
            f"/v1/loans/{loan['id']}/schedule", headers=admin_headers
        ).json()
        assert len(schedule) == 6
        assert restructured.json()["status"] == "active"

    def test_defer_moves_status_and_rebuilds_schedule(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        loan = create_loan(
            client,
            admin_headers,
            str(employee["id"]),
            principal="400",
            installments=8,
        )
        deferred_until = (date.today() + timedelta(days=45)).isoformat()
        deferred = client.post(
            f"/v1/loans/{loan['id']}/defer",
            headers={**admin_headers, "If-Match": str(loan["version"])},
            json={"deferred_until": deferred_until},
        )
        assert deferred.status_code == 200
        assert deferred.json()["status"] == "deferred"
        schedule = client.get(
            f"/v1/loans/{loan['id']}/schedule", headers=admin_headers
        ).json()
        assert schedule[0]["due_date"] == deferred_until

    def test_return_resumes_deferred_loan(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        loan = create_loan(
            client,
            admin_headers,
            str(employee["id"]),
            principal="400",
            installments=8,
        )
        deferred_until = (date.today() + timedelta(days=45)).isoformat()
        deferred = client.post(
            f"/v1/loans/{loan['id']}/defer",
            headers={**admin_headers, "If-Match": str(loan["version"])},
            json={"deferred_until": deferred_until},
        )
        assert deferred.status_code == 200
        resumed = client.post(
            f"/v1/loans/{loan['id']}/return",
            headers={**admin_headers, "If-Match": str(deferred.json()["version"])},
        )
        assert resumed.status_code == 200, resumed.text
        assert resumed.json()["status"] == "active"
        assert resumed.json().get("deferred_until") in (None, "")

    def test_return_reopens_settled_loan_by_reversing_payments(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        loan = create_loan(
            client,
            admin_headers,
            str(employee["id"]),
            principal="500",
            installments=5,
        )
        settled = client.post(
            "/v1/loans/bulk-settle",
            headers=admin_headers,
            json={
                "items": [
                    {
                        "loan_id": loan["id"],
                        "amount": "500",
                        "paid_on": date.today().isoformat(),
                        "reference": "FULL-SETTLE",
                    }
                ]
            },
        )
        assert settled.status_code == 200, settled.text
        listed = client.get("/v1/loans?status=settled", headers=admin_headers).json()
        current = next(item for item in listed if item["id"] == loan["id"])
        resumed = client.post(
            f"/v1/loans/{loan['id']}/return",
            headers={**admin_headers, "If-Match": str(current["version"])},
        )
        assert resumed.status_code == 200, resumed.text
        body = resumed.json()
        assert body["status"] == "active"
        assert Decimal(str(body["outstanding"])) == Decimal("500")
        assert body.get("reversed_payments", 0) >= 1


class TestLoanSoftDelete:
    """Soft-delete preserves financial state."""

    def test_delete_unpaid_loan_not_listed_as_settled(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        loan = create_loan(
            client, admin_headers, str(employee["id"]), principal="500"
        )
        deleted = client.delete(
            f"/v1/loans/{loan['id']}",
            headers={**admin_headers, "If-Match": str(loan["version"])},
        )
        assert deleted.status_code == 204
        settled = client.get("/v1/loans?status=settled", headers=admin_headers).json()
        assert all(row["id"] != loan["id"] for row in settled)
