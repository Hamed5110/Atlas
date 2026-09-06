"""Integration tests for ticket workflow guards and loan conversion."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.helpers import advance_ticket, create_employee, create_ticket

pytestmark = pytest.mark.integration


class TestTicketStatusTransitions:
    """Valid and invalid ticket workflow transitions."""

    def test_happy_path_draft_to_paid(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        ticket = create_ticket(client, admin_headers, str(employee["id"]))
        ticket = advance_ticket(
            client, admin_headers, ticket, "submitted", "approved", "paid"
        )
        assert ticket["status"] == "paid"

    def test_rejected_ticket_can_return_to_draft(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        ticket = create_ticket(client, admin_headers, str(employee["id"]))
        ticket = advance_ticket(client, admin_headers, ticket, "submitted", "rejected")
        back = client.patch(
            f"/v1/tickets/{ticket['id']}/status",
            headers={**admin_headers, "If-Match": str(ticket["version"])},
            json={"status": "draft"},
        )
        assert back.status_code == 200
        assert back.json()["status"] == "draft"

    @pytest.mark.parametrize(
        ("from_status", "to_status"),
        [
            ("draft", "approved"),
            ("submitted", "paid"),
            ("approved", "submitted"),
            ("paid", "draft"),
        ],
    )
    def test_invalid_transitions_rejected(
        self,
        client: TestClient,
        admin_headers: dict[str, str],
        from_status: str,
        to_status: str,
    ) -> None:
        employee = create_employee(client, admin_headers)
        ticket = create_ticket(client, admin_headers, str(employee["id"]))
        if from_status != "draft":
            path = {
                "submitted": ("submitted",),
                "approved": ("submitted", "approved"),
                "paid": ("submitted", "approved", "paid"),
            }[from_status]
            ticket = advance_ticket(client, admin_headers, ticket, *path)
        response = client.patch(
            f"/v1/tickets/{ticket['id']}/status",
            headers={**admin_headers, "If-Match": str(ticket["version"])},
            json={"status": to_status},
        )
        assert response.status_code == 422
        assert response.json()["code"] == "invalid_transition"

    def test_stale_version_rejected(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        ticket = create_ticket(client, admin_headers, str(employee["id"]))
        stale = client.patch(
            f"/v1/tickets/{ticket['id']}/status",
            headers={**admin_headers, "If-Match": "999"},
            json={"status": "submitted"},
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "stale_version"


class TestTicketRouteValidation:
    """Create-time validation."""

    def test_same_origin_destination_rejected(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        response = client.post(
            "/v1/tickets",
            headers=admin_headers,
            json={
                "employee_id": employee["id"],
                "travel_date": "2026-06-01",
                "origin_code": "DXB",
                "destination_code": "DXB",
                "ticket_cost": "100",
                "entitlement": "100",
                "company_paid": "100",
                "excess_handling": "SELF_PAID",
            },
        )
        assert response.status_code == 422
        assert response.json()["code"] == "invalid_route"


class TestConvertToLoan:
    """Excess ticket approval spawns a loan with schedule."""

    def test_approve_convert_to_loan_creates_loan(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        ticket = create_ticket(
            client,
            admin_headers,
            str(employee["id"]),
            ticket_cost="900",
            entitlement="600",
            company_paid="900",
            excess_handling="CONVERT_TO_LOAN",
            travel_date="2026-09-01",
        )
        advance_ticket(client, admin_headers, ticket, "submitted", "approved")
        loans = client.get("/v1/loans", headers=admin_headers).json()
        assert len(loans) == 1
        assert loans[0]["principal"] == "300.0000"
        schedule = client.get(
            f"/v1/loans/{loans[0]['id']}/schedule", headers=admin_headers
        ).json()
        assert len(schedule) == 12


class TestTicketSoftDelete:
    """Unpaid tickets without linked loans may be deleted."""

    def test_delete_draft_ticket(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        ticket = create_ticket(client, admin_headers, str(employee["id"]))
        deleted = client.delete(
            f"/v1/tickets/{ticket['id']}",
            headers={**admin_headers, "If-Match": str(ticket["version"])},
        )
        assert deleted.status_code == 204

    def test_delete_submitted_ticket_allowed(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        ticket = create_ticket(client, admin_headers, str(employee["id"]))
        ticket = advance_ticket(client, admin_headers, ticket, "submitted")
        deleted = client.delete(
            f"/v1/tickets/{ticket['id']}",
            headers={**admin_headers, "If-Match": str(ticket["version"])},
        )
        assert deleted.status_code == 204

    def test_delete_paid_ticket_allowed(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        ticket = create_ticket(client, admin_headers, str(employee["id"]))
        ticket = advance_ticket(client, admin_headers, ticket, "submitted", "approved", "paid")
        deleted = client.delete(
            f"/v1/tickets/{ticket['id']}",
            headers={**admin_headers, "If-Match": str(ticket["version"])},
        )
        assert deleted.status_code == 204


class TestTicketLoanRecoveryEdit:
    """Best-practice revise/recreate of excess recovery loans on ticket edit."""

    def test_edit_paid_ticket_allowed(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        ticket = create_ticket(client, admin_headers, str(employee["id"]))
        ticket = advance_ticket(client, admin_headers, ticket, "submitted", "approved", "paid")
        updated = client.put(
            f"/v1/tickets/{ticket['id']}",
            headers={**admin_headers, "If-Match": str(ticket["version"])},
            json={
                "travel_date": "2026-06-15",
                "origin_code": "BAH",
                "destination_code": "DXB",
                "ticket_cost": "510",
                "entitlement": "400",
                "company_paid": "400",
                "excess_handling": "SELF_PAID",
                "notes": "paid correction",
            },
        )
        assert updated.status_code == 200, updated.text
        body = updated.json()
        assert body["status"] == "paid"
        assert float(body["ticket_cost"]) == 510

    def test_approve_loan_handling_creates_loan(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        ticket = create_ticket(
            client,
            admin_headers,
            str(employee["id"]),
            ticket_cost="900",
            entitlement="600",
            company_paid="600",
            excess_handling="CONVERT_TO_LOAN",
        )
        ticket = advance_ticket(client, admin_headers, ticket, "submitted", "approved")
        assert ticket.get("loan_id"), ticket

    def test_edit_recreates_loan_after_loan_deleted(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        ticket = create_ticket(
            client,
            admin_headers,
            str(employee["id"]),
            ticket_cost="900",
            entitlement="600",
            company_paid="600",
            excess_handling="CONVERT_TO_LOAN",
        )
        ticket = advance_ticket(client, admin_headers, ticket, "submitted", "approved")
        loan_id = ticket["loan_id"]
        loans = client.get("/v1/loans?limit=50", headers=admin_headers)
        assert loans.status_code == 200
        loan = next(item for item in loans.json() if item["id"] == loan_id)
        deleted = client.delete(
            f"/v1/loans/{loan_id}",
            headers={**admin_headers, "If-Match": str(loan["version"])},
        )
        assert deleted.status_code == 204

        listed = client.get("/v1/tickets?limit=50", headers=admin_headers)
        current = next(item for item in listed.json() if item["id"] == ticket["id"])
        updated = client.put(
            f"/v1/tickets/{current['id']}",
            headers={**admin_headers, "If-Match": str(current["version"])},
            json={
                "travel_date": current["travel_date"],
                "origin_code": current["origin_code"],
                "destination_code": current["destination_code"],
                "ticket_cost": current["ticket_cost"],
                "entitlement": current["entitlement"],
                "company_paid": current["company_paid"],
                "excess_handling": "CONVERT_TO_LOAN",
                "tenure_months": 12,
                "notes": current.get("notes") or "",
            },
        )
        assert updated.status_code == 200, updated.text
        body = updated.json()
        assert body.get("loan_id"), body
        assert body.get("loan_created") is True

    def test_edit_with_linked_loan_revises_without_manual_delete(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        ticket = create_ticket(
            client,
            admin_headers,
            str(employee["id"]),
            ticket_cost="900",
            entitlement="600",
            company_paid="600",
            excess_handling="CONVERT_TO_LOAN",
        )
        ticket = advance_ticket(client, admin_headers, ticket, "submitted", "approved")
        listed = client.get("/v1/tickets?limit=50", headers=admin_headers)
        current = next(item for item in listed.json() if item["id"] == ticket["id"])
        old_loan = current.get("loan_id")
        updated = client.put(
            f"/v1/tickets/{current['id']}",
            headers={**admin_headers, "If-Match": str(current["version"])},
            json={
                "travel_date": current["travel_date"],
                "origin_code": current["origin_code"],
                "destination_code": current["destination_code"],
                "ticket_cost": "950",
                "entitlement": "600",
                "company_paid": "600",
                "excess_handling": "CONVERT_TO_LOAN",
                "tenure_months": 10,
                "notes": "",
            },
        )
        assert updated.status_code == 200, updated.text
        body = updated.json()
        assert body.get("loan_id"), body
        assert body["loan_id"] != old_loan
        assert body.get("loan_revised") is True
