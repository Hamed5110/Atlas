"""Print-format audit evidence pack (Surfaces C/E/F/G/J + truncation)."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pymupdf

from airfare_management.application.documents import (
    _TEMPLATE_INDEX,
    _amount_in_words_ar,
    _amount_in_words_focus,
    _focus_date,
    _focus_date_ar,
    _money_focus,
    _money_focus_ar,
    build_context,
    render_html,
    render_pdf,
    validate_params,
)
from decimal import Decimal

OUT = Path(r"C:\Airfare_Allowance\test-reports\redteam-evidence\print_format_audit")
OUT.mkdir(parents=True, exist_ok=True)


def _contract_pdf(*, basic: str = "350.50", long_addr: bool = False) -> bytes:
    tpl = _TEMPLATE_INDEX["contract_unlimited"]
    params = validate_params(
        tpl,
        {
            "full_name": "Khan علي TEST",
            "nationality": "BAHRAINI",
            "passport_no": "P123",
            "cpr_no": "901234567",
            "nature_of_employment": "DATA ENTRY",
            "joining_date": date(2026, 9, 9).isoformat(),
            "document_date": date(2026, 9, 9).isoformat(),
            "probation_months": "3",
            "basic": basic,
            "annual_leave_days": "30",
            "working_hours": "48",
            "notice_period_days": "30",
            "address_villa": "329 B",
            "address_street": "1204",
            "address_block": "1012",
            "signatory_name": "HR Manager Long Title For Overflow Check",
        },
    )
    addr = (
        "Askar Industrial Area, Building 329 B, Road 1204, Block 1012, "
        "Kingdom of Bahrain Extra Long Line For Wrap Test Zone Alpha"
        if long_addr
        else "Askar Industrial Area, Building 329 B, Road 1204, Block 1012, Kingdom of Bahrain"
    )
    company = {
        "name": "Atlas Aluminum",
        "arabic_name": "شركة أطلس ألمنيوم",
        "code": "ATLAS",
        "currency": "BHD",
        "cr_no": "111487-1",
        "address": addr,
    }
    party = {
        "full_name": params["full_name"],
        "arabic_name": "علي خان",
        "nationality": params["nationality"],
        "cpr_no": params["cpr_no"],
        "passport_no": params["passport_no"],
        "code": "",
        "designation": "",
        "department": "",
        "branch": "",
        "email": "",
    }
    html = render_html(
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
    assert "صفحة ٠ من ٠" in html or "صفحة" in html
    return render_pdf(html)


def main() -> None:
    lines: list[str] = []
    amt = Decimal("350.50")
    en_w = _amount_in_words_focus(amt)
    ar_w = _amount_in_words_ar(amt)
    en_n = _money_focus(amt)
    ar_n = _money_focus_ar(amt)
    lines.append(f"E numeric EN={en_n} AR={ar_n}")
    lines.append(f"E words EN={en_w}")
    lines.append(f"E words AR={ar_w}")
    assert "and 50/100" in en_w and ("٥٠/١٠٠" in ar_w or "/100" in ar_w)

    d = date(2026, 9, 9)
    lines.append(f"F EN secondary={_focus_date(d)} AR primary={_focus_date_ar(d)}")
    assert _focus_date_ar(d) == "٠٩/٠٩/٢٠٢٦"

    pdf = _contract_pdf(basic="350.50")
    (OUT / "contract_350_50.pdf").write_bytes(pdf)
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    full = "\n".join(p.get_text() for p in doc)
    # Amount page screenshot (salary usually page 2/3)
    for i, page in enumerate(doc):
        if "350" in page.get_text() or "٣٥٠" in page.get_text() or "Article 6" in page.get_text():
            page.get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(
                str(OUT / "amount_words_golden.png")
            )
            lines.append(f"amount screenshot page={i + 1}")
            break
    # Page labels on page 2
    if doc.page_count >= 2:
        p2 = doc[1]
        clip = pymupdf.Rect(0, p2.rect.height - 90, p2.rect.width, p2.rect.height)
        p2.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), clip=clip).save(
            str(OUT / "page_labels_ar.png")
        )
        lines.append("page_labels_ar.png saved (Arabic primary document)")
    # Signature page (last)
    last = doc[-1]
    last.get_pixmap(matrix=pymupdf.Matrix(1.2, 1.2)).save(str(OUT / "signature_rtl_overflow.png"))
    lines.append(f"signature page={doc.page_count}")

    # English secondary stamp sample for matrix note
    (OUT / "page_labels_en_note.txt").write_text(
        "Document primary language is Arabic; issued labels are Arabic Eastern.\n"
        "English 'Page X of Y' applies only if page_ar meta is false (EN-primary template).\n",
        encoding="utf-8",
    )

    # Date locale matrix (text table — images would be 4 full renders)
    matrix = (
        "UI locale | Doc primary | Date on PDF (primary field)\n"
        "----------+-------------+-----------------------------\n"
        f"Arabic    | Arabic      | {_focus_date_ar(d)} (Eastern dd/mm/yyyy)\n"
        f"English   | Arabic      | {_focus_date_ar(d)} (doc primary, not UI)\n"
        f"Arabic    | EN second   | {_focus_date(d)} (secondary line)\n"
        f"English   | EN second   | {_focus_date(d)}\n"
    )
    (OUT / "date_locale_matrix.txt").write_text(matrix, encoding="utf-8")
    # Also render a simple 1-page pixmap table via text page
    # Truncation wrap test
    pdf2 = _contract_pdf(basic="350.00", long_addr=True)
    (OUT / "truncation_wrap.pdf").write_bytes(pdf2)
    d2 = pymupdf.open(stream=pdf2, filetype="pdf")
    d2[0].get_pixmap(
        matrix=pymupdf.Matrix(1.4, 1.4),
        clip=pymupdf.Rect(0, d2[0].rect.height - 100, d2[0].rect.width, d2[0].rect.height),
    ).save(str(OUT / "truncation_test.png"))
    lines.append("truncation_test.png wrap path")

    # Preview vs issued checklist sheet (text for human sign)
    (OUT / "preview_issued_diff_sheet.txt").write_text(
        "PREVIEW vs ISSUED — human sign-off\n"
        "Offer / Unlimited / Limited\n"
        "[ ] Page-label FORMAT matches (صفحة N من M, Eastern digits)\n"
        "[ ] Letterhead company EN+AR match\n"
        "[ ] Footer CR present (wrap, not silent truncate)\n"
        "[ ] Article presence matches\n"
        "[ ] Amounts: Eastern in AR cells; words EN/AR agree including /100\n"
        "Allowed gap: preview shows sample ٠/٠ until stamp assigns N/M "
        "(see PRINT_PREVIEW_ISSUED_POLICY.md).\n"
        "Product: ________  Eng: ________  Date: ________\n",
        encoding="utf-8",
    )

    # Hard-fail truncation
    try:
        _contract_pdf(
            basic="100",
            long_addr=True,
        )
        # force overflow via meta — use render with huge address in company
        from airfare_management.application.documents import DomainError  # noqa: F401
    except Exception:
        pass
    from airfare_management.domain.models import DomainError
    from airfare_management.application.documents import _stamp_focus_page_numbers

    try:
        _stamp_focus_page_numbers(
            pdf,
            footer_meta={
                "co": "Atlas",
                "ar": "",
                "addr": ("X" * 170) + " · CR 111487-1",
                "mid": "test",
                "page_ar": "1",
            },
        )
        lines.append("truncation_hardfail=UNEXPECTED_PASS")
    except DomainError as exc:
        lines.append(f"truncation_hardfail=PASS code={exc.code}")

    report = "\n".join(lines)
    (OUT / "PRINT_FORMAT_AUDIT.txt").write_text(report + "\n", encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
