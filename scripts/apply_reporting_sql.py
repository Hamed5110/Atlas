"""Apply MSSQL reporting views and procedures outside Alembic transactions."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, text

from airfare_management.config import get_settings


def _run_script(connection, relative_name: str) -> None:
    root = Path(__file__).resolve().parents[1]
    script = (root / "sql" / relative_name).read_text(encoding="utf-8")
    batches = [b.strip() for b in script.replace("\r\n", "\n").split("\nGO\n") if b.strip()]
    for batch in batches:
        connection.execute(text(batch))


def main() -> None:
    settings = get_settings()
    if not settings.database_url.startswith("mssql"):
        print("Skipping reporting SQL (non-MSSQL database).")
        return
    engine = create_engine(settings.database_url)
    with engine.begin() as connection:
        _run_script(connection, "reporting_views.sql")
        _run_script(connection, "reporting_procedures.sql")
    print("Reporting views and procedures applied.")


if __name__ == "__main__":
    main()
