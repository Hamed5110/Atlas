"""Locust load scenarios with SLA thresholds for port 3389."""

from __future__ import annotations

import os
import random
import sys
from datetime import date

from locust import HttpUser, between, events, task
from locust.env import Environment

HOST = os.environ.get("AIRFARE_LOAD_HOST", "http://127.0.0.1:3389")

AUTH_P95_MS = 500
REPORT_P95_MS = 1000
MAX_ERROR_RATE = 0.001

_request_stats: dict[str, list[float]] = {"auth": [], "report": []}
_failures = 0
_total = 0


class AirfareUser(HttpUser):
    """Simulate mixed admin and finance workflows."""

    host = HOST
    wait_time = between(0.5, 2.0)
    token: str | None = None

    def on_start(self) -> None:
        response = self.client.post(
            "/v1/auth/login",
            json={"username": "admin", "password": "StrongPassword!2026"},
            name="auth/login",
        )
        if response.status_code == 200:
            self.token = response.json()["access_token"]

    @property
    def headers(self) -> dict[str, str]:
        if self.token is None:
            return {}
        return {"Authorization": f"Bearer {self.token}"}

    @task(10)
    def login(self) -> None:
        self.client.post(
            "/v1/auth/login",
            json={"username": "admin", "password": "StrongPassword!2026"},
            name="auth/login",
        )

    @task(30)
    def create_ticket(self) -> None:
        if not self.token:
            return
        self.client.post(
            "/v1/tickets",
            headers=self.headers,
            name="tickets/create",
            json={
                "employee_id": "00000000-0000-0000-0000-000000000001",
                "travel_date": date.today().isoformat(),
                "origin_code": "BAH",
                "destination_code": "DXB",
                "ticket_cost": str(random.randint(200, 800)),
                "entitlement": "400",
                "company_paid": "400",
                "excess_handling": "SELF_PAID",
            },
        )

    @task(20)
    def approve_ticket_list(self) -> None:
        if self.token:
            self.client.get("/v1/tickets", headers=self.headers, name="tickets/list")

    @task(15)
    def create_loan_preview(self) -> None:
        if self.token:
            self.client.post(
                "/v1/loans/preview",
                headers=self.headers,
                name="loans/preview",
                json={"principal": "500", "annual_rate": "0", "installments": 6},
            )

    @task(15)
    def post_payment_list(self) -> None:
        if self.token:
            self.client.get("/v1/loans", headers=self.headers, name="loans/list")

    @task(10)
    def view_dashboard(self) -> None:
        if self.token:
            self.client.get("/v1/dashboard", headers=self.headers, name="dashboard")


@events.request.add_listener
def _track_request(request_type, name, response_time, response_length, **_kwargs):  # type: ignore[no-untyped-def]
    global _total, _failures
    _total += 1
    if name and name.startswith("auth"):
        _request_stats["auth"].append(response_time)
    elif name in {"dashboard", "reports"}:
        _request_stats["report"].append(response_time)


@events.quitting.add_listener
def _enforce_thresholds(environment: Environment, **_kwargs) -> None:  # type: ignore[no-untyped-def]
    stats = environment.stats.total
    error_rate = stats.num_failures / max(stats.num_requests, 1)
    auth_times = sorted(_request_stats["auth"])
    report_times = sorted(_request_stats["report"])
    auth_p95 = auth_times[int(len(auth_times) * 0.95)] if auth_times else 0
    report_p95 = report_times[int(len(report_times) * 0.95)] if report_times else 0
    if error_rate > MAX_ERROR_RATE or auth_p95 > AUTH_P95_MS or report_p95 > REPORT_P95_MS:
        print(
            f"SLA breach: error_rate={error_rate:.4f} auth_p95={auth_p95:.1f}ms report_p95={report_p95:.1f}ms",
            file=sys.stderr,
        )
        environment.process_exit_code = 1
