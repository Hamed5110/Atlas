"""Execute reporting SQL batches and print the first failure."""

from pathlib import Path

from sqlalchemy import create_engine, text

from airfare_management.config import get_settings

root = Path(__file__).resolve().parents[1]
script = (root / "sql" / "reporting_views.sql").read_text(encoding="utf-8")
batches = [b.strip() for b in script.replace("\r\n", "\n").split("\nGO\n") if b.strip()]
engine = create_engine(get_settings().database_url)
for index, batch in enumerate(batches, start=1):
    print(f"--- batch {index} ({len(batch)} chars) ---")
    try:
        with engine.begin() as conn:
            conn.execute(text(batch))
        print("ok")
    except Exception as exc:  # noqa: BLE001
        print("FAILED:", exc)
        print(batch[:500])
        break
