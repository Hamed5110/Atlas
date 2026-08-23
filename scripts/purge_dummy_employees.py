"""List and optionally purge dummy employee rows from MSSQL/SQLite."""

from __future__ import annotations

import argparse

from sqlalchemy import bindparam, create_engine, text

from airfare_management.config import get_settings

# Match explicit test/fixture patterns — do NOT use broad code prefixes like E%.
DUMMY_PREDICATE = """
    deleted_at IS NULL AND (
        full_name LIKE '%MSSQL%'
        OR full_name LIKE '%Scenario%'
        OR full_name LIKE '%Preview%'
        OR full_name LIKE '%Dummy%'
        OR full_name LIKE '%Sample Employee%'
        OR full_name LIKE 'Pyramid Test%'
        OR full_name LIKE 'Employee SCN%'
        OR full_name LIKE 'Employee NUM%'
        OR full_name LIKE 'Employee HCM%'
        OR full_name LIKE 'MSSQL Rollback%'
        OR full_name LIKE 'Import Valid%'
        OR code LIKE 'MS-SEQ-%'
        OR code LIKE 'SCN%-%'
        OR code LIKE 'SCN1-%'
        OR code LIKE 'SCN2-%'
        OR code LIKE 'SCN3-%'
        OR code LIKE 'NUM-%'
        OR code LIKE 'HCM-%'
        OR code LIKE 'IMP%'
        OR code LIKE 'FX%'
        OR code LIKE 'FXRPT%'
        OR code LIKE 'BAD%'
        OR code LIKE 'E%' AND full_name LIKE 'Pyramid Test%'
        OR (LTRIM(RTRIM(ISNULL(full_name, ''))) = '')
    )
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect or purge dummy HCM employee rows.")
    parser.add_argument("--purge", action="store_true", help="Soft-delete matching rows.")
    args = parser.parse_args()
    settings = get_settings()
    engine = create_engine(settings.database_url)
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT id, code, full_name, department, branch, email, join_date
                FROM employees
                WHERE {DUMMY_PREDICATE}
                ORDER BY code
                """
            )
        ).fetchall()
        print(f"Dummy candidates: {len(rows)}")
        for row in rows:
            print(dict(row._mapping))
        active = conn.execute(
            text("SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL")
        ).scalar()
        print(f"Active employees total: {active}")
        if not args.purge:
            return
        if not rows:
            print("Nothing to purge.")
            return
        ids = [str(row.id) for row in rows]
        stmt = text(
            """
            UPDATE tickets
            SET deleted_at = CURRENT_TIMESTAMP, version = version + 1
            WHERE deleted_at IS NULL AND employee_id IN :ids
            """
        ).bindparams(bindparam("ids", expanding=True))
        for table in ("tickets", "loans", "opening_balances", "ess_requests"):
            result = conn.execute(
                text(
                    f"""
                    UPDATE {table}
                    SET deleted_at = CURRENT_TIMESTAMP, version = version + 1
                    WHERE deleted_at IS NULL AND employee_id IN :ids
                    """
                ).bindparams(bindparam("ids", expanding=True)),
                {"ids": ids},
            )
            print(f"Soft-deleted {result.rowcount} from {table}")
        result = conn.execute(
            text(
                f"""
                UPDATE employees
                SET deleted_at = CURRENT_TIMESTAMP,
                    active = 0,
                    version = version + 1
                WHERE {DUMMY_PREDICATE}
                """
            )
        )
        print(f"Soft-deleted {result.rowcount} employees")


if __name__ == "__main__":
    main()
