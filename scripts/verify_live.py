r"""Live verification for HCM Airfare on port 3389.

Runs HTTP smoke tests against a running API (no TestClient). Cross-checks
allocation math against the ATLAS ``airfare-engine.ts`` 30/360 rules.

Usage:
    python scripts/verify_live.py
    python scripts/verify_live.py --base-url http://127.0.0.1:3389
"""

from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal
import httpx

# Inline ATLAS TS reference (atlas-hcm-next/lib/airfare-engine.ts)
AIRFARE_CYCLE_DAYS = 60
STANDARD_YEAR_DAYS = 360
WORKING_DAYS_PER_AIRFARE_DAY = 30
DEFAULT_MAX_PAYOUT = Decimal("150")


def atlas_round(value: float, digits: int = 2) -> float:
    factor = 10**digits
    return round((value + 1e-12) * factor) / factor


def atlas_current_airfare_days(working_days: int) -> float:
    capped = max(0, min(STANDARD_YEAR_DAYS, working_days))
    return atlas_round((capped / WORKING_DAYS_PER_AIRFARE_DAY) * 2.5, 4)


def atlas_calculate(
    opening_days: float,
    working_days: int,
    paid_days: float,
    maximum_payout: float,
) -> dict[str, float]:
    current = atlas_current_airfare_days(working_days)
    remaining = atlas_round(
        min(AIRFARE_CYCLE_DAYS, max(0, opening_days + current - paid_days)), 4
    )
    cap = max(0, maximum_payout or float(DEFAULT_MAX_PAYOUT))
    payable = min(cap, atlas_round((cap / AIRFARE_CYCLE_DAYS) * remaining, 2))
    return {
        "current_airfare_days": current,
        "remaining_days": remaining,
        "payable_bhd": payable,
    }


class CheckResult:
    def __init__(self) -> None:
        self.passed: list[str] = []
        self.failed: list[str] = []

    def ok(self, name: str, detail: str = "") -> None:
        self.passed.append(f"{name}{': ' + detail if detail else ''}")

    def fail(self, name: str, detail: str) -> None:
        self.failed.append(f"{name}: {detail}")

    @property
    def success(self) -> bool:
        return not self.failed


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify live HCM Airfare API")
    parser.add_argument("--base-url", default="http://127.0.0.1:3389")
    parser.add_argument("--username", default="admin")
    parser.add_argument("--password", default="admin1234567")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    results = CheckResult()

    with httpx.Client(base_url=base, timeout=30.0) as client:
        # Liveness / readiness (FastAPI production pattern)
        health = client.get("/health")
        if health.status_code == 200 and health.json().get("status") == "ok":
            results.ok("GET /health", health.text[:80])
        else:
            results.fail("GET /health", f"{health.status_code} {health.text}")

        ready = client.get("/ready")
        if ready.status_code == 200:
            results.ok("GET /ready")
        else:
            results.fail("GET /ready", f"{ready.status_code} {ready.text}")

        root = client.get("/")
        if root.status_code == 200 and "html" in root.headers.get("content-type", "").lower():
            results.ok("GET / (SPA shell)")
        else:
            ctype = root.headers.get("content-type")
            results.fail("GET /", f"{root.status_code} content-type={ctype}")

        app_js = client.get("/assets/app.js")
        if app_js.status_code == 200 and "ATLAS 30/360 engine" in app_js.text:
            results.ok("GET /assets/app.js", "ATLAS 30/360 allocation wiring")
        else:
            results.fail("GET /assets/app.js", "missing allocation wiring")

        openapi = client.get("/openapi.json")
        if openapi.status_code == 200:
            schema = openapi.json()
            paths = schema.get("paths", {})
            for required in (
                "/v1/allocations/preview",
                "/v1/allocations/issue",
                "/v1/auth/login",
                "/v1/loans/run-emi",
                "/v1/reports/detail/{report_name}",
            ):
                if required in paths:
                    results.ok(f"OpenAPI {required}")
                else:
                    results.fail("OpenAPI schema", f"missing {required}")
        else:
            results.fail("GET /openapi.json", str(openapi.status_code))

        login = client.post(
            "/v1/auth/login",
            json={"username": args.username, "password": args.password},
        )
        if login.status_code != 200:
            results.fail("POST /v1/auth/login", f"{login.status_code} {login.text}")
            return _report(results)

        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        results.ok("POST /v1/auth/login", f"token length {len(token)}")

        me = client.get("/v1/auth/me", headers=headers)
        if me.status_code == 200 and me.json().get("username") == args.username:
            results.ok("GET /v1/auth/me", str(me.json().get("roles")))
        else:
            results.fail("GET /v1/auth/me", me.text)

        dashboard = client.get("/v1/dashboard", headers=headers)
        if dashboard.status_code == 200:
            data = dashboard.json()
            results.ok(
                "GET /v1/dashboard",
                f"employees={data.get('employees')} loans={data.get('active_loans')}",
            )
        else:
            results.fail("GET /v1/dashboard", dashboard.text)

        # Manual allocation preview (matches test_allocation_preview_api_decimal_math)
        preview = client.post(
            "/v1/allocations/preview",
            headers=headers,
            json={
                "as_of_date": "2026-01-11",
                "date_of_joining": "2025-01-01",
                "opening_balance_days": "20",
                "opening_balance_amount": "40",
                "global_company_preference_rate": "150",
                "max_entitlement_cap_rate": "12",
                "requested_ticket_amount": "100",
                "excess_option": "LOAN",
                "tenure_months": 6,
            },
        )
        if preview.status_code == 200:
            body = preview.json()
            if (
                Decimal(body["final_entitlement_amount"]) == Decimal("12.00")
                and Decimal(body["excess_cost"]) == Decimal("88.00")
            ):
                results.ok("Allocation preview (known case)", "12.00 BHD final (capped) / 88.00 excess")
            else:
                results.fail(
                    "Allocation preview (known case)",
                    json.dumps(
                        {
                            "final": body.get("final_entitlement_amount"),
                            "excess": body.get("excess_cost"),
                        }
                    ),
                )
        else:
            results.fail("POST /v1/allocations/preview", f"{preview.status_code} {preview.text}")

        # ATLAS 30/360 + cycle 60: as_of 2026-06-18 from 1 Jan = 168 working days
        # CurrentAirfareDays = 168/30*2.5 = 14; payable = 150/60*14 = 35.00
        june_preview = client.post(
            "/v1/allocations/preview",
            headers=headers,
            json={
                "as_of_date": "2026-06-18",
                "date_of_joining": "2020-01-01",
                "global_company_preference_rate": "150",
                "global_company_preference_days": "60",
            },
        )
        if june_preview.status_code == 200:
            hcm_payable = Decimal(june_preview.json()["final_entitlement_amount"])
            if abs(hcm_payable - Decimal("35.00")) <= Decimal("0.01"):
                results.ok(
                    "ATLAS 30/360 reference (168 working days -> 35.00 BHD)",
                    f"HCM={hcm_payable}",
                )
            else:
                results.fail(
                    "ATLAS 30/360 reference",
                    f"HCM={hcm_payable} expected=35.00",
                )
        else:
            results.fail("June 18 preview", june_preview.text)

        four_preview = client.post(
            "/v1/allocations/preview",
            headers=headers,
            json={
                "as_of_date": "2026-08-18",
                "date_of_joining": "2024-01-01",
                "opening_balance_days": "0",
                "opening_balance_amount": "0",
                "global_company_preference_rate": "150",
                "global_company_preference_days": "365",
            },
        )
        if four_preview.status_code == 200:
            body = four_preview.json()
            payable = Decimal(body["final_entitlement_amount"])
            daily = Decimal(body["daily_rate"])
            if payable == Decimal("47.50") and daily == Decimal("2.5"):
                results.ok(
                    "Employee 0004 reference (228 working days -> 47.50 BHD)",
                    f"daily={daily} payable={payable}",
                )
            else:
                results.fail(
                    "Employee 0004 reference",
                    f"payable={payable} daily={daily} expected 47.50 / 2.5",
                )
        else:
            results.fail("0004 preview", four_preview.text)

        # Employee-bound preview (DB-backed opening balance + rates)
        employees = client.get("/v1/employees?limit=1", headers=headers)
        if employees.status_code == 200 and employees.json():
            employee = employees.json()[0]
            employee_id = employee["id"]
            bound = client.post(
                "/v1/allocations/preview",
                headers=headers,
                json={
                    "employee_id": employee_id,
                    "as_of_date": "2026-06-18",
                },
            )
            if bound.status_code == 200:
                body = bound.json()
                auto_fields = (
                    "days_left",
                    "final_entitlement_amount",
                    "max_payout",
                    "opening_balance_days",
                    "opening_balance_amount",
                    "join_date",
                    "daily_rate",
                    "rate_source",
                    "current_year_earned_days",
                    "current_year_earned_amount",
                )
                missing = [name for name in auto_fields if name not in body]
                if missing:
                    results.fail("Employee-bound auto-fill", f"missing {missing}")
                else:
                    results.ok(
                        "Employee-bound allocation preview auto fields",
                        f"entitlement={body.get('final_entitlement_amount')} days_left={body.get('days_left')}",
                    )
            else:
                results.fail(
                    "Employee-bound allocation preview",
                    f"{bound.status_code} {bound.text}",
                )
            excess = client.post(
                "/v1/allocations/preview",
                headers=headers,
                json={
                    "employee_id": employee_id,
                    "as_of_date": "2026-06-18",
                    "requested_ticket_amount": "9999",
                },
            )
            if excess.status_code == 200 and excess.json().get("excess_requires_choice"):
                results.ok("Excess requires choice when ticket exceeds entitlement")
            elif excess.status_code == 200:
                results.fail(
                    "Excess choice",
                    f"excess_requires_choice={excess.json().get('excess_requires_choice')} excess={excess.json().get('excess_cost')}",
                )
            else:
                results.fail("Excess preview", f"{excess.status_code} {excess.text}")
            emi = client.post(
                "/v1/loans/run-emi",
                headers=headers,
                json={"employee_id": employee_id},
            )
            if emi.status_code == 200 and "loans" in emi.json():
                results.ok(
                    "POST /v1/loans/run-emi",
                    emi.json().get("message") or f"loans={len(emi.json().get('loans') or [])}",
                )
            else:
                results.fail("Run EMI", f"{emi.status_code} {emi.text[:200]}")
        else:
            results.fail("GET /v1/employees", employees.text)

        # RBAC: unauthenticated allocation must 401
        denied = client.post(
            "/v1/allocations/preview",
            json={"as_of_date": "2026-01-11", "global_company_preference_rate": "150"},
        )
        if denied.status_code == 401:
            results.ok("RBAC unauthenticated -> 401")
        else:
            results.fail("RBAC", f"expected 401 got {denied.status_code}")

        reports = client.get("/v1/reports/data/employee-master", headers=headers)
        if reports.status_code == 200:
            results.ok("GET /v1/reports/data/employee-master")
        else:
            results.fail("Reports API", reports.text)

        detail = client.get("/v1/reports/detail/employee-master", headers=headers)
        if detail.status_code == 200 and "columns" in detail.json():
            results.ok(
                "GET /v1/reports/detail/employee-master",
                f"count={detail.json().get('count')}",
            )
        else:
            results.fail("Report detail", f"{detail.status_code} {detail.text[:200]}")

        for report_name in (
            "opening-balances",
            "entitlements",
            "ticket-register",
            "loan-outstanding",
            "loan-statement",
            "excess-recovery",
        ):
            opened = client.get(f"/v1/reports/detail/{report_name}", headers=headers)
            if opened.status_code == 200:
                results.ok(f"Open report {report_name}")
            else:
                results.fail(f"Open report {report_name}", f"{opened.status_code} {opened.text[:200]}")

        templates = client.get("/v1/templates", headers=headers)
        if templates.status_code == 200 and "employees" in templates.json().get("templates", []):
            results.ok("GET /v1/templates")
        else:
            results.fail("Templates catalog", f"{templates.status_code} {templates.text[:200]}")

        template_file = client.get("/v1/templates/employees.xlsx", headers=headers)
        if template_file.status_code == 200 and template_file.content[:2] == b"PK":
            results.ok("GET /v1/templates/employees.xlsx")
        else:
            results.fail("Employee template", f"{template_file.status_code}")

        js = client.get("/assets/app.js")
        for marker in (
            "Import Excel",
            "Excel template",
            "/reports/detail/",
            "/admin/erase-data",
            "/admin/backups",
            "Backup & Restore",
            "native_credentials_ready",
            "Run EMI",
            "Make loan",
            "loan-statement",
            "Ticket amount",
            "Airfare amount policies",
        ):
            if marker in js.text:
                results.ok(f"UI contains {marker}")
            else:
                results.fail("UI script", f"missing {marker}")

        backups = client.get("/v1/admin/backups", headers=headers)
        if backups.status_code == 200 and backups.json().get("native_mssql_available") is True:
            body = backups.json()
            results.ok(
                "GET /v1/admin/backups",
                f"ready={body.get('native_credentials_ready')} count={body.get('count')}",
            )
            logical = client.post(
                "/v1/admin/backups",
                headers=headers,
                json={"kind": "logical"},
            )
            if logical.status_code == 201 and logical.json().get("kind") == "logical":
                results.ok("POST /v1/admin/backups logical", logical.json().get("file_name"))
            else:
                results.fail("Logical backup", f"{logical.status_code} {logical.text[:200]}")
            if body.get("native_credentials_ready"):
                native = client.post(
                    "/v1/admin/backups",
                    headers=headers,
                    json={"kind": "mssql"},
                )
                if native.status_code == 201 and native.json().get("kind") == "mssql":
                    results.ok("POST /v1/admin/backups mssql", native.json().get("file_name"))
                else:
                    results.fail("Native MSSQL backup", f"{native.status_code} {native.text[:300]}")
        else:
            results.fail("Backup catalog", f"{backups.status_code} {backups.text[:200]}")

    return _report(results)


def _report(results: CheckResult) -> int:
    print("=" * 60)
    print("HCM Airfare live verification")
    print("=" * 60)
    for item in results.passed:
        print(f"  PASS  {item}")
    for item in results.failed:
        print(f"  FAIL  {item}")
    print("-" * 60)
    print(f"Passed: {len(results.passed)}  Failed: {len(results.failed)}")
    if results.success:
        print("RESULT: OK")
        return 0
    print("RESULT: FAILED")
    return 1


if __name__ == "__main__":
    sys.exit(main())
