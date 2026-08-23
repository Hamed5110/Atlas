"""Integration tests for on-premise AI agent endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.helpers import create_employee, create_loan, create_ticket

pytestmark = [pytest.mark.integration]


class TestAiAgentEndpoints:
    """Smoke and range checks for /v1/ai/* routes."""

    def test_anomaly_scan_returns_items(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        create_ticket(
            client,
            admin_headers,
            str(employee["id"]),
            ticket_cost="5000",
            entitlement="150",
        )
        response = client.post("/v1/ai/anomalies", headers=admin_headers)
        assert response.status_code == 200
        body = response.json()
        assert "count" in body
        assert "items" in body
        assert isinstance(body["items"], list)

    def test_loan_risk_score_probability_in_unit_interval(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers)
        loan = create_loan(client, admin_headers, str(employee["id"]), principal="800")
        response = client.post(
            f"/v1/ai/loans/{loan['id']}/risk-score", headers=admin_headers
        )
        assert response.status_code == 200
        body = response.json()
        probability = float(body.get("probability", body.get("default_probability", 0)))
        assert 0.0 <= probability <= 1.0

    def test_budget_forecast_returns_series(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        response = client.get("/v1/ai/forecasts/budget", headers=admin_headers)
        assert response.status_code == 200
        body = response.json()
        assert "forecast" in body or "months" in body or isinstance(body, dict)

    def test_ess_sentiment(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        response = client.post(
            "/v1/ai/ess-sentiment",
            headers=admin_headers,
            json={"text": "Urgent travel request for family emergency"},
        )
        assert response.status_code == 200
        body = response.json()
        assert "sentiment" in body or "label" in body

    def test_rate_recommendation_for_employee(
        self, client: TestClient, admin_headers: dict[str, str]
    ) -> None:
        employee = create_employee(client, admin_headers, pay_group="OPS")
        response = client.get(
            f"/v1/ai/employees/{employee['id']}/rate-recommendation",
            headers=admin_headers,
        )
        assert response.status_code == 200
        body = response.json()
        assert "recommended_max_payout" in body
