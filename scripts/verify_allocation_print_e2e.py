"""E2E TRUE MODE: allocation A4 PDF matches UI preview fields (live :3389 + MSSQL).

Run:
  $env:PYTHONPATH='C:\\HCM Airfare\\src'
  python scripts\\verify_allocation_print_e2e.py
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


def _post(url: str, body: dict, headers: dict | None = None, timeout: float = 120.0):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read(), dict(resp.headers)


def main() -> int:
    import pymupdf
    from sqlalchemy import create_engine, text

    from airfare_management.config import get_settings

    get_settings.cache_clear()
    s = get_settings()
    failed = 0
    base = "http://127.0.0.1:3389"

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failed
        safe = (detail or "").encode("ascii", "backslashreplace").decode("ascii")[:200]
        print(("PASS" if ok else "FAIL"), name, safe)
        if not ok:
            failed += 1

    print("=== ALLOCATION PRINT E2E (preview parity) ===\n")

    try:
        req = urllib.request.Request(f"{base}/health/live", method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            check("api_live", resp.status == 200, resp.read().decode()[:80])
    except Exception as exc:  # noqa: BLE001
        check("api_live", False, str(exc))
        return 1

    try:
        st, raw, _ = _post(
            f"{base}/v1/auth/login",
            {"username": s.bootstrap_admin_username, "password": s.bootstrap_admin_password},
        )
        tok = json.loads(raw.decode())["access_token"]
        check("login", bool(tok))
    except Exception as exc:  # noqa: BLE001
        check("login", False, str(exc))
        return 1
    H = {"Authorization": f"Bearer {tok}"}

    eng = create_engine(str(s.database_url))
    ticket_id = None
    ticket_code = None
    employee_code = None
    with eng.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT TOP 1 t.id, t.ticket_number, e.code
                FROM tickets t
                JOIN employees e ON e.id = t.employee_id
                WHERE t.deleted_at IS NULL
                  AND (e.code = :code OR t.ticket_number = :tn)
                ORDER BY t.created_at DESC
                """
            ),
            {"code": "0003", "tn": 21},
        ).mappings().first()
        if row is None:
            row = conn.execute(
                text(
                    """
                    SELECT TOP 1 t.id, t.ticket_number, e.code
                    FROM tickets t
                    JOIN employees e ON e.id = t.employee_id
                    WHERE t.deleted_at IS NULL
                    ORDER BY t.created_at DESC
                    """
                )
            ).mappings().first()
        if row:
            ticket_id = str(row["id"])
            tn = row["ticket_number"]
            ticket_code = f"T-{int(tn):06d}" if tn is not None else None
            employee_code = row["code"]
    check("mssql_ticket", bool(ticket_id), f"code={ticket_code} emp={employee_code} id={ticket_id}")
    if not ticket_id:
        return 1

    try:
        st, pdf, headers = _post(
            f"{base}/v1/allocations/print.pdf",
            {"ticket_id": ticket_id},
            headers=H,
            timeout=120,
        )
        ctype = headers.get("Content-Type") or headers.get("content-type") or ""
        check("print_pdf_status", st == 200, ctype)
        check("print_pdf_magic", pdf[:4] == b"%PDF", f"bytes={len(pdf)}")
    except Exception as exc:  # noqa: BLE001
        check("print_pdf_status", False, str(exc))
        return 1

    text = "\n".join(page.get_text() for page in pymupdf.open(stream=pdf, filetype="pdf"))
    for m in (
        "Airfare Allocation",
        "Document No",
        "Travel Date",
        "As of Date",
        "Status",
        "Employee ID",
        "Name",
        "Nationality",
        "Entitlement",
        "Route",
        "Employee Payable",
        "Prepared by",
    ):
        check(f"pdf_has:{m}", m in text)

    # Must keep full attached layout (not the stripped preview)
    for f in ("Department", "Designation", "Pay Group"):
        check(f"pdf_has:{f}", f in text)

    if ticket_code:
        check("pdf_ticket_code", ticket_code in text, str(ticket_code))
    if employee_code:
        check("pdf_employee_code", str(employee_code) in text, str(employee_code))

    out = ROOT / "scripts" / "_last_allocation_print_e2e.pdf"
    out.write_bytes(pdf)
    print(f"\nsaved={out}")
    print(f"summary failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
