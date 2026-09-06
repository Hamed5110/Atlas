"""Operational backup catalog and logical/native restore helpers.

Inspired by open-source DBManager patterns (list + SHA-256 + confirm restore)
and ATLAS Companies backup/restore UX, adapted for HCM Airfare.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from airfare_management.domain.models import DomainError
from airfare_management.infrastructure.database import EmployeeRow
from airfare_management.infrastructure.schema import (
    CompanyRow,
    DocumentRow,
    EntitlementRateRow,
    EssRequestRow,
    LoanInstallmentRow,
    LoanPaymentRow,
    LoanRow,
    LookupRow,
    OpeningBalanceRow,
    PreferenceRow,
    TicketRow,
    UserRow,
)

LOGICAL_FORMAT = "hcm-airfare-logical-v1"
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")
SAFE_DB_IDENT = re.compile(r"^[A-Za-z0-9_]+$")


def _quote_mssql_database(name: str) -> str:
    """Validate and bracket a SQL Server database identifier."""
    if not SAFE_DB_IDENT.fullmatch(name):
        raise DomainError("invalid_database", "Unsafe database name.")
    return f"[{name}]"


def _run_sqlcmd(*, host: str, user: str, password: str, query: str) -> subprocess.CompletedProcess[str]:
    """Run sqlcmd without putting the password on the process argv."""
    env = {**os.environ, "SQLCMDPASSWORD": password}
    return subprocess.run(
        ["sqlcmd", "-S", host, "-U", user, "-C", "-b", "-Q", query],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


@dataclass(frozen=True, slots=True)
class BackupInfo:
    """One backup file in the catalog."""

    file_name: str
    path: str
    kind: str
    size_bytes: int
    created_at: str
    sha256: str


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    raise TypeError(f"Cannot serialize {type(value)!r}")


def ensure_backup_root(root: str | Path) -> Path:
    """Create the backup directory if missing and return it."""
    path = Path(root).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def sha256_file(path: Path) -> str:
    """Return the hex SHA-256 digest of a file."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _kind_for(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return "logical"
    if suffix == ".bak":
        return "mssql"
    return "other"


def list_backups(root: str | Path) -> list[BackupInfo]:
    """List .json and .bak backups newest first."""
    directory = ensure_backup_root(root)
    rows: list[BackupInfo] = []
    for path in directory.iterdir():
        if not path.is_file() or path.suffix.lower() not in {".json", ".bak"}:
            continue
        created = datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat()
        rows.append(
            BackupInfo(
                file_name=path.name,
                path=str(path),
                kind=_kind_for(path),
                size_bytes=path.stat().st_size,
                created_at=created,
                sha256=sha256_file(path),
            )
        )
    return sorted(rows, key=lambda item: item.created_at, reverse=True)


def resolve_backup_file(root: str | Path, file_name: str) -> Path:
    """Resolve a backup file name under the root, rejecting path traversal."""
    safe = Path(file_name).name
    if safe != file_name or ".." in file_name:
        raise DomainError("invalid_backup", "Backup file name is invalid.")
    path = (ensure_backup_root(root) / safe).resolve()
    root_path = ensure_backup_root(root)
    if not str(path).startswith(str(root_path)) or not path.is_file():
        raise DomainError("not_found", "Backup file not found.")
    return path


def _row_dict(item: object, fields: tuple[str, ...]) -> dict[str, Any]:
    return {name: getattr(item, name) for name in fields}


def export_logical_payload(session: Session) -> dict[str, Any]:
    """Serialize operational tables into a portable JSON document."""
    return {
        "format": LOGICAL_FORMAT,
        "created_at": datetime.now(UTC).isoformat(),
        "tables": {
            "companies": [
                _row_dict(item, ("id", "code", "name", "currency", "active"))
                for item in session.scalars(select(CompanyRow).order_by(CompanyRow.code))
            ],
            "lookups": [
                _row_dict(
                    item, ("id", "lookup_type", "code", "name", "active", "version")
                )
                for item in session.scalars(
                    select(LookupRow).where(LookupRow.deleted_at.is_(None)).order_by(
                        LookupRow.lookup_type, LookupRow.code
                    )
                )
            ],
            "employees": [
                _row_dict(
                    item,
                    (
                        "id",
                        "company_id",
                        "code",
                        "full_name",
                        "join_date",
                        "department",
                        "branch",
                        "pay_group",
                        "repair_center",
                        "designation",
                        "nationality",
                        "passport_no",
                        "email",
                        "custom_airfare_rate",
                        "max_entitlement_cap_rate",
                        "active",
                        "version",
                    ),
                )
                for item in session.scalars(
                    select(EmployeeRow).where(EmployeeRow.deleted_at.is_(None)).order_by(
                        EmployeeRow.code
                    )
                )
            ],
            "opening_balances": [
                _row_dict(
                    item,
                    (
                        "id",
                        "employee_id",
                        "balance_year",
                        "opening_days",
                        "paid_days",
                        "opening_amount",
                        "maximum_payout",
                        "version",
                    ),
                )
                for item in session.scalars(
                    select(OpeningBalanceRow).where(OpeningBalanceRow.deleted_at.is_(None))
                )
            ],
            "entitlement_rates": [
                _row_dict(
                    item,
                    (
                        "id",
                        "scope_type",
                        "scope_id",
                        "amount",
                        "effective_from",
                        "effective_to",
                        "cap_amount",
                        "version",
                    ),
                )
                for item in session.scalars(
                    select(EntitlementRateRow).where(EntitlementRateRow.deleted_at.is_(None))
                )
            ],
            "preferences": [
                _row_dict(
                    item,
                    (
                        "id",
                        "scope_type",
                        "scope_id",
                        "preference_key",
                        "value",
                        "is_locked",
                        "version",
                    ),
                )
                for item in session.scalars(
                    select(PreferenceRow).where(PreferenceRow.deleted_at.is_(None))
                )
            ],
            "tickets": [
                _row_dict(
                    item,
                    (
                        "id",
                        "employee_id",
                        "travel_date",
                        "origin_code",
                        "destination_code",
                        "ticket_cost",
                        "entitlement",
                        "company_paid",
                        "excess_handling",
                        "status",
                        "notes",
                        "ticket_number",
                        "version",
                    ),
                )
                for item in session.scalars(
                    select(TicketRow).where(TicketRow.deleted_at.is_(None))
                )
            ],
            "loans": [
                _row_dict(
                    item,
                    (
                        "id",
                        "employee_id",
                        "source_ticket_id",
                        "principal",
                        "annual_rate",
                        "installments",
                        "monthly_installment",
                        "outstanding",
                        "status",
                        "deferred_until",
                        "first_due_date",
                        "loan_number",
                        "version",
                    ),
                )
                for item in session.scalars(select(LoanRow).where(LoanRow.deleted_at.is_(None)))
            ],
            "loan_payments": [
                _row_dict(item, ("id", "loan_id", "amount", "paid_on", "reference", "version"))
                for item in session.scalars(
                    select(LoanPaymentRow).where(LoanPaymentRow.deleted_at.is_(None))
                )
            ],
            "loan_installments": [
                _row_dict(
                    item,
                    (
                        "id",
                        "loan_id",
                        "number",
                        "due_date",
                        "opening_balance",
                        "principal",
                        "interest",
                        "payment",
                        "closing_balance",
                        "version",
                    ),
                )
                for item in session.scalars(
                    select(LoanInstallmentRow).where(LoanInstallmentRow.deleted_at.is_(None))
                )
            ],
            "ess_requests": [
                _row_dict(
                    item,
                    (
                        "id",
                        "employee_id",
                        "request_type",
                        "travel_date",
                        "origin_code",
                        "destination_code",
                        "status",
                        "notes",
                        "version",
                    ),
                )
                for item in session.scalars(
                    select(EssRequestRow).where(EssRequestRow.deleted_at.is_(None))
                )
            ],
            "documents": [
                _row_dict(
                    item,
                    (
                        "id",
                        "document_number",
                        "kind",
                        "employee_id",
                        "template_key",
                        "title",
                        "status",
                        "params",
                        "pdf_key",
                        "issued_at",
                        "issued_by",
                        "version",
                    ),
                )
                for item in session.scalars(
                    select(DocumentRow).where(DocumentRow.deleted_at.is_(None))
                )
            ],
        },
    }


def create_logical_backup(session: Session, root: str | Path, label: str = "HCM") -> BackupInfo:
    """Write a logical JSON backup and return catalog metadata."""
    directory = ensure_backup_root(root)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    safe_label = SAFE_NAME.sub("_", label) or "HCM"
    path = directory / f"{safe_label}-logical-{stamp}.json"
    payload = export_logical_payload(session)
    path.write_text(json.dumps(payload, default=_json_default, indent=2), encoding="utf-8")
    return BackupInfo(
        file_name=path.name,
        path=str(path),
        kind="logical",
        size_bytes=path.stat().st_size,
        created_at=datetime.now(UTC).isoformat(),
        sha256=sha256_file(path),
    )


def prune_backups(root: str | Path, retention_days: int) -> int:
    """Delete backup files older than retention_days. Returns deleted count."""
    if retention_days <= 0:
        return 0
    cutoff = datetime.now(UTC).timestamp() - retention_days * 86400
    deleted = 0
    for path in ensure_backup_root(root).iterdir():
        if path.is_file() and path.suffix.lower() in {".json", ".bak"} and path.stat().st_mtime < cutoff:
            path.unlink(missing_ok=True)
            deleted += 1
    return deleted


def _database_name_from_url(database_url: str) -> str:
    match = re.search(r"/([^/?]+)(?:\?|$)", database_url.split("@")[-1])
    return match.group(1) if match else "HCM_Airfare_Management"


def _is_mssql(database_url: str) -> bool:
    return database_url.startswith("mssql")


def parse_mssql_url(database_url: str) -> dict[str, str | None]:
    """Extract server/user/password/database from a SQLAlchemy MSSQL URL."""
    from urllib.parse import unquote, urlparse

    parsed = urlparse(database_url)
    server = parsed.hostname or "127.0.0.1"
    if parsed.port:
        server = f"{server},{parsed.port}"
    return {
        "server": server,
        "user": unquote(parsed.username) if parsed.username else None,
        "password": unquote(parsed.password) if parsed.password else None,
        "database": _database_name_from_url(database_url),
    }


def resolve_mssql_login(
    database_url: str,
    *,
    db_user: str | None,
    db_password: str | None,
    server: str | None = None,
) -> tuple[str, str, str, str]:
    """Prefer explicit AIRFARE_DB_* values, otherwise parse AIRFARE_DATABASE_URL."""
    parsed = parse_mssql_url(database_url)
    user = (db_user or parsed["user"] or "").strip()
    password = db_password if db_password not in (None, "") else (parsed["password"] or "")
    # Prefer URL host unless an explicit backup login pair is configured.
    if db_user and server:
        host = server.strip()
    else:
        host = str(parsed["server"] or server or "127.0.0.1").strip()
    database = str(parsed["database"] or "HCM_Airfare_Management")
    if not user or password is None or str(password) == "":
        raise DomainError(
            "credentials_required",
            "Native MSSQL backup needs SQL login. Put user:password in AIRFARE_DATABASE_URL "
            "(the same URL the API uses), or set AIRFARE_DB_USER and AIRFARE_DB_PASSWORD.",
        )
    return user, str(password), host, database


def _execute_mssql_batches(database_url: str, batches: list[str]) -> None:
    """Run T-SQL that cannot live in a transaction (BACKUP/RESTORE) via pyodbc autocommit."""
    from sqlalchemy import create_engine

    # Research: BACKUP/RESTORE require autocommit; same URL the API already uses.
    engine = create_engine(database_url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            raw = connection.connection.dbapi_connection
            cursor = raw.cursor()
            try:
                for batch in batches:
                    cursor.execute(batch)
                    while cursor.nextset():
                        pass
            finally:
                cursor.close()
    finally:
        engine.dispose()


def create_native_mssql_backup(
    *,
    database_url: str,
    root: str | Path,
    db_user: str | None,
    db_password: str | None,
    server: str = "127.0.0.1",
) -> BackupInfo:
    """Create a native SQL Server .bak using the app connection (pyodbc) or sqlcmd fallback."""
    if not _is_mssql(database_url):
        raise DomainError(
            "native_unavailable",
            "Native MSSQL backup requires an mssql+pyodbc database URL.",
        )
    user, password, host, database = resolve_mssql_login(
        database_url, db_user=db_user, db_password=db_password, server=server or None
    )
    directory = ensure_backup_root(root)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    path = directory / f"{SAFE_NAME.sub('_', database)}-{stamp}.bak"
    escaped = str(path).replace("'", "''")
    db_ident = _quote_mssql_database(database)
    backup_sql = (
        f"BACKUP DATABASE {db_ident} TO DISK = N'{escaped}' "
        "WITH COPY_ONLY, COMPRESSION, CHECKSUM, INIT, STATS = 10"
    )
    verify_sql = f"RESTORE VERIFYONLY FROM DISK = N'{escaped}' WITH CHECKSUM"
    try:
        _execute_mssql_batches(database_url, [backup_sql, verify_sql])
    except Exception as pyodbc_error:  # noqa: BLE001 - fall back to sqlcmd
        completed = _run_sqlcmd(
            host=host, user=user, password=password, query=f"{backup_sql}; {verify_sql};"
        )
        if completed.returncode != 0 or not path.is_file():
            detail = (
                completed.stderr or completed.stdout or str(pyodbc_error) or "backup failed"
            ).strip()
            raise DomainError("backup_failed", f"Native MSSQL backup failed: {detail[:400]}") from pyodbc_error
    if not path.is_file():
        raise DomainError(
            "backup_failed",
            "Native backup finished without creating a .bak file. "
            "Check that the SQL Server service account can write to the backup folder.",
        )
    return BackupInfo(
        file_name=path.name,
        path=str(path),
        kind="mssql",
        size_bytes=path.stat().st_size,
        created_at=datetime.now(UTC).isoformat(),
        sha256=sha256_file(path),
    )


def restore_native_mssql(
    *,
    database_url: str,
    backup_path: Path,
    db_user: str | None,
    db_password: str | None,
    server: str = "127.0.0.1",
) -> dict[str, Any]:
    """Restore a native .bak after exclusive access (WITH REPLACE)."""
    if not _is_mssql(database_url):
        raise DomainError("native_unavailable", "Native restore requires MSSQL.")
    if backup_path.suffix.lower() != ".bak":
        raise DomainError("invalid_backup", "Native restore requires a .bak file.")
    user, password, host, database = resolve_mssql_login(
        database_url, db_user=db_user, db_password=db_password, server=server or None
    )
    escaped = str(backup_path).replace("'", "''")
    db_ident = _quote_mssql_database(database)
    batches = [
        f"ALTER DATABASE {db_ident} SET SINGLE_USER WITH ROLLBACK IMMEDIATE",
        f"RESTORE DATABASE {db_ident} FROM DISK = N'{escaped}' WITH REPLACE, CHECKSUM",
        f"ALTER DATABASE {db_ident} SET MULTI_USER",
    ]
    try:
        _execute_mssql_batches(database_url, batches)
    except Exception as pyodbc_error:  # noqa: BLE001
        query = ";\n".join(batches) + ";"
        completed = _run_sqlcmd(host=host, user=user, password=password, query=query)
        if completed.returncode != 0:
            detail = (
                completed.stderr or completed.stdout or str(pyodbc_error) or "restore failed"
            ).strip()
            raise DomainError("restore_failed", f"Native MSSQL restore failed: {detail[:400]}") from pyodbc_error
    return {
        "status": "restored",
        "kind": "mssql",
        "database": database,
        "file_name": backup_path.name,
    }


def restore_logical_backup(
    session: Session,
    backup_path: Path,
    *,
    erase_fn: Any,
    seed_preferences_fn: Any,
) -> dict[str, Any]:
    """Replace operational data from a logical JSON backup."""
    if backup_path.suffix.lower() != ".json":
        raise DomainError("invalid_backup", "Logical restore requires a .json backup.")
    payload = json.loads(backup_path.read_text(encoding="utf-8"))
    if payload.get("format") != LOGICAL_FORMAT:
        raise DomainError("invalid_backup", "Unsupported logical backup format.")
    tables = payload.get("tables") or {}
    erased = erase_fn(session)
    restored_counts: dict[str, int] = {}

    def _load(model: type, rows: list[dict[str, Any]], transform: Any | None = None) -> None:
        count = 0
        for raw in rows:
            data = transform(raw) if transform else dict(raw)
            session.add(model(**data))
            count += 1
        restored_counts[model.__tablename__] = count

    # Keep existing companies/users; re-seed companies only when empty.
    if session.scalar(select(CompanyRow).limit(1)) is None:
        _load(CompanyRow, tables.get("companies") or [])
    if session.scalar(select(LookupRow).where(LookupRow.deleted_at.is_(None)).limit(1)) is None:
        now = datetime.now(UTC)
        for raw in tables.get("lookups") or []:
            session.add(
                LookupRow(
                    id=str(raw["id"]),
                    lookup_type=raw["lookup_type"],
                    code=raw["code"],
                    name=raw["name"],
                    active=bool(raw.get("active", True)),
                    version=int(raw.get("version") or 1),
                    created_at=now,
                    updated_at=now,
                )
            )
        restored_counts["lookups"] = len(tables.get("lookups") or [])

    from datetime import date as date_cls

    def _employee(raw: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC)
        return {
            "id": UUID(str(raw["id"])),
            "company_id": str(raw["company_id"]),
            "code": raw["code"],
            "full_name": raw["full_name"],
            "join_date": date_cls.fromisoformat(str(raw["join_date"])),
            "department": raw.get("department") or "",
            "branch": raw.get("branch") or "",
            "pay_group": raw.get("pay_group") or "",
            "repair_center": raw.get("repair_center") or "",
            "designation": raw.get("designation") or "",
            "nationality": raw.get("nationality") or "",
            "passport_no": raw.get("passport_no") or "",
            "email": raw.get("email"),
            "custom_airfare_rate": (
                Decimal(str(raw["custom_airfare_rate"]))
                if raw.get("custom_airfare_rate") is not None
                else None
            ),
            "max_entitlement_cap_rate": (
                Decimal(str(raw["max_entitlement_cap_rate"]))
                if raw.get("max_entitlement_cap_rate") is not None
                else None
            ),
            "active": bool(raw.get("active", True)),
            "version": int(raw.get("version") or 1),
            "created_at": now,
            "updated_at": now,
        }

    _load(EmployeeRow, tables.get("employees") or [], _employee)
    session.flush()

    def _balance(raw: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC)
        return {
            "id": str(raw["id"]),
            "employee_id": UUID(str(raw["employee_id"])),
            "balance_year": int(raw["balance_year"]),
            "opening_days": Decimal(str(raw["opening_days"])),
            "paid_days": Decimal(str(raw.get("paid_days") or 0)),
            "opening_amount": Decimal(str(raw["opening_amount"])),
            "maximum_payout": Decimal(str(raw.get("maximum_payout") or 0)),
            "version": int(raw.get("version") or 1),
            "created_at": now,
            "updated_at": now,
        }

    _load(OpeningBalanceRow, tables.get("opening_balances") or [], _balance)

    def _rate(raw: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC)
        return {
            "id": str(raw["id"]),
            "scope_type": raw["scope_type"],
            "scope_id": raw.get("scope_id") or "",
            "amount": Decimal(str(raw["amount"])),
            "effective_from": date_cls.fromisoformat(str(raw["effective_from"])),
            "effective_to": (
                date_cls.fromisoformat(str(raw["effective_to"]))
                if raw.get("effective_to")
                else None
            ),
            "cap_amount": (
                Decimal(str(raw["cap_amount"])) if raw.get("cap_amount") is not None else None
            ),
            "version": int(raw.get("version") or 1),
            "created_at": now,
            "updated_at": now,
        }

    _load(EntitlementRateRow, tables.get("entitlement_rates") or [], _rate)

    for raw in tables.get("preferences") or []:
        session.add(
            PreferenceRow(
                id=str(raw["id"]),
                scope_type=raw["scope_type"],
                scope_id=raw.get("scope_id") or "",
                preference_key=raw["preference_key"],
                value=raw.get("value"),
                is_locked=bool(raw.get("is_locked", False)),
                version=int(raw.get("version") or 1),
            )
        )
    restored_counts["preferences"] = len(tables.get("preferences") or [])

    def _ticket(raw: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC)
        return {
            "id": str(raw["id"]),
            "employee_id": UUID(str(raw["employee_id"])),
            "travel_date": date_cls.fromisoformat(str(raw["travel_date"])),
            "origin_code": raw["origin_code"],
            "destination_code": raw["destination_code"],
            "ticket_cost": Decimal(str(raw["ticket_cost"])),
            "entitlement": Decimal(str(raw["entitlement"])),
            "company_paid": Decimal(str(raw["company_paid"])),
            "excess_handling": raw.get("excess_handling") or "SELF_PAID",
            "status": raw.get("status") or "draft",
            "notes": raw.get("notes") or "",
            "ticket_number": raw.get("ticket_number"),
            "version": int(raw.get("version") or 1),
            "created_at": now,
            "updated_at": now,
        }

    _load(TicketRow, tables.get("tickets") or [], _ticket)
    session.flush()

    def _loan(raw: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC)
        return {
            "id": str(raw["id"]),
            "employee_id": UUID(str(raw["employee_id"])),
            "source_ticket_id": raw.get("source_ticket_id"),
            "principal": Decimal(str(raw["principal"])),
            "annual_rate": Decimal(str(raw["annual_rate"])),
            "installments": int(raw["installments"]),
            "monthly_installment": Decimal(str(raw["monthly_installment"])),
            "outstanding": Decimal(str(raw["outstanding"])),
            "status": raw.get("status") or "active",
            "deferred_until": (
                date_cls.fromisoformat(str(raw["deferred_until"]))
                if raw.get("deferred_until")
                else None
            ),
            "first_due_date": date_cls.fromisoformat(str(raw["first_due_date"])),
            "loan_number": raw.get("loan_number"),
            "version": int(raw.get("version") or 1),
            "created_at": now,
            "updated_at": now,
        }

    _load(LoanRow, tables.get("loans") or [], _loan)
    session.flush()

    def _payment(raw: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC)
        return {
            "id": str(raw["id"]),
            "loan_id": str(raw["loan_id"]),
            "amount": Decimal(str(raw["amount"])),
            "paid_on": date_cls.fromisoformat(str(raw["paid_on"])),
            "reference": raw.get("reference") or "",
            "version": int(raw.get("version") or 1),
            "created_at": now,
            "updated_at": now,
        }

    _load(LoanPaymentRow, tables.get("loan_payments") or [], _payment)

    def _installment(raw: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC)
        return {
            "id": str(raw["id"]),
            "loan_id": str(raw["loan_id"]),
            "number": int(raw["number"]),
            "due_date": date_cls.fromisoformat(str(raw["due_date"])),
            "opening_balance": Decimal(str(raw["opening_balance"])),
            "principal": Decimal(str(raw["principal"])),
            "interest": Decimal(str(raw["interest"])),
            "payment": Decimal(str(raw["payment"])),
            "closing_balance": Decimal(str(raw["closing_balance"])),
            "version": int(raw.get("version") or 1),
            "created_at": now,
            "updated_at": now,
        }

    _load(LoanInstallmentRow, tables.get("loan_installments") or [], _installment)

    def _ess(raw: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC)
        return {
            "id": str(raw["id"]),
            "employee_id": UUID(str(raw["employee_id"])),
            "request_type": raw["request_type"],
            "travel_date": date_cls.fromisoformat(str(raw["travel_date"])),
            "origin_code": raw["origin_code"],
            "destination_code": raw["destination_code"],
            "status": raw.get("status") or "submitted",
            "notes": raw.get("notes") or "",
            "version": int(raw.get("version") or 1),
            "created_at": now,
            "updated_at": now,
        }

    _load(EssRequestRow, tables.get("ess_requests") or [], _ess)

    def _document(raw: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC)
        issued_at = raw.get("issued_at")
        return {
            "id": str(raw["id"]),
            "document_number": raw.get("document_number"),
            "kind": raw["kind"],
            "employee_id": UUID(str(raw["employee_id"])),
            "template_key": raw["template_key"],
            "title": raw["title"],
            "status": raw.get("status") or "issued",
            "params": dict(raw.get("params") or {}),
            "pdf_key": raw.get("pdf_key"),
            "issued_at": (
                datetime.fromisoformat(str(issued_at)) if issued_at else now
            ),
            "issued_by": raw.get("issued_by"),
            "version": int(raw.get("version") or 1),
            "created_at": now,
            "updated_at": now,
        }

    _load(DocumentRow, tables.get("documents") or [], _document)
    seed_preferences_fn(session)
    session.flush()
    return {
        "status": "restored",
        "kind": "logical",
        "file_name": backup_path.name,
        "erased": erased,
        "restored": restored_counts,
    }


def unlink_users_from_employees(session: Session) -> int:
    """Clear user→employee links before deleting employees."""
    count = 0
    for user in session.scalars(select(UserRow).where(UserRow.employee_id.is_not(None))):
        user.employee_id = None
        count += 1
    return count
