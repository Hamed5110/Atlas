"""Extract ATLAS MSSQL stored procedures and functions."""

from __future__ import annotations

import argparse
from pathlib import Path

import pyodbc


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", default="localhost,1433")
    parser.add_argument("--database", default="Atlasairfare010")
    parser.add_argument("--user", default="sa")
    parser.add_argument("--password", default="Atlas@25")
    parser.add_argument(
        "--out",
        default=str(Path("docs") / "atlas-3355-sql-objects.sql"),
    )
    args = parser.parse_args()

    conn = pyodbc.connect(
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={args.server};DATABASE={args.database};"
        f"UID={args.user};PWD={args.password};"
        "Encrypt=no;TrustServerCertificate=yes"
    )
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            o.object_id,
            s.name AS schema_name,
            o.name AS object_name,
            o.type_desc,
            m.definition
        FROM sys.objects o
        JOIN sys.schemas s ON s.schema_id = o.schema_id
        JOIN sys.sql_modules m ON m.object_id = o.object_id
        WHERE o.type IN ('P', 'FN', 'TF', 'IF')
        ORDER BY o.type_desc, s.name, o.name
        """
    )
    rows = cur.fetchall()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    parts: list[str] = []
    parts.append(f"-- Exported objects: {len(rows)}")
    for row in rows:
        parts.append(
            f"\n\n-- {row.type_desc} {row.schema_name}.{row.object_name}\nGO\n{row.definition}\nGO\n"
        )
    out.write_text("\n".join(parts), encoding="utf-8")
    print(f"Wrote {len(rows)} objects to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

