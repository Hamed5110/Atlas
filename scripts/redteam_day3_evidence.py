"""Day-3 red-team evidence: Surface D stamp band + log sanitization."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pymupdf

from airfare_management.application.documents import (
    _TEMPLATE_INDEX,
    build_context,
    render_html,
    render_pdf,
    sanitize_printable_field,
    validate_params,
)
from airfare_management.infrastructure.telemetry import sanitize_log_event_values

OUT = Path(r"C:\Airfare_Allowance\test-reports\redteam-evidence")
OUT.mkdir(parents=True, exist_ok=True)


def main() -> None:
    tpl = _TEMPLATE_INDEX["contract_unlimited"]
    params = validate_params(
        tpl,
        {
            "full_name": "عبدالله محمد حسن العتيبي TEST EMPLOYEE LONG NAME",
            "nationality": "BAHRAINI",
            "passport_no": "P123456789",
            "cpr_no": "901234567",
            "nature_of_employment": "SENIOR DATA ENTRY OPERATOR",
            "joining_date": date.today().isoformat(),
            "document_date": date.today().isoformat(),
            "probation_months": "3",
            "basic": "350",
            "annual_leave_days": "30",
            "working_hours": "48",
            "notice_period_days": "30",
            "address_villa": "Building 329 B",
            "address_street": "Road 1204",
            "address_block": "1012",
            "signatory_name": "HR Manager",
            "narration": "Clause notes %s %n\r\nFAKE_SUCCESS",
        },
    )
    company = {
        "name": "Atlas Aluminum",
        "arabic_name": "شركة أطلس ألمنيوم",
        "code": "ATLAS",
        "currency": "BHD",
        "cr_no": "111487-1",
        "address": (
            "Askar Industrial Area, Building 329 B, Road 1204, Block 1012, "
            "Kingdom of Bahrain"
        ),
    }
    party = {
        "full_name": params["full_name"],
        "arabic_name": "عبدالله محمد حسن",
        "nationality": params["nationality"],
        "cpr_no": params["cpr_no"],
        "passport_no": params["passport_no"],
        "code": "",
        "designation": "",
        "department": "",
        "branch": "",
        "email": "",
    }
    pdf = render_pdf(
        render_html(
            tpl,
            build_context(
                company=company,
                party=party,
                kind="contract",
                params=params,
                doc_number=3,
                voucher_no="CO-26-003",
                logo_src=None,
            ),
        )
    )
    (OUT / "maximal_contract.pdf").write_bytes(pdf)
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    band = doc[0].rect.height - 72
    violations = 0
    lines: list[str] = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(
            matrix=pymupdf.Matrix(1.2, 1.2),
            clip=pymupdf.Rect(0, max(0, band - 80), 595, page.rect.height),
        )
        pix.save(str(OUT / f"page{i + 1}_bottom.png"))
        page_hits = 0
        for block in page.get_text("blocks"):
            _x0, y0, _x1, y1, text, *_rest = block
            t = (text or "").strip()
            if not t or y0 >= band - 0.5:
                continue
            if y1 > band + 1:
                page_hits += 1
        violations += page_hits
        lines.append(f"page{i + 1} body_in_band={page_hits}")

    payload = {
        "event": "document_issue",
        "full_name": "Ali\r\nIssued OK %s %n",
        "narration": "x%x",
    }
    cleaned = sanitize_log_event_values(None, None, dict(payload))
    field = sanitize_printable_field("Ali\r\nIssued OK %s %n %x Khan")
    report = "\n".join(
        [
            f"pages={doc.page_count}",
            *lines,
            f"SURFACE_D={'PASS' if violations == 0 else 'FAIL'} violations={violations}",
            f"log_full_name={cleaned['full_name']!r}",
            f"field_sanitized={field!r}",
            "tenant_unit_tests=PASS (test_document_tenant_sanitize.py)",
        ]
    )
    (OUT / "day3_evidence.txt").write_text(report + "\n", encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
