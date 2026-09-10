"""Professional print redesign — mockups + §3 evidence pack.

Generates offer / unlimited / limited PDFs with maximal fixtures and
evidence screenshots under test-reports/redteam-evidence/print_redesign/.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
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

OUT = Path(r"C:\Airfare_Allowance\test-reports\redteam-evidence\print_redesign")
OUT.mkdir(parents=True, exist_ok=True)

COMPANY = {
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


def _party(full: str, ar: str = "") -> dict:
    return {
        "full_name": full,
        "arabic_name": ar,
        "nationality": "BAHRAINI",
        "cpr_no": "901234567",
        "passport_no": "P1234567",
        "code": "",
        "designation": "",
        "department": "",
        "branch": "",
        "email": "",
    }


def _render(key: str, params: dict, voucher: str) -> tuple[bytes, str]:
    tpl = _TEMPLATE_INDEX[key]
    cleaned = validate_params(tpl, params)
    kind = "offer_letter" if "offer" in key else "contract"
    html = render_html(
        tpl,
        build_context(
            company=COMPANY,
            party=_party(cleaned["full_name"], "محمد جبار إبراهيم"),
            kind=kind,
            params=cleaned,
            doc_number=60,
            voucher_no=voucher,
            logo_src=None,
        ),
    )
    return render_pdf(html), html


def _bottoms(pdf: bytes, stem: str) -> int:
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    # Must match documents._focus_footer_band_top (@page margin-bottom 32mm).
    band = doc[0].rect.height - (32.0 * 72.0 / 25.4)
    violations = 0
    for i, page in enumerate(doc):
        page.get_pixmap(
            matrix=pymupdf.Matrix(1.25, 1.25),
            clip=pymupdf.Rect(0, max(0, band - 70), 595, page.rect.height),
        ).save(str(OUT / f"{stem}_p{i + 1}_bottom.png"))
        for block in page.get_text("blocks"):
            _x0, y0, _x1, y1, text, *_r = block
            if not (text or "").strip() or y0 >= band - 0.5:
                continue
            if y1 > band + 1:
                violations += 1
    doc.close()
    return violations


def main() -> None:
    report: list[str] = []
    # --- Offer maximal ---
    offer_params = {
        "full_name": "FRANCIS MUWONGE Khan علي",
        "nationality": "UGANDAN",
        "passport_no": "A00067300",
        "cpr_no": "901064050",
        "nature_of_employment": "TECHNICIAN WORKER",
        "joining_date": date.today().isoformat(),
        "document_date": date.today().isoformat(),
        "probation_months": "3",
        "basic": "100.50",
        "annual_leave_days": "30",
    }
    offer_pdf, offer_html = _render("offer_default", offer_params, "OFL-26-034")
    (OUT / "mockup_offer_ar_primary.pdf").write_bytes(offer_pdf)
    v = _bottoms(offer_pdf, "offer")
    report.append(f"offer pages={pymupdf.open(stream=offer_pdf,filetype='pdf').page_count} band_violations={v}")

    # --- Unlimited maximal with full salary grid (one EN|AMT|AR table) ---
    un_params = {
        "full_name": "MOHAMED JABBAR EBRAHIM ALI",
        "nationality": "BAHRAINI",
        "passport_no": "2789815",
        "cpr_no": "930804163",
        "nature_of_employment": "DATA ENTRY OPERATOR",
        "joining_date": date.today().isoformat(),
        "document_date": date.today().isoformat(),
        "probation_months": "3",
        "basic": "200.00",
        "hra": "10.00",
        "car_allowance": "5.00",
        "petrol_allowance": "8.00",
        "special_duty_allowance": "5.00",
        "annual_leave_days": "30",
        "working_hours": "48",
        "notice_period_days": "30",
        "address_villa": "329 B",
        "address_street": "1204",
        "address_block": "1012",
        "signatory_name": "HR Manager",
    }
    un_pdf, un_html = _render("contract_unlimited", un_params, "CO-26-060")
    (OUT / "mockup_contract_unlimited.pdf").write_bytes(un_pdf)
    v = _bottoms(un_pdf, "unlimited")
    doc = pymupdf.open(stream=un_pdf, filetype="pdf")
    report.append(f"unlimited pages={doc.page_count} band_violations={v}")
    # amount page — single unified salary table
    for i, p in enumerate(doc):
        text = p.get_text()
        if "Salary agreed" in text or "الراتب الأساسي" in text:
            p.get_pixmap(matrix=pymupdf.Matrix(1.6, 1.6)).save(
                str(OUT / "amount_words_golden.png")
            )
            # Crop salary band for alignment evidence
            for needle in ("Basic", "Total Amount (BD)", "200.00"):
                hits = p.search_for(needle)
                if hits:
                    y0 = max(0, hits[0].y0 - 40)
                    y1 = min(p.rect.height, hits[0].y0 + 220)
                    p.get_pixmap(
                        matrix=pymupdf.Matrix(2.0, 2.0),
                        clip=pymupdf.Rect(0, y0, p.rect.width, y1),
                    ).save(str(OUT / "salary_one_table.png"))
                    break
            # Exactly one salary label set (not duplicated L/R tables)
            basic_n = len(p.search_for("Basic"))
            car_n = len(p.search_for("Car Allowance"))
            sal_n = len(p.search_for("Salary agreed"))
            report.append(
                f"amount_page={i + 1} basic_hits={basic_n} car_hits={car_n} salary_heads={sal_n}"
            )
            assert basic_n == 1, f"expected one Basic label, got {basic_n}"
            assert car_n == 1, f"expected one Car Allowance label, got {car_n}"
            assert sal_n == 1, f"expected one Salary agreed head, got {sal_n}"
            # Center amount column: Basic amount x near page mid
            amt_hits = p.search_for("200.00")
            if not amt_hits:
                amt_hits = p.search_for("200.00/-")
            mid = p.rect.width / 2
            cx = (amt_hits[0].x0 + amt_hits[0].x1) / 2
            report.append(
                f"amount_center_x={cx:.1f} page_mid={mid:.1f} delta={abs(cx - mid):.1f}"
            )
            assert abs(cx - mid) < 55, f"amount not centered: {cx} vs mid {mid}"
            # EN left of amount on same row
            basic = p.search_for("Basic")[0]
            amt = amt_hits[0]
            assert basic.x1 < amt.x0, "EN label must be left of amount"
            assert abs(basic.y0 - amt.y0) < 2, "EN/amount row must share baseline"
            break
    else:
        report.append("amount_page=MISSING")
        raise AssertionError("salary amount section not found in PDF")
    if doc.page_count >= 2:
        p2 = doc[1]
        p2.get_pixmap(
            matrix=pymupdf.Matrix(1.5, 1.5),
            clip=pymupdf.Rect(0, p2.rect.height - 95, p2.rect.width, p2.rect.height),
        ).save(str(OUT / "page_labels_ar.png"))
    doc[-1].get_pixmap(matrix=pymupdf.Matrix(1.2, 1.2)).save(
        str(OUT / "signature_rtl_overflow.png")
    )
    doc.close()

    # --- Limited ---
    lim_params = dict(un_params)
    lim_params["duration_months"] = "12"
    lim_pdf, _ = _render("contract_limited", lim_params, "CO-26-061")
    (OUT / "mockup_contract_limited.pdf").write_bytes(lim_pdf)
    v = _bottoms(lim_pdf, "limited")
    report.append(
        f"limited pages={pymupdf.open(stream=lim_pdf,filetype='pdf').page_count} band_violations={v}"
    )

    # Amounts / dates matrix
    amt = Decimal("228.00")
    d = date(2026, 9, 9)
    (OUT / "date_locale_matrix.txt").write_text(
        "Primary AR date | Secondary EN date\n"
        f"{_focus_date_ar(d)} | {_focus_date(d)}\n"
        "Rule: document primary=Arabic → Eastern dd/mm/yyyy; EN secondary=dd-Mmm-yyyy\n",
        encoding="utf-8",
    )
    (OUT / "amount_verify.txt").write_text(
        f"EN num={_money_focus(amt)}\nAR num={_money_focus_ar(amt)}\n"
        f"EN words={_amount_in_words_focus(amt)}\nAR words={_amount_in_words_ar(amt)}\n",
        encoding="utf-8",
    )
    assert "Two Hundred and Twenty-Eight" in _amount_in_words_focus(amt)
    assert "مائتان" in _amount_in_words_ar(amt)
    assert "and 50/100" in _amount_in_words_focus(Decimal("350.50"))
    assert "٥٠/١٠٠" in _amount_in_words_ar(Decimal("350.50"))

    # Truncation wrap
    long_co = dict(COMPANY)
    long_co["address"] = COMPANY["address"] + " Extension Wing for Wrap Validation Line"
    # reuse unlimited render via temporary company override in build — quick stamp test
    from airfare_management.application.documents import _stamp_focus_page_numbers
    from airfare_management.domain.models import DomainError

    wrapped = _stamp_focus_page_numbers(
        un_pdf,
        footer_meta={
            "co": "Atlas Aluminum W.L.L",
            "ar": "شركة أطلس ألمنيوم",
            "addr": long_co["address"] + " · CR 111487-1",
            "mid": "Contract · CO-26-060",
            "page_ar": "1",
        },
    )
    dwrap = pymupdf.open(stream=wrapped, filetype="pdf")
    dwrap[0].get_pixmap(
        matrix=pymupdf.Matrix(1.4, 1.4),
        clip=pymupdf.Rect(0, dwrap[0].rect.height - 100, dwrap[0].rect.width, dwrap[0].rect.height),
    ).save(str(OUT / "truncation_test.png"))
    dwrap.close()
    try:
        _stamp_focus_page_numbers(
            un_pdf,
            footer_meta={
                "co": "X",
                "ar": "",
                "addr": ("Z" * 170) + " · CR 1",
                "mid": "m",
                "page_ar": "1",
            },
        )
        report.append("truncation_hardfail=FAIL")
    except DomainError as exc:
        report.append(f"truncation_hardfail=PASS {exc.code}")

    # Focus dual-column markers present (EN left | AR right)
    assert "CONTRACT OF EMPLOYMENT" in un_html and "عقـــــد عمل" in un_html
    assert 'class="col-en"' in un_html and 'class="col-ar"' in un_html
    (OUT / "preview_issued_diff_sheet.txt").write_text(
        "HUMAN SIGN-OFF — Preview vs Issued (Focus dual-column rebuild)\n"
        "[ ] Titles match (CONTRACT OF EMPLOYMENT | عقد عمل)\n"
        "[ ] Dual column: EN LEFT | AR RIGHT with vertical divider\n"
        "[ ] Page-label FORMAT: Page number : N of M (Focus)\n"
        "[ ] Amounts: BHD + words EN/AR agree including /100\n"
        "[ ] Dates: EN dd-Mmm-yyyy; AR Eastern where applicable\n"
        "[ ] Signatures: Employer LEFT | Employee RIGHT (Focus)\n"
        "[ ] Footer wrap or hard-fail — no silent truncate\n"
        "Product: ______  Eng: ______  Date: ______\n"
        "Source: Expertise Emp Contract XML + Contract of employee.pdf\n",
        encoding="utf-8",
    )

    # EN page label sample
    blank = pymupdf.open()
    for _ in range(5):
        blank.new_page(width=595, height=842)
    en_pdf = _stamp_focus_page_numbers(
        blank.tobytes(),
        footer_meta={"co": "Atlas", "ar": "", "addr": "CR 1", "mid": "Offer", "page_ar": ""},
    )
    blank.close()
    ed = pymupdf.open(stream=en_pdf, filetype="pdf")
    ed[1].get_pixmap(
        matrix=pymupdf.Matrix(1.5, 1.5),
        clip=pymupdf.Rect(0, ed[1].rect.height - 90, ed[1].rect.width, ed[1].rect.height),
    ).save(str(OUT / "page_labels_en.png"))
    ed.close()

    text = "\n".join(report)
    (OUT / "REDESIGN_AUDIT.txt").write_text(text + "\n", encoding="utf-8")
    print(text)
    print("OUT", OUT)


if __name__ == "__main__":
    main()
