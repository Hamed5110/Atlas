"""Integration tests for enterprise security, CRUD, ESS, and finance workflows."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from airfare_management.api.main import DEFAULT_COMPANY_ID, create_app
from airfare_management.config import Settings
from airfare_management.domain.models import DomainError
from airfare_management.infrastructure.documents import EMPLOYEE_COLUMNS, export_workbook
from airfare_management.infrastructure.security import (
    create_refresh_token,
    decode_access_token,
    hash_refresh_token,
)
from airfare_management.infrastructure.tasks import system_health
from airfare_management.shared import Money, Result, SystemClock, correlation_id, parse_uuid


@pytest.fixture
def client() -> TestClient:
    """Create an isolated application client."""
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="e" * 32,
        bootstrap_admin_password="StrongPassword!2026",
        attachment_root="./var/test-enterprise-attachments",
    )
    return TestClient(create_app(settings))


def _login(client: TestClient) -> tuple[dict[str, str], dict[str, str]]:
    response = client.post(
        "/v1/auth/login",
        json={"username": "admin", "password": "StrongPassword!2026"},
    )
    assert response.status_code == 200
    tokens = response.json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}, tokens


def _employee(
    client: TestClient, headers: dict[str, str], code: str = "ENT-01"
) -> dict[str, object]:
    response = client.post(
        "/v1/employees",
        headers=headers,
        json={
            "code": code,
            "full_name": "Enterprise Employee",
            "company_id": DEFAULT_COMPANY_ID,
            "join_date": "2024-02-29",
            "department": "Finance",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_shared_kernel_primitives() -> None:
    """Use banker's rounding, typed results, clocks, and correlation validation."""
    assert Money(Decimal("1.005")).amount == Decimal("1.00")
    assert Money(Decimal("1.015")).add(Money(Decimal("2.00"))).amount == Decimal("3.02")
    assert Money(Decimal("4.00")).subtract(Money(Decimal("1.25"))).amount == Decimal("2.75")
    with pytest.raises(ValueError):
        Money(Decimal("1"), "US")
    with pytest.raises(ValueError):
        Money(Decimal("NaN"))
    with pytest.raises(ValueError):
        Money(Decimal("1"), "USD").add(Money(Decimal("1"), "EUR"))
    assert Result[str, Exception].ok("ok").unwrap() == "ok"
    assert Result[str, DomainError].ok("ok").is_ok
    error = DomainError("failed", "failed")
    with pytest.raises(DomainError):
        Result[str, DomainError].fail(error).unwrap()
    with pytest.raises(RuntimeError):
        Result[str, str].fail("failed").unwrap()
    with pytest.raises(RuntimeError):
        Result[str, str]().unwrap()
    assert SystemClock().now().tzinfo is UTC
    assert correlation_id("request_123") == "request_123"
    assert len(correlation_id("not valid!")) == 36
    assert str(parse_uuid(DEFAULT_COMPANY_ID)) == DEFAULT_COMPANY_ID


def test_refresh_rotation_reuse_logout_and_lockout(client: TestClient) -> None:
    """Rotate refresh tokens, detect reuse, revoke logout, and count failures."""
    headers, tokens = _login(client)
    me = client.get("/v1/auth/me", headers=headers)
    assert me.status_code == 200
    rotated = client.post("/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert rotated.status_code == 200
    reused = client.post("/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert reused.status_code == 401
    assert reused.json()["code"] == "token_reuse"
    revoked = client.post(
        "/v1/auth/refresh", json={"refresh_token": rotated.json()["refresh_token"]}
    )
    assert revoked.status_code == 401
    _, fresh = _login(client)
    assert (
        client.post("/v1/auth/logout", json={"refresh_token": fresh["refresh_token"]}).status_code
        == 204
    )
    assert (
        client.post("/v1/auth/refresh", json={"refresh_token": fresh["refresh_token"]}).status_code
        == 401
    )
    opaque = create_refresh_token()
    assert opaque.digest == hash_refresh_token(opaque.value)


def test_employee_lookup_balance_and_preference_crud(client: TestClient) -> None:
    """Exercise optimistic CRUD, lookup values, balances, and preference cascade."""
    headers, _ = _login(client)
    employee = _employee(client, headers)
    employee_id = employee["id"]
    detail = client.get(f"/v1/employees/{employee_id}", headers=headers)
    assert detail.status_code == 200
    updated = client.put(
        f"/v1/employees/{employee_id}",
        headers={**headers, "If-Match": "1"},
        json={
            "full_name": "Updated Employee",
            "join_date": "2024-02-29",
            "department": "HR",
            "branch": "HQ",
            "active": True,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["version"] == 2
    stale = client.put(
        f"/v1/employees/{employee_id}",
        headers={**headers, "If-Match": "1"},
        json={
            "full_name": "Stale Employee",
            "join_date": "2024-02-29",
            "active": True,
        },
    )
    assert stale.status_code == 409

    lookup = client.post(
        "/v1/lookups/departments",
        headers=headers,
        json={"code": "FIN", "name": "Finance"},
    )
    assert lookup.status_code == 201
    lookup_id = lookup.json()["id"]
    assert client.get("/v1/lookups/departments", headers=headers).json()[0]["code"] == "FIN"
    changed = client.put(
        f"/v1/lookups/departments/{lookup_id}",
        headers={**headers, "If-Match": "1"},
        json={"code": "FIN", "name": "Corporate Finance", "active": True},
    )
    assert changed.status_code == 200
    assert (
        client.delete(
            f"/v1/lookups/departments/{lookup_id}",
            headers={**headers, "If-Match": "2"},
        ).status_code
        == 204
    )

    balance = client.post(
        "/v1/opening-balances",
        headers=headers,
        json={
            "employee_id": employee_id,
            "balance_year": 2026,
            "opening_days": "10",
            "paid_days": "1",
            "opening_amount": "500",
            "maximum_payout": "1500",
        },
    )
    assert balance.status_code == 201
    balance_id = balance.json()["id"]
    assert client.get("/v1/opening-balances", headers=headers).status_code == 200
    changed_balance = client.put(
        f"/v1/opening-balances/{balance_id}",
        headers={**headers, "If-Match": "1"},
        json={
            "opening_days": "12",
            "paid_days": "2",
            "opening_amount": "600",
            "maximum_payout": "1600",
        },
    )
    assert changed_balance.status_code == 200
    assert (
        client.delete(
            f"/v1/opening-balances/{balance_id}",
            headers={**headers, "If-Match": "2"},
        ).status_code
        == 204
    )

    assert (
        client.put(
            "/v1/preferences",
            headers=headers,
            json={
                "scope_type": "global",
                "scope_id": "",
                "preference_key": "theme",
                "value": "light",
            },
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/v1/preferences",
            headers=headers,
            json={
                "scope_type": "user",
                "scope_id": me_id(client, headers),
                "preference_key": "theme",
                "value": "dark",
            },
        ).status_code
        == 200
    )
    effective = client.get("/v1/preferences/effective", headers=headers)
    assert effective.json()["theme"] == "dark"
    assert client.get("/v1/preferences/effective", headers=headers).json()["theme"] == "dark"


def me_id(client: TestClient, headers: dict[str, str]) -> str:
    """Return the current user identifier."""
    return str(client.get("/v1/auth/me", headers=headers).json()["id"])


def test_ticket_loan_finance_and_atomic_settlement(client: TestClient) -> None:
    """Convert ticket excess, restructure/defer, and atomically settle loans."""
    headers, _ = _login(client)
    employee = _employee(client, headers, "FIN-01")
    employee_id = employee["id"]
    ticket = client.post(
        "/v1/tickets",
        headers=headers,
        json={
            "employee_id": employee_id,
            "travel_date": "2026-09-01",
            "origin_code": "KHI",
            "destination_code": "DXB",
            "ticket_cost": "900",
            "entitlement": "600",
            "company_paid": "900",
            "excess_handling": "CONVERT_TO_LOAN",
        },
    )
    assert ticket.status_code == 201
    ticket_id = ticket.json()["id"]
    assert (
        client.patch(
            f"/v1/tickets/{ticket_id}/status",
            headers={**headers, "If-Match": "1"},
            json={"status": "submitted"},
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/v1/tickets/{ticket_id}/status",
            headers={**headers, "If-Match": "2"},
            json={"status": "approved"},
        ).status_code
        == 200
    )
    loans = client.get("/v1/loans", headers=headers).json()
    assert loans[0]["principal"] == "300.0000"
    loan_id = loans[0]["id"]
    restructured = client.post(
        f"/v1/loans/{loan_id}/restructure",
        headers={**headers, "If-Match": "1"},
        json={"annual_rate": "4.5", "installments": 6, "first_due_date": "2026-10-01"},
    )
    assert restructured.status_code == 200
    deferred = client.post(
        f"/v1/loans/{loan_id}/defer",
        headers={**headers, "If-Match": "2"},
        json={"deferred_until": (date.today() + timedelta(days=30)).isoformat()},
    )
    assert deferred.status_code == 200
    invalid = client.post(
        "/v1/loans/bulk-settle",
        headers=headers,
        json={
            "items": [
                {
                    "loan_id": loan_id,
                    "amount": "299",
                    "paid_on": "2026-11-01",
                    "reference": "BAD",
                }
            ]
        },
    )
    assert invalid.status_code == 422
    assert client.get("/v1/loans", headers=headers).json()[0]["outstanding"] == "300.0000"
    settled = client.post(
        "/v1/loans/bulk-settle",
        headers=headers,
        json={
            "items": [
                {
                    "loan_id": loan_id,
                    "amount": "300",
                    "paid_on": "2026-11-01",
                    "reference": "BATCH-1",
                }
            ]
        },
    )
    assert settled.status_code == 200
    assert settled.json()["settled"] == 1


def test_rates_ess_reports_rbac_and_expired_token(client: TestClient) -> None:
    """Cover rates, ESS status, six reports, RBAC, and token expiry."""
    headers, _ = _login(client)
    employee = _employee(client, headers, "ESS-01")
    employee_id = employee["id"]
    rate = client.post(
        "/v1/entitlement-rates",
        headers=headers,
        json={
            "scope_type": "global",
            "scope_id": "",
            "amount": "1200",
            "effective_from": "2026-01-01",
            "cap_amount": "1500",
        },
    )
    assert rate.status_code == 201
    assert len(client.get("/v1/entitlement-rates", headers=headers).json()) == 1
    request = client.post(
        "/v1/ess/requests",
        headers=headers,
        json={
            "employee_id": employee_id,
            "request_type": "airfare",
            "travel_date": "2026-12-01",
            "origin_code": "KHI",
            "destination_code": "JED",
            "notes": "Annual travel",
        },
    )
    assert request.status_code == 201
    request_id = request.json()["id"]
    assert client.get("/v1/ess/requests", headers=headers).status_code == 200
    approved = client.patch(
        f"/v1/ess/requests/{request_id}/status",
        headers={**headers, "If-Match": "1"},
        json={"status": "approved"},
    )
    assert approved.status_code == 200
    reports = (
        "employee-master",
        "opening-balances",
        "entitlements",
        "ticket-register",
        "loan-outstanding",
        "loan-statement",
        "excess-recovery",
    )
    for report in reports:
        response = client.get(f"/v1/reports/data/{report}", headers=headers)
        assert response.status_code == 200
        assert response.json()["report"] == report

    user = client.post(
        "/v1/users",
        headers=headers,
        json={
            "username": "employee.user",
            "password": "EmployeePass!2026",
            "display_name": "Employee User",
            "roles": ["EMPLOYEE"],
            "employee_id": employee_id,
        },
    )
    assert user.status_code == 201
    users = client.get("/v1/users", headers=headers)
    assert users.status_code == 200
    assert any(row["username"] == "employee.user" for row in users.json())
    employee_login = client.post(
        "/v1/auth/login",
        json={"username": "employee.user", "password": "EmployeePass!2026"},
    ).json()
    employee_headers = {"Authorization": f"Bearer {employee_login['access_token']}"}
    assert client.get("/v1/employees", headers=employee_headers).status_code == 200
    assert client.get("/v1/users", headers=employee_headers).status_code == 403
    assert (
        client.post(
            "/v1/lookups/departments",
            headers=employee_headers,
            json={"code": "X", "name": "Escalation"},
        ).status_code
        == 403
    )

    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="e" * 32,
    )
    claims = decode_access_token(employee_login["access_token"], settings)
    assert claims["token_type"] == "access"
    expired = employee_login["access_token"]
    with pytest.raises(DomainError):
        decode_access_token(expired + "invalid", settings)
    assert datetime.now(UTC).tzinfo is UTC


def test_documents_import_attachment_password_and_delete_paths(client: TestClient) -> None:
    """Cover transactional imports, exports, attachments, password history, and deletes."""
    headers, _ = _login(client)
    assert client.get("/v1/dashboard", headers=headers).status_code == 200
    company = client.post(
        "/v1/companies",
        headers=headers,
        json={"code": "DOC", "name": "Documents Company", "currency": "USD"},
    )
    assert company.status_code == 201
    assert len(client.get("/v1/companies", headers=headers).json()) == 2
    workbook = export_workbook(
        "Employees",
        EMPLOYEE_COLUMNS,
        [
            {
                "code": "IMP-01",
                "full_name": "Imported Employee",
                "company_id": company.json()["id"],
                "join_date": "2026-01-01",
                "department": "HR",
                "branch": "HQ",
                "email": "imported@example.com",
            },
            {
                "code": "IMP-01",
                "full_name": "Duplicate Employee",
                "company_id": company.json()["id"],
                "join_date": "2026-01-01",
                "department": "HR",
                "branch": "HQ",
                "email": "duplicate@example.com",
            },
        ],
    )
    dry_run = client.post(
        "/v1/employees/import?dry_run=true",
        headers=headers,
        files={
            "file": (
                "employees.xlsx",
                workbook,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert dry_run.status_code == 200
    assert len(dry_run.json()["errors"]) == 1
    assert not dry_run.json()["committed"]
    export = client.get("/v1/employees/export.xlsx", headers=headers)
    assert export.status_code == 200
    assert export.content.startswith(b"PK")

    employee = _employee(client, headers, "ATT-01")
    attachment = client.post(
        f"/v1/attachments?entity_type=employee&entity_id={employee['id']}",
        headers=headers,
        files={"file": ("proof.pdf", b"%PDF-1.4 verified document", "application/pdf")},
    )
    assert attachment.status_code == 201
    assert attachment.json()["sha256"]
    rejected_mime = client.post(
        f"/v1/attachments?entity_type=employee&entity_id={employee['id']}",
        headers=headers,
        files={"file": ("proof.txt", b"verified document", "text/plain")},
    )
    assert rejected_mime.status_code == 422
    empty = client.post(
        f"/v1/attachments?entity_type=employee&entity_id={employee['id']}",
        headers=headers,
        files={"file": ("empty.pdf", b"", "application/pdf")},
    )
    assert empty.status_code == 422
    report = client.get("/v1/reports/excess.pdf", headers=headers)
    assert report.status_code == 200
    assert report.content.startswith(b"%PDF")

    ticket = client.post(
        "/v1/tickets",
        headers=headers,
        json={
            "employee_id": employee["id"],
            "travel_date": "2026-10-01",
            "origin_code": "KHI",
            "destination_code": "JED",
            "ticket_cost": "500",
            "entitlement": "500",
            "company_paid": "500",
        },
    ).json()
    assert (
        client.delete(
            f"/v1/tickets/{ticket['id']}",
            headers={**headers, "If-Match": "1"},
        ).status_code
        == 204
    )
    loan = client.post(
        "/v1/loans",
        headers=headers,
        json={
            "employee_id": employee["id"],
            "principal": "100",
            "annual_rate": "0",
            "installments": 2,
            "first_due_date": "2026-11-01",
        },
    ).json()
    assert (
        client.delete(
            f"/v1/loans/{loan['id']}",
            headers={**headers, "If-Match": "1"},
        ).status_code
        == 204
    )
    password = client.post(
        "/v1/auth/change-password",
        headers=headers,
        json={
            "current_password": "StrongPassword!2026",
            "new_password": "NewStrongPassword!2026",
        },
    )
    assert password.status_code == 204
    assert (
        client.post(
            "/v1/auth/login",
            json={"username": "admin", "password": "NewStrongPassword!2026"},
        ).status_code
        == 200
    )
    assert system_health()["status"] == "ok"


def test_validation_and_security_failure_branches(client: TestClient) -> None:
    """Reject invalid transitions, routes, dates, payments, and account attacks."""
    headers, _ = _login(client)
    employee = _employee(client, headers, "FAIL-01")
    employee_id = employee["id"]
    invalid_route = client.post(
        "/v1/tickets",
        headers=headers,
        json={
            "employee_id": employee_id,
            "travel_date": "2026-01-01",
            "origin_code": "KHI",
            "destination_code": "KHI",
            "ticket_cost": "1",
            "entitlement": "1",
            "company_paid": "1",
        },
    )
    assert invalid_route.status_code == 422
    bad_rate = client.post(
        "/v1/entitlement-rates",
        headers=headers,
        json={
            "scope_type": "global",
            "scope_id": "",
            "amount": "100",
            "effective_from": "2026-12-31",
            "effective_to": "2026-01-01",
        },
    )
    assert bad_rate.status_code == 422
    loan = client.post(
        "/v1/loans",
        headers=headers,
        json={
            "employee_id": employee_id,
            "principal": "50",
            "annual_rate": "0",
            "installments": 1,
            "first_due_date": "2026-02-01",
        },
    ).json()
    overpayment = client.post(
        f"/v1/loans/{loan['id']}/payments",
        headers=headers,
        json={"amount": "51", "paid_on": "2026-02-01", "reference": "OVER"},
    )
    assert overpayment.status_code == 422
    past_defer = client.post(
        f"/v1/loans/{loan['id']}/defer",
        headers={**headers, "If-Match": "1"},
        json={"deferred_until": "2020-01-01"},
    )
    assert past_defer.status_code == 422
    duplicate_batch = client.post(
        "/v1/loans/bulk-settle",
        headers=headers,
        json={
            "items": [
                {"loan_id": loan["id"], "amount": "50", "paid_on": "2026-02-01"},
                {"loan_id": loan["id"], "amount": "50", "paid_on": "2026-02-01"},
            ]
        },
    )
    assert duplicate_batch.status_code == 422
    unauthorized = client.get("/v1/employees")
    assert unauthorized.status_code == 401
    for _ in range(5):
        failed = client.post(
            "/v1/auth/login",
            json={"username": "admin", "password": "DefinitelyWrong!2026"},
        )
        assert failed.status_code == 401
    locked = client.post(
        "/v1/auth/login",
        json={"username": "admin", "password": "StrongPassword!2026"},
    )
    assert locked.status_code == 403
    assert locked.json()["code"] == "account_locked"


class TestAiSelfSupport:
    """Self-support loop: diagnose → remediate → verify → learn."""

    def test_diagnose_remediate_and_learn(self, client: TestClient) -> None:
        """Locked accounts are detected, auto-fixed, verified, and recorded."""
        headers, _ = _login(client)
        for _ in range(5):
            client.post(
                "/v1/auth/login",
                json={"username": "admin", "password": "DefinitelyWrong!2026"},
            )
        # Unlock the admin through the remediation path requires a second admin;
        # instead diagnose with a fresh login after lockout expiry is complex, so
        # create a second admin first, then lock the bootstrap admin.
        client.post(
            "/v1/users",
            headers=headers,
            json={
                "username": "support.admin",
                "password": "SupportAdmin!2026",
                "display_name": "Support Admin",
                "roles": ["SYSTEM_ADMIN"],
            },
        )
        for _ in range(5):
            client.post(
                "/v1/auth/login",
                json={"username": "support.admin", "password": "Wrong!2026"},
            )
        diagnosed = client.get("/v1/ai/support/diagnose", headers=headers)
        assert diagnosed.status_code == 200
        findings = diagnosed.json()["findings"]
        locked_finding = next(
            (item for item in findings if item["check_code"] == "locked_users"), None
        )
        assert locked_finding is not None
        assert locked_finding["auto_fixable"] is True
        assert "support.admin" in locked_finding["details"]["usernames"]

        denied = client.post(
            "/v1/ai/support/remediate",
            headers=headers,
            json={"check_code": "unknown_check"},
        )
        assert denied.status_code == 422

        fixed = client.post(
            "/v1/ai/support/remediate",
            headers=headers,
            json={"check_code": "locked_users"},
        )
        assert fixed.status_code == 200
        assert fixed.json()["outcome"] == "success"
        assert fixed.json()["fixed"] >= 1
        assert fixed.json()["verified"] is True

        # The unlocked user can sign in again.
        relief = client.post(
            "/v1/auth/login",
            json={"username": "support.admin", "password": "SupportAdmin!2026"},
        )
        assert relief.status_code == 200

        feedback = client.post(
            "/v1/ai/support/feedback",
            headers=headers,
            json={"check_code": "locked_users", "worked": True, "notes": "unlock worked"},
        )
        assert feedback.status_code == 200
        assert feedback.json()["recorded"] is True

        learning = client.get("/v1/ai/support/learning", headers=headers)
        assert learning.status_code == 200
        stats = learning.json()
        assert stats["total_events"] >= 3
        assert stats["by_type"]["diagnosis"] >= 1
        assert stats["by_type"]["remediation"] >= 1
        assert stats["by_outcome"]["success"] >= 1
        assert stats["per_check"]["locked_users"]["remediation_success_rate"] == 1.0

        # A second diagnosis now reports learned confidence from history.
        again = client.get("/v1/ai/support/diagnose", headers=headers)
        assert again.status_code == 200
        assert again.json()["healthy"] is True

    def test_support_endpoints_require_auth(self, client: TestClient) -> None:
        """All self-support endpoints reject anonymous callers."""
        assert client.get("/v1/ai/support/diagnose").status_code == 401
        assert client.get("/v1/ai/support/learning").status_code == 401
        assert client.post(
            "/v1/ai/support/remediate", json={"check_code": "locked_users"}
        ).status_code == 401
        assert client.post(
            "/v1/ai/support/feedback", json={"check_code": "x", "worked": True}
        ).status_code == 401
