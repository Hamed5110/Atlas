"""Import read-only ATLAS reference data into the HCM Airfare database.

The importer uses deterministic UUIDs and updates matching rows, so repeated runs
are safe. Source credentials are read from ``ATLAS_DATABASE_URL`` or the existing
read-only ATLAS ``.env`` file and are never logged.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable, Mapping
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
from uuid import UUID, uuid5

import pyodbc
from sqlalchemy.orm import Session

from airfare_management.api.main import DEFAULT_COMPANY_ID
from airfare_management.config import Settings
from airfare_management.infrastructure.database import EmployeeRow, create_session_factory
from airfare_management.infrastructure.schema import (
    EntitlementRateRow,
    LoanRow,
    OpeningBalanceRow,
    PreferenceRow,
    TicketRow,
)

NAMESPACE = UUID("f09271c7-d709-4cdf-a8d0-1be76934acc3")
REFERENCE_ENV = Path(r"C:\Airfare_Allowance\.env")
TABLES = (
    "employees",
    "opening_balances",
    "entitlement_rates",
    "tickets",
    "loans",
    "preferences",
)


def stable_id(entity: str, source_id: object) -> str:
    """Return a deterministic UUID string for an ATLAS entity."""
    return str(uuid5(NAMESPACE, f"atlas:{entity}:{source_id}"))


def employee_id(source_id: object) -> UUID:
    """Return the deterministic employee UUID."""
    return UUID(stable_id("employee", source_id))


def read_env(path: Path) -> dict[str, str]:
    """Read a simple dotenv file without exposing its values."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def source_connection() -> pyodbc.Connection:
    """Open the ATLAS database with read-only application intent."""
    env = {**read_env(REFERENCE_ENV), **os.environ}
    url = env.get("ATLAS_DATABASE_URL", "")
    if url:
        parsed = urlparse(url.replace("mssql+pyodbc", "mssql"))
        username = unquote(parsed.username or "sa")
        password = unquote(parsed.password or "")
        server = parsed.hostname or "localhost"
        port = parsed.port or 1433
        database = parsed.path.lstrip("/") or "Atlasairfare010"
    else:
        username = env.get("DB_USER") or env.get("MSSQL_USER") or "sa"
        password = (
            env.get("DB_PASSWORD")
            or env.get("MSSQL_SA_PASSWORD")
            or env.get("MSSQL_PASSWORD")
            or ""
        )
        server, port, database = "localhost", 1433, "Atlasairfare010"
    if not password:
        raise RuntimeError(
            "Set ATLAS_DATABASE_URL or provide the ATLAS DB password in its existing .env."
        )
    connection_string = (
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={server},{port};DATABASE={database};UID={username};PWD={password};"
        "Encrypt=yes;TrustServerCertificate=yes;ApplicationIntent=ReadOnly"
    )
    return pyodbc.connect(connection_string, autocommit=False)


def rows(connection: pyodbc.Connection, query: str) -> list[dict[str, Any]]:
    """Execute a fixed read query and return named rows."""
    cursor = connection.cursor()
    cursor.execute(query)
    columns = [str(column[0]) for column in cursor.description]
    return [dict(zip(columns, record, strict=True)) for record in cursor.fetchall()]


def decimal(value: object, default: str = "0") -> Decimal:
    """Convert a nullable database value to an exact Decimal."""
    return Decimal(str(value)) if value is not None else Decimal(default)


def text(value: object, default: str = "") -> str:
    """Convert a nullable database value to stripped text."""
    return str(value).strip() if value is not None else default


def utc(value: datetime | None) -> datetime:
    """Normalize a SQL Server datetime to timezone-aware UTC."""
    if value is None:
        return datetime.now(UTC)
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def following_month(value: date) -> date:
    """Return the first day of the month following a date."""
    return (value.replace(day=1) + timedelta(days=32)).replace(day=1)


def upsert(
    session: Session, model: type[Any], identifier: str | UUID, values: Mapping[str, Any]
) -> bool:
    """Insert or update a mapped row and report whether it was created."""
    item = session.get(model, identifier)
    if item is None:
        session.add(model(id=identifier, **values))
        return True
    for key, value in values.items():
        setattr(item, key, value)
    return False


def parse_json(value: object) -> object:
    """Parse an ATLAS JSON field while preserving malformed legacy text."""
    raw = text(value)
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"legacy_text": raw}


def import_employees(session: Session, source: Iterable[Mapping[str, Any]]) -> tuple[int, int]:
    """Import employee master rows."""
    created = updated = 0
    for row in source:
        status = text(row["Status"]).casefold()
        values = {
            "company_id": DEFAULT_COMPANY_ID,
            "code": text(row["EmployeeCode"]),
            "full_name": text(row["FullName"]),
            "join_date": row["JoinDate"],
            "department": text(row["Department"]),
            "branch": text(row["Branch"]),
            "pay_group": text(row["EmpGroup"]),
            "repair_center": text(row["Location"]),
            "email": text(row["Email"]) or None,
            "custom_airfare_rate": (
                decimal(row["CurrentAirfareRate"])
                if row["CurrentAirfareRate"] is not None
                else None
            ),
            "max_entitlement_cap_rate": (
                decimal(row["MaximumPayout"]) if row["MaximumPayout"] is not None else None
            ),
            "active": status not in {"inactive", "terminated", "deleted"},
            "version": 1,
            "created_at": utc(row["CreatedAt"]),
            "updated_at": utc(row["UpdatedAt"] or row["CreatedAt"]),
            "deleted_at": None,
        }
        if upsert(session, EmployeeRow, employee_id(row["EmployeeID"]), values):
            created += 1
        else:
            updated += 1
    return created, updated


def import_balances(session: Session, source: Iterable[Mapping[str, Any]]) -> tuple[int, int]:
    """Import opening balances with employee referential integrity."""
    created = updated = 0
    for row in source:
        values = {
            "employee_id": employee_id(row["EmployeeID"]),
            "balance_year": int(row["BalanceYear"]),
            "opening_days": decimal(row["OpeningDays"]),
            "paid_days": Decimal("0"),
            "opening_amount": decimal(row["OpeningBHD"]),
            "maximum_payout": decimal(row["MaximumPayout"]),
            "version": 1,
            "created_at": utc(row["CreatedAt"]),
            "updated_at": utc(row["CreatedAt"]),
            "deleted_at": None,
        }
        if upsert(
            session, OpeningBalanceRow, stable_id("opening_balance", row["BalanceID"]), values
        ):
            created += 1
        else:
            updated += 1
    return created, updated


def rate_scope(row: Mapping[str, Any]) -> tuple[str, str]:
    """Map the ATLAS policy hierarchy to an HCM rate scope."""
    if row["EmployeeID"] is not None:
        return "employee", str(employee_id(row["EmployeeID"]))
    if text(row["EmpGroup"]):
        return "pay_group", text(row["EmpGroup"])
    if text(row["Department"]):
        return "department", text(row["Department"])
    if row["CompanyID"] is not None:
        return "company", str(row["CompanyID"])
    return "global", ""


def import_rates(session: Session, source: Iterable[Mapping[str, Any]]) -> tuple[int, int]:
    """Import effective-dated ATLAS policy rates."""
    created = updated = 0
    for row in source:
        scope_type, scope_id = rate_scope(row)
        deleted_at = row["DeletedAt"] if bool(row["IsDeleted"]) else None
        values = {
            "scope_type": scope_type,
            "scope_id": scope_id,
            "amount": decimal(row["MaxPayoutAmount"]),
            "effective_from": row["EffectiveFrom"],
            "effective_to": row["EffectiveTo"],
            "cap_amount": decimal(row["MaxPayoutAmount"]),
            "created_at": utc(row["CreatedAt"]),
            "updated_at": utc(row["CreatedAt"]),
            "deleted_at": utc(deleted_at) if deleted_at else None,
            "version": 1,
        }
        if upsert(
            session, EntitlementRateRow, stable_id("policy_rate", row["PolicyRateID"]), values
        ):
            created += 1
        else:
            updated += 1
    return created, updated


def ticket_status(value: object) -> str:
    """Map completed ATLAS allocation states into the HCM workflow."""
    return "rejected" if text(value).casefold() == "cancelled" else "approved"


def excess_handling(value: object) -> str:
    """Map ATLAS settlement modes to the supported HCM modes."""
    mode = text(value).casefold()
    if mode == "loan":
        return "CONVERT_TO_LOAN"
    if mode in {"company", "company_full"}:
        return "COMPANY_PAID"
    return "SELF_PAID"


def import_tickets(session: Session, source: Iterable[Mapping[str, Any]]) -> tuple[int, int]:
    """Import ATLAS allocations as HCM ticket transactions."""
    created = updated = 0
    for row in source:
        created_at = utc(row["CreatedAt"])
        values = {
            "employee_id": employee_id(row["EmployeeID"]),
            "travel_date": row["AllocationDate"],
            "origin_code": "BHR",
            "destination_code": "LTA",
            "ticket_cost": decimal(row["TicketCost"]),
            "entitlement": decimal(row["Entitlement"]),
            "company_paid": decimal(row["CompanyPaid"]),
            "excess_handling": excess_handling(row["PaymentMode"]),
            "scenario": "ATLAS_LEGACY",
            "accrued_days": None,
            "daily_rate": (
                decimal(row["PolicyPerDayRate"]) if row["PolicyPerDayRate"] is not None else None
            ),
            "airfare_rate": (
                decimal(row["PolicyMaxPayoutAmount"])
                if row["PolicyMaxPayoutAmount"] is not None
                else None
            ),
            "rate_source": "atlas",
            "excess_cost": decimal(row["ExcessAmount"]),
            "employee_payable": decimal(row["EmployeePaid"]),
            "company_payout": decimal(row["CompanyPaid"]),
            "last_ticket_date": None,
            "as_of_date": row["AllocationDate"],
            "tenure_months": row["Tenure"],
            "status": ticket_status(row["Status"]),
            "notes": text(row["Remarks"]),
            "version": 1,
            "created_at": created_at,
            "updated_at": created_at,
            "deleted_at": None,
        }
        if upsert(session, TicketRow, stable_id("allocation", row["AllocationID"]), values):
            created += 1
        else:
            updated += 1
    return created, updated


def import_loans(session: Session, source: Iterable[Mapping[str, Any]]) -> tuple[int, int]:
    """Import ATLAS loan balances linked to imported allocations."""
    created = updated = 0
    for row in source:
        created_on = row["CreatedDate"] or date.today()
        created_at = utc(row["CreatedAt"])
        status = text(row["Status"], "active").casefold()
        values = {
            "employee_id": employee_id(row["EmployeeID"]),
            "source_ticket_id": (
                stable_id("allocation", row["AllocationID"])
                if row["AllocationID"] is not None
                else None
            ),
            "principal": decimal(row["OriginalAmount"]),
            "annual_rate": Decimal("0"),
            "installments": max(int(row["Tenure"] or 1), 1),
            "monthly_installment": decimal(row["EMI"]),
            "outstanding": decimal(row["RemainingBalance"]),
            "status": status if status in {"active", "settled", "deferred"} else "active",
            "deferred_until": row["DeferStart"] if status == "deferred" else None,
            "first_due_date": following_month(created_on),
            "version": 1,
            "created_at": created_at,
            "updated_at": created_at,
            "deleted_at": None,
        }
        if upsert(session, LoanRow, stable_id("loan", row["LoanID"]), values):
            created += 1
        else:
            updated += 1
    return created, updated


def import_preferences(session: Session, source: Iterable[Mapping[str, Any]]) -> tuple[int, int]:
    """Preserve each ATLAS user preference document as one HCM preference row."""
    created = updated = 0
    for row in source:
        value = {
            "fiscal_year": row["FiscalYear"],
            "selected_company_id": row["SelectedCompanyID"],
            "preferences": parse_json(row["PreferencesJSON"]),
            "theme": parse_json(row["ThemeSettingsJSON"]),
            "layout": parse_json(row["LayoutSettingsJSON"]),
            "navigation": parse_json(row["NavigationSettingsJSON"]),
        }
        values = {
            "scope_type": "user",
            "scope_id": f"atlas:{row['UserID']}",
            "preference_key": "atlas.user_preferences",
            "value": value,
            "is_locked": False,
            "version": 1,
            "created_at": utc(row["CreatedAt"]),
            "updated_at": utc(row["UpdatedAt"] or row["CreatedAt"]),
            "deleted_at": None if bool(row["IsActive"]) else utc(row["UpdatedAt"]),
        }
        if upsert(
            session, PreferenceRow, stable_id("user_preference", row["UserPreferenceID"]), values
        ):
            created += 1
        else:
            updated += 1
    return created, updated


def run() -> dict[str, dict[str, int]]:
    """Run the complete import in one target transaction."""
    source = source_connection()
    try:
        datasets = {
            "employees": rows(source, "SELECT * FROM dbo.Employees"),
            "opening_balances": rows(
                source,
                """
                SELECT ob.*, e.MaximumPayout
                FROM dbo.OpeningBalances ob
                INNER JOIN dbo.Employees e ON e.EmployeeID = ob.EmployeeID
                """,
            ),
            "entitlement_rates": rows(source, "SELECT * FROM dbo.AirfarePolicyRates"),
            "tickets": rows(source, "SELECT * FROM dbo.Allocations"),
            "loans": rows(source, "SELECT * FROM dbo.Loans"),
            "preferences": rows(source, "SELECT * FROM dbo.UserPreferences"),
        }
        source.rollback()
    finally:
        source.close()

    importers = {
        "employees": import_employees,
        "opening_balances": import_balances,
        "entitlement_rates": import_rates,
        "tickets": import_tickets,
        "loans": import_loans,
        "preferences": import_preferences,
    }
    summary: dict[str, dict[str, int]] = {}
    sessions = create_session_factory(Settings())
    with sessions.begin() as session:
        for table in TABLES:
            created, updated = importers[table](session, datasets[table])
            summary[table] = {
                "source": len(datasets[table]),
                "created": created,
                "updated": updated,
            }
    sessions.kw["bind"].dispose()
    return summary


if __name__ == "__main__":
    result = run()
    print("ATLAS import complete (source database was opened read-only).")
    for name in TABLES:
        counts = result[name]
        print(
            f"{name}: source={counts['source']} created={counts['created']} "
            f"updated={counts['updated']}"
        )
