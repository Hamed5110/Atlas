"""Apply Atlas Aluminum entitlement functions/procedures outside Alembic transactions."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, text

from airfare_management.config import get_settings

_SCRIPTS = (
    "atlas_aluminum/01_functions.sql",
    "atlas_aluminum/02_sp_calculate_entitlement.sql",
    "atlas_aluminum/03_views.sql",
    "atlas_aluminum/04_seed_policies.sql",
    "atlas_aluminum/05_modern_entitlement_engine.sql",
)


def _run_script(connection, relative_name: str) -> None:
    root = Path(__file__).resolve().parents[1]
    script = (root / "sql" / relative_name).read_text(encoding="utf-8")
    batches = [b.strip() for b in script.replace("\r\n", "\n").split("\nGO\n") if b.strip()]
    for batch in batches:
        connection.execute(text(batch))


def main() -> None:
    settings = get_settings()
    if not settings.database_url.startswith("mssql"):
        print("Skipping entitlement SQL (non-MSSQL database).")
        return
    engine = create_engine(settings.database_url)
    with engine.begin() as connection:
        for relative in _SCRIPTS:
            _run_script(connection, relative)
            print(f"Applied {relative}")
    print("Entitlement functions and procedures applied.")


if __name__ == "__main__":
    main()
