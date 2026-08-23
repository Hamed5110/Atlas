"""Inspect Alembic version and reporting objects."""

from sqlalchemy import create_engine, text

from airfare_management.config import get_settings

engine = create_engine(get_settings().database_url)
with engine.connect() as conn:
    rows = conn.execute(text("SELECT version_num FROM alembic_version")).fetchall()
    print("alembic_version:", rows)
    for obj in (
        "vw_employee_summary",
        "sp_generate_report",
        "ix_tickets_travel_date",
    ):
        oid = conn.execute(
            text("SELECT OBJECT_ID(:full_name)"),
            {"full_name": f"dbo.{obj}"},
        ).scalar()
        print(obj, oid)
