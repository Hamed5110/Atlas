"""Regression: contract articles must not clip under stamped footer band."""

from __future__ import annotations

from datetime import date
import re

import pymupdf

from airfare_management.application.documents import (
    _TEMPLATE_INDEX,
    build_context,
    render_html,
    render_pdf,
    validate_params,
)


def _render_unlimited_contract_pdf() -> bytes:
    tpl = _TEMPLATE_INDEX["contract_unlimited"]
    params = validate_params(
        tpl,
        {
            "full_name": "TEST EMPLOYEE",
            "nationality": "BAHRAINI",
            "passport_no": "P123",
            "cpr_no": "901234567",
            "nature_of_employment": "DATA ENTRY OPERATOR",
            "joining_date": date.today().isoformat(),
            "document_date": date.today().isoformat(),
            "probation_months": "3",
            "basic": "350",
            "annual_leave_days": "30",
            "working_hours": "48",
            "notice_period_days": "30",
            "address_villa": "329 B",
            "address_street": "1204",
            "address_block": "1012",
            "signatory_name": "HR Manager",
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
        "arabic_name": "",
        "nationality": params["nationality"],
        "cpr_no": params["cpr_no"],
        "passport_no": params["passport_no"],
        "code": "",
        "designation": "",
        "department": "",
        "branch": "",
        "email": "",
    }
    ctx = build_context(
        company=company,
        party=party,
        kind="contract",
        params=params,
        doc_number=3,
        voucher_no="CO-26-003",
        logo_src=None,
    )
    html = render_html(tpl, ctx)
    assert "clause-block" in html
    assert "المادة السابعة" in html
    return render_pdf(html)


def test_contract_clauses_7_through_17_not_clipped() -> None:
    pdf = _render_unlimited_contract_pdf()
    assert pdf[:4] == b"%PDF"
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    try:
        # Cover + body + signature → typically 4–6 pages with premium spacing.
        assert doc.page_count >= 4
        full = "\n".join(page.get_text() for page in doc)
        # Prefer stable Latin markers (Arabic is HarfBuzz-shaped in the PDF layer).
        for marker in (
            "Article 7",
            "Article 8",
            "Article 9",
            "Article 10",
            "Article 11",
            "Article 14",
            "Article 17",
            "intention of not renewing",
            "more than once under the employer",
            "First Party Signature",
            "Governing Law",
        ):
            assert marker in full, marker
        assert "Atlas Aluminum" in full
        assert "عدم التجديد" in full or "intention of not renewing" in full
        assert re.search(r"صفحة", full) or re.search(
            r"Page\s*(number\s*:)?\s*\d+", full, flags=re.I
        )

        for page in doc:
            text = page.get_text()
            if "Article 7" in text:
                assert "intention of not renewing" in text
            if "Article 8" in text:
                assert "more than once under the employer" in text

        page0 = doc[0]
        band_top = page0.rect.height - 72
        for block in page0.get_text("blocks"):
            _x0, y0, _x1, y1, text, *_rest = block
            t = (text or "").strip()
            if not t or y0 >= band_top - 0.5:
                continue
            assert y1 <= band_top + 1.0, (
                f"body enters footer band: y1={y1:.1f} band_top={band_top:.1f} "
                f"text={t[:80]!r}"
            )
        stamped = [
            r for r in page0.search_for("Atlas Aluminum") if r.y0 >= band_top - 1
        ]
        assert stamped, "expected stamped company footer in bottom margin"
    finally:
        doc.close()
