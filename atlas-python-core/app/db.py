from __future__ import annotations

import re
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import mssql_python

from . import config


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_FILE = ROOT / "schema" / "mssql" / "001_core.sql"


def connect(database: str | None = None, autocommit: bool = True):
    return mssql_python.connect(config.connection_string(database), autocommit=autocommit)


def ensure_database() -> None:
    validate_database_name(config.DB_NAME)
    with connect("master") as conn:
        cur = conn.cursor()
        database_identifier = "[" + config.DB_NAME.replace("]", "]]") + "]"
        cur.execute(f"IF DB_ID(?) IS NULL EXEC(N'CREATE DATABASE {database_identifier}');", (config.DB_NAME,))


def initialize() -> dict[str, Any]:
    ensure_database()
    with connect(config.DB_NAME) as conn:
        apply_schema(conn)
        seed(conn)
        return health_probe(conn)


def apply_schema(conn) -> None:
    sql_text = SCHEMA_FILE.read_text(encoding="utf-8")
    for batch in re.split(r"^\s*GO\s*$", sql_text, flags=re.IGNORECASE | re.MULTILINE):
        batch = batch.strip()
        if batch:
            conn.cursor().execute(batch)


def seed(conn) -> None:
    cur = conn.cursor()
    tenant_id = config.TENANT_ID
    company_id = config.COMPANY_ID
    employee_1 = "33333333-3333-4333-8333-333333333333"
    employee_2 = "33333333-3333-4333-8333-333333333334"
    rule_id = "44444444-4444-4444-8444-444444444444"

    cur.execute(
        "IF NOT EXISTS (SELECT 1 FROM core.Tenants WHERE TenantID = ?) "
        "INSERT INTO core.Tenants (TenantID, TenantCode, TenantName) VALUES (?, N'ATLAS', N'ATLAS Greenfield');",
        (tenant_id, tenant_id),
    )
    cur.execute(
        "IF NOT EXISTS (SELECT 1 FROM core.Companies WHERE CompanyID = ?) "
        "INSERT INTO core.Companies (CompanyID, TenantID, CompanyCode, CompanyName) VALUES (?, ?, N'ATLAS', N'ATLAS Airfare HCM');",
        (company_id, company_id, tenant_id),
    )
    cur.execute(
        "IF NOT EXISTS (SELECT 1 FROM core.Employees WHERE EmployeeID = ?) "
        "INSERT INTO core.Employees (EmployeeID, TenantID, CompanyID, EmployeeNumber, DisplayName, WorkEmail, Department, JobTitle, HireDate) "
        "VALUES (?, ?, ?, N'5110', N'test', N'test@example.com', N'Validation', N'Core Employee', '2022-01-01');",
        (employee_1, employee_1, tenant_id, company_id),
    )
    cur.execute(
        "IF NOT EXISTS (SELECT 1 FROM core.Employees WHERE EmployeeID = ?) "
        "INSERT INTO core.Employees (EmployeeID, TenantID, CompanyID, EmployeeNumber, DisplayName, WorkEmail, Department, JobTitle, HireDate) "
        "VALUES (?, ?, ?, N'5111', N'production sample', N'prod@example.com', N'Operations', N'Airfare User', '2023-01-01');",
        (employee_2, employee_2, tenant_id, company_id),
    )
    cur.execute(
        "IF NOT EXISTS (SELECT 1 FROM core.EntitlementRules WHERE RuleID = ?) "
        "INSERT INTO core.EntitlementRules (RuleID, TenantID, CompanyID, RuleCode, RuleName, Cadence, MaxPayoutAmount, EffectiveFrom) "
        "VALUES (?, ?, ?, N'GLOBAL-150', N'Continuous airfare entitlement', N'service_day', 150.000, '2026-01-01');",
        (rule_id, rule_id, tenant_id, company_id),
    )
    cur.execute(
        "IF NOT EXISTS (SELECT 1 FROM core.EntitlementEvents WHERE EmployeeID = ? AND EventType = N'seed' AND SourceReference = N'python-core-seed') "
        "INSERT INTO core.EntitlementEvents (TenantID, CompanyID, EmployeeID, EventDate, EventType, Amount, SourceReference) "
        "VALUES (?, ?, ?, '2026-01-01', N'seed', 60.000, N'python-core-seed');",
        (employee_1, tenant_id, company_id, employee_1),
    )


def health_probe(conn=None) -> dict[str, Any]:
    own_conn = conn is None
    conn = conn or connect(config.DB_NAME)
    try:
        cur = conn.cursor()
        cur.execute("SELECT @@SERVERNAME AS server_name, DB_NAME() AS database_name;")
        server_name, database_name = cur.fetchone()
        cur.execute(
            "SELECT "
            "OBJECT_ID(N'core.Employees', N'U') AS employees_table, "
            "OBJECT_ID(N'core.EntitlementEvents', N'U') AS events_table, "
            "OBJECT_ID(N'core.AirfareAllocations', N'U') AS allocations_table;"
        )
        employees_table, events_table, allocations_table = cur.fetchone()
        return {
            "serverName": server_name,
            "databaseName": database_name,
            "schema": "core",
            "objects": {
                "employees": bool(employees_table),
                "entitlementEvents": bool(events_table),
                "airfareAllocations": bool(allocations_table),
            },
        }
    finally:
        if own_conn:
            conn.close()


def summary(as_of_date: str) -> dict[str, Any]:
    require_iso_date(as_of_date, "asOfDate")
    with connect(config.DB_NAME) as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*), SUM(CASE WHEN StatusCode = N'active' THEN 1 ELSE 0 END) FROM core.Employees;")
        employee_total, employee_active = cur.fetchone()
        cur.execute(
            "SELECT CAST(COALESCE(SUM(CASE WHEN EventType IN (N'seed',N'accrual',N'adjustment',N'reversal') THEN Amount ELSE 0 END),0) AS DECIMAL(12,3)), "
            "CAST(COALESCE(SUM(CASE WHEN EventType = N'usage' THEN Amount ELSE 0 END),0) AS DECIMAL(12,3)) "
            "FROM core.EntitlementEvents WHERE EventDate <= ?;",
            (as_of_date,),
        )
        earned, used = cur.fetchone()
        cur.execute("SELECT COUNT(*), COALESCE(SUM(PrincipalAmount),0), COALESCE(SUM(EmiAmount),0) FROM core.EmployeeLoans WHERE StatusCode = N'active';")
        active_loans, loan_principal, monthly_emi = cur.fetchone()
        balance = money(Decimal(earned or 0) - Decimal(used or 0))
        return {
            "runtime": "GREEN",
            "application": config.APP_NAME,
            "version": config.APP_VERSION,
            "repository": "mssql-python-core",
            "database": config.DB_NAME,
            "asOfDate": as_of_date,
            "employees": {"total": int(employee_total or 0), "active": int(employee_active or 0)},
            "entitlement": {"earned": money(earned), "used": money(used), "balance": balance, "currency": "BHD"},
            "loans": {"active": int(active_loans or 0), "principal": money(loan_principal), "monthlyEmi": money(monthly_emi)},
        }


def list_employees() -> list[dict[str, Any]]:
    with connect(config.DB_NAME) as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT EmployeeID, EmployeeNumber, DisplayName, WorkEmail, Department, JobTitle, StatusCode, CONVERT(char(10), HireDate, 23) "
            "FROM core.Employees ORDER BY EmployeeNumber;"
        )
        return [
            {
                "employeeId": str(row[0]),
                "employeeNumber": row[1],
                "displayName": row[2],
                "workEmail": row[3],
                "department": row[4],
                "jobTitle": row[5],
                "statusCode": row[6],
                "hireDate": row[7],
            }
            for row in cur.fetchall()
        ]


def entitlement_balance(as_of_date: str) -> list[dict[str, Any]]:
    require_iso_date(as_of_date, "asOfDate")
    with connect(config.DB_NAME) as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT e.EmployeeNumber, e.DisplayName, "
            "CAST(COALESCE(SUM(CASE WHEN ev.EventType IN (N'seed',N'accrual',N'adjustment',N'reversal') THEN ev.Amount ELSE 0 END),0) AS DECIMAL(12,3)) AS earned, "
            "CAST(COALESCE(SUM(CASE WHEN ev.EventType = N'usage' THEN ev.Amount ELSE 0 END),0) AS DECIMAL(12,3)) AS used "
            "FROM core.Employees e "
            "LEFT JOIN core.EntitlementEvents ev ON ev.EmployeeID = e.EmployeeID AND ev.EventDate <= ? "
            "GROUP BY e.EmployeeNumber, e.DisplayName ORDER BY e.EmployeeNumber;",
            (as_of_date,),
        )
        rows = []
        for number, name, earned, used in cur.fetchall():
            rows.append({
                "employeeNumber": number,
                "displayName": name,
                "earned": money(earned),
                "used": money(used),
                "balance": money(Decimal(earned or 0) - Decimal(used or 0)),
                "currency": "BHD",
            })
        return rows


def create_employee(payload: dict[str, Any]) -> dict[str, Any]:
    employee_id = str(uuid.uuid4())
    employee_number = required_text(payload, "employeeNumber")
    display_name = required_text(payload, "displayName")
    hire_date = required_text(payload, "hireDate")
    require_iso_date(hire_date, "hireDate")
    with connect(config.DB_NAME) as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO core.Employees (EmployeeID, TenantID, CompanyID, EmployeeNumber, DisplayName, WorkEmail, Department, JobTitle, HireDate) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (
                employee_id,
                config.TENANT_ID,
                config.COMPANY_ID,
                employee_number,
                display_name,
                payload.get("workEmail"),
                payload.get("department"),
                payload.get("jobTitle"),
                hire_date,
            ),
        )
    return {"employeeId": employee_id, "employeeNumber": employee_number, "displayName": display_name, "hireDate": hire_date}


def money(value: Any) -> float:
    return float(Decimal(value or 0).quantize(Decimal("0.001")))


def required_text(payload: dict[str, Any], name: str) -> str:
    value = str(payload.get(name) or "").strip()
    if not value:
        raise ValueError(f"{name} is required.")
    return value


def require_iso_date(value: str, field: str) -> None:
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field} is required in YYYY-MM-DD format.") from exc


def validate_database_name(name: str) -> None:
    if not re.match(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", name):
        raise ValueError("Database name is invalid.")
