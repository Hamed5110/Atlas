from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

ROOT = Path(__file__).resolve().parents[1]
LOG_DIR = Path(os.getenv("ATLAS_PYTHON_LOG_DIR", str(ROOT / "logs")))
SCHEMA_FILES = [ROOT / "schema" / "mssql" / "Port3388_Complete_Schema.sql"]


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def log(event: str, **payload) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    record = {"timestampUtc": now_utc(), "event": event, **payload}
    line = json.dumps(record, separators=(",", ":"), default=str)
    print(line)
    with (LOG_DIR / "migrate_and_seed.log").open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def database_name() -> str:
    name = env("ATLAS_PYTHON_DB_NAME", env("DB_NAME", "AtlasPythonCore3388"))
    if not re.match(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", name):
        raise RuntimeError(f"Unsafe database name: {name!r}")
    return name


def build_url(database: str) -> str:
    from urllib.parse import quote_plus

    server = env("ATLAS_PYTHON_DB_SERVER", env("DB_SERVER", "localhost"))
    port = env("ATLAS_PYTHON_DB_PORT", env("DB_PORT", "1433"))
    username = env("ATLAS_PYTHON_DB_USER", env("DB_USER", "sa"))
    password = env("ATLAS_PYTHON_DB_PASSWORD", env("DB_PASSWORD", "Atlas@25"))
    driver = env("ATLAS_PYTHON_ODBC_DRIVER", "ODBC Driver 18 for SQL Server")
    encrypt = env("ATLAS_PYTHON_ENCRYPT", "yes")
    trust = env("ATLAS_PYTHON_TRUST_CERT", "yes")
    odbc = (
        f"DRIVER={{{driver}}};"
        f"SERVER={server},{port};"
        f"DATABASE={database};"
        f"UID={username};"
        f"PWD={password};"
        f"Encrypt={encrypt};"
        f"TrustServerCertificate={trust};"
        "Connection Timeout=30;"
    )
    return "mssql+pyodbc:///?odbc_connect=" + quote_plus(odbc)


def engine(database: str) -> Engine:
    return create_engine(build_url(database), future=True, pool_pre_ping=True)


def split_batches(sql_text: str) -> list[str]:
    cleaned = sql_text.lstrip("\ufeff")
    return [batch.strip().lstrip("\ufeff") for batch in re.split(r"^\s*GO\s*$", cleaned, flags=re.IGNORECASE | re.MULTILINE) if batch.strip().lstrip("\ufeff")]


def ensure_database_exists(target_db: str) -> None:
    master_engine = engine("master")
    with master_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        exists = connection.execute(text("SELECT DB_ID(:db_name)"), {"db_name": target_db}).scalar()
        if exists is None:
            log("database.create.start", database=target_db)
            safe_name = "[" + target_db.replace("]", "]]") + "]"
            connection.exec_driver_sql(f"CREATE DATABASE {safe_name}")
            log("database.create.done", database=target_db)
        else:
            log("database.exists", database=target_db)


def execute_schema_files(target_db: str) -> None:
    db_engine = engine(target_db)
    for file_path in SCHEMA_FILES:
        if not file_path.exists():
            raise RuntimeError(f"Schema file missing: {file_path}")
        log("schema.apply.start", file=str(file_path))
        for index, batch in enumerate(split_batches(file_path.read_text(encoding="utf-8")), start=1):
            try:
                with db_engine.begin() as connection:
                    connection.exec_driver_sql(batch)
            except Exception as exc:
                log("schema.apply.fail", file=str(file_path), batch=index, error=str(exc))
                raise
        log("schema.apply.done", file=str(file_path))


def seed_system_data(target_db: str) -> None:
    db_engine = engine(target_db)
    with db_engine.begin() as connection:
        log("seed.start", database=target_db)
        settings = [
            ("currency.default", "BHD", "string", False),
            ("wps.enabled", "true", "boolean", False),
            ("wps.company.bank.code", "CONFIGURE", "string", False),
            ("working_days_per_month", "26", "number", False),
            ("security.jwt.issuer", "atlas-python-core-3388", "string", False),
            ("airfare.monthly_rate_bhd", "150.000", "number", False),
        ]
        for key, value, value_type, is_secret in settings:
            connection.execute(
                text(
                    """
                    MERGE core.SystemSettings AS target
                    USING (SELECT :key AS SettingKey) AS source
                    ON target.SettingKey = source.SettingKey
                    WHEN MATCHED THEN UPDATE SET SettingValue = :value, ValueType = :value_type, IsSecret = :is_secret, UpdatedAtUtc = SYSUTCDATETIME()
                    WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, ValueType, IsSecret) VALUES (:key, :value, :value_type, :is_secret);
                    """
                ),
                {"key": key, "value": value, "value_type": value_type, "is_secret": is_secret},
            )

        roles = [
            ("superadmin", "Admin"),
            ("hr.manager", "HR"),
            ("payroll.officer", "Payroll"),
            ("employee.portal", "Viewer"),
        ]
        for username, role_code in roles:
            connection.execute(
                text(
                    """
                    IF NOT EXISTS (SELECT 1 FROM core.UserRoles WHERE Username = :username AND RoleCode = :role_code)
                    INSERT INTO core.UserRoles (Username, RoleCode) VALUES (:username, :role_code);
                    """
                ),
                {"username": username, "role_code": role_code},
            )

        airports = [
            ("BAH", "Bahrain International Airport", "Manama", "BH", "GCC"),
            ("DXB", "Dubai International Airport", "Dubai", "AE", "GCC"),
            ("DMM", "King Fahd International Airport", "Dammam", "SA", "GCC"),
            ("DOH", "Hamad International Airport", "Doha", "QA", "GCC"),
            ("KWI", "Kuwait International Airport", "Kuwait City", "KW", "GCC"),
            ("BOM", "Chhatrapati Shivaji Maharaj International Airport", "Mumbai", "IN", "INDIA"),
            ("COK", "Cochin International Airport", "Kochi", "IN", "INDIA"),
            ("DEL", "Indira Gandhi International Airport", "Delhi", "IN", "INDIA"),
            ("MAA", "Chennai International Airport", "Chennai", "IN", "INDIA"),
            ("LHE", "Allama Iqbal International Airport", "Lahore", "PK", "PAKISTAN"),
        ]
        for code, name, city, country, sector in airports:
            connection.execute(
                text(
                    """
                    MERGE core.Airports AS target
                    USING (SELECT :code AS IATACode) AS source
                    ON target.IATACode = source.IATACode
                    WHEN MATCHED THEN UPDATE SET AirportName = :name, CityName = :city, CountryCode = :country, SectorCode = :sector, IsActive = 1
                    WHEN NOT MATCHED THEN INSERT (IATACode, AirportName, CityName, CountryCode, SectorCode) VALUES (:code, :name, :city, :country, :sector);
                    """
                ),
                {"code": code, "name": name, "city": city, "country": country, "sector": sector},
            )
        log("seed.done", settings=len(settings), roles=len(roles), airports=len(airports))


def verify_schema(target_db: str) -> None:
    required_tables = [
        "Employees",
        "ImportBatches",
        "ImportPreviewSessions",
        "AirfareClaims",
        "Loans",
        "SeedEvidence",
        "ReportRuns",
        "SystemSettings",
        "SelfServiceRequestsV2",
        "DocumentMetadata",
        "Airports",
        "AuditLogs",
        "BackupJobs",
    ]
    required_indexes = [
        "IX_core_Employees_EmployeeCode",
        "IX_core_Employees_DepartmentID",
        "IX_core_Employees_Status",
        "IX_core_ImportPreviewSessions_Expiry",
        "IX_core_AirfareClaims_EmployeeStatus",
        "IX_core_Loans_EmployeeStatus",
        "IX_core_Airports_Search",
        "IX_core_AuditLogs_Created",
    ]
    with engine(target_db).connect() as connection:
        missing_tables = [
            table
            for table in required_tables
            if connection.execute(text("SELECT OBJECT_ID(:object_name, 'U')"), {"object_name": f"core.{table}"}).scalar() is None
        ]
        if missing_tables:
            raise RuntimeError(f"Missing required tables: {missing_tables}")

        employee_id_type = connection.execute(
            text(
                """
                SELECT TYPE_NAME(user_type_id)
                FROM sys.columns
                WHERE object_id = OBJECT_ID(N'core.Employees') AND name = N'EmployeeID'
                """
            )
        ).scalar()
        if str(employee_id_type).lower() != "int":
            raise RuntimeError(f"Incompatible core.Employees.EmployeeID type: expected int, found {employee_id_type}. Use a fresh Port 3388 database or migrate cleanly.")

        missing_indexes = [
            index
            for index in required_indexes
            if connection.execute(text("SELECT 1 FROM sys.indexes WHERE name = :name"), {"name": index}).scalar() is None
        ]
        if missing_indexes:
            raise RuntimeError(f"Missing required indexes: {missing_indexes}")

        fk_count = connection.execute(text("SELECT COUNT(*) FROM sys.foreign_keys WHERE schema_id = SCHEMA_ID(N'core') AND is_disabled = 0")).scalar()
        if int(fk_count or 0) < 8:
            raise RuntimeError(f"Foreign key verification failed: expected at least 8 active FKs, found {fk_count}.")

        trigger_exists = connection.execute(text("SELECT OBJECT_ID(N'core.trg_Employees_SetUpdatedAtUtc', N'TR')")).scalar()
        if trigger_exists is None:
            raise RuntimeError("Missing trigger core.trg_Employees_SetUpdatedAtUtc.")

        entitlement_view = connection.execute(text("SELECT OBJECT_ID(N'core.vw_EmployeeAirfareEntitlement', N'V')")).scalar()
        if entitlement_view is None:
            raise RuntimeError("Missing view core.vw_EmployeeAirfareEntitlement.")

        airport_count = connection.execute(text("SELECT COUNT(*) FROM core.Airports")).scalar()
        settings_count = connection.execute(text("SELECT COUNT(*) FROM core.SystemSettings")).scalar()
        if int(airport_count or 0) < 10 or int(settings_count or 0) < 6:
            raise RuntimeError("Seed verification failed.")

    log("verify.done", database=target_db, tables=len(required_tables), indexes=len(required_indexes), foreignKeys=fk_count)


def main() -> int:
    try:
        target_db = database_name()
        log("migration.start", database=target_db)
        ensure_database_exists(target_db)
        execute_schema_files(target_db)
        seed_system_data(target_db)
        verify_schema(target_db)
        log("migration.pass", database=target_db)
        return 0
    except Exception as exc:
        log("migration.fail", error=str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())



