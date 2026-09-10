"""Red-team unit checks: Focus Soft offer/contract print + company branding."""

from __future__ import annotations

import pytest

from airfare_management.application.documents import (
    _TEMPLATE_INDEX,
    _resolve_company_arabic_name,
    render_html,
    render_pdf,
)


def _offer_ctx(*, name: str, arabic: str, voucher: str = "OFL-RT-001") -> dict:
    return {
        "company": {
            "name": name,
            "arabic_name": arabic,
            "code": "RT",
            "currency": "BHD",
            "cr_no": "111487-1",
            "address": "Building 1 Road 2 Block 3",
        },
        "logo_src": None,
        "employee": {
            "full_name": "RED TEAM CANDIDATE",
            "arabic_name": "مرشح الفريق الأحمر",
            "nationality": "BAHRAINI",
            "cpr_no": "900101234",
            "passport_no": "P1234567",
            "code": "",
            "designation": "",
            "department": "",
            "branch": "",
            "email": "",
        },
        "doc": {
            "ref": voucher,
            "voucher_no": voucher,
            "number": 1,
            "kind": "offer_letter",
            "title": "Offer Letter",
            "issue_date": "09 Sep 2026",
            "issue_date_long": "09 September 2026",
            "joining_date_long": "01 October 2026",
        },
        "params": {
            "nature_of_employment": "TECHNICIAN WORKER",
            "nature_of_employment_arabic": "فني",
            "basic": "100",
            "hra": "0",
            "petrol_allowance": "0",
            "car_allowance": "0",
            "special_duty_allowance": "0",
            "basic_fmt_focus": "100.00/-",
            "net_fmt_focus": "100.00/-",
            "basic_fmt": "100.000",
            "net_fmt": "100.000",
            "net_in_words_focus": "Bahraini Dinar   One Hundred only",
            "net_in_words": "One Hundred Bahraini Dinars Only",
            "net_in_words_ar": "مائة فقط",
            "basic_fmt_focus_ar": "١٠٠.٠٠/-",
            "net_fmt_focus_ar": "١٠٠.٠٠/-",
            "probation_months": 3,
            "probation_months_en": "three months",
            "annual_leave_days": 30,
            "traveling_airfare": True,
            "document_date_focus": "09/September/2026",
            "document_date_focus_ar": "٠٩/٠٩/٢٠٢٦",
            "document_weekday_focus": "Wednesday/September 09/2026",
            "document_weekday_focus_ar": "٠٩/٠٩/٢٠٢٦",
            "nationality_ar": "بحريني",
            "signatory_name": "HR Manager",
            "signatory_title": "Human Resources",
            "offer_valid_until_long": "16 September 2026",
            "additional_details": "",
            "narration": "",
            "special_terms": "",
        },
    }


def test_company_arabic_resolve_atlas_and_override() -> None:
    assert "أطلس" in _resolve_company_arabic_name("Atlas Aluminum W.L.L.")
    assert _resolve_company_arabic_name("Other Co", "شركة أخرى") == "شركة أخرى"
    assert _resolve_company_arabic_name("Unknown Brand XYZ") == ""


def test_focus_amount_words_match_sample_style() -> None:
    from decimal import Decimal
    from airfare_management.application.documents import (
        _amount_in_words_ar,
        _amount_in_words_focus,
        _probation_months_en,
    )

    assert _amount_in_words_focus(Decimal("100")) == "Bahraini Dinar   One Hundred only"
    assert _amount_in_words_ar(Decimal("100")) == "مائة فقط"
    assert "ثلاثمائة" in _amount_in_words_ar(Decimal("350"))
    focus_350_50 = _amount_in_words_focus(Decimal("350.50"))
    ar_350_50 = _amount_in_words_ar(Decimal("350.50"))
    assert "and 50/100" in focus_350_50
    assert "Fifty" in focus_350_50 or "Three Hundred" in focus_350_50
    assert "٥٠/١٠٠" in ar_350_50 or "/100" in ar_350_50 or "/١٠٠" in ar_350_50
    assert "ثلاثمائة" in ar_350_50
    from airfare_management.application.documents import (
        _money_focus_ar,
        _focus_date,
        _focus_date_ar,
    )
    from datetime import date as _date

    assert "٫" in (_money_focus_ar(Decimal("350.50")) or "")
    assert _focus_date_ar(_date(2026, 9, 9)).startswith("٠٩/")
    assert _focus_date(_date(2026, 9, 9)) == "09-Sep-2026"
    assert _probation_months_en(3) == "three months"


def test_offer_extends_focus_base_bilingual_matter() -> None:
    html = render_html(_TEMPLATE_INDEX["offer_default"], _offer_ctx(name="Atlas Aluminum", arabic="شركة أطلس ألمنيوم"))
    assert "خطاب عرض وظيفي" in html or "خطاب العرض" in html
    assert "Job Offer Letter" in html or "Offer Letter" in html
    assert "شركة أطلس ألمنيوم" in html
    assert "Atlas Aluminum" in html
    assert "100.00/-" in html or "١٠٠" in html or "100.00" in html
    assert "class=\"salary\"" in html or 'class="salary"' in html
    assert "تُعتبر" in html or "تعتبر" in html or "فترة تجريبية" in html
    assert "Dear MR/Ms." in html
    assert "Document No." in html
    assert "OFL-RT-001" in html
    assert "page-header" in html
    assert "page-footer" in html
    assert "sig-grid" in html or "sig-band" in html


def test_offer_company_swap_changes_letterhead_names() -> None:
    a = render_html(
        _TEMPLATE_INDEX["offer_default"],
        _offer_ctx(name="Atlas Aluminum", arabic="شركة أطلس ألمنيوم"),
    )
    b = render_html(
        _TEMPLATE_INDEX["offer_default"],
        _offer_ctx(name="Gulf Steel Co", arabic="شركة الخليج للصلب", voucher="OFL-RT-002"),
    )
    # Body + footer branding follows company (letterhead uses logo when present).
    assert "شركة أطلس ألمنيوم" in a and "شركة الخليج للصلب" not in a
    assert "شركة الخليج للصلب" in b and "شركة أطلس ألمنيوم" not in b
    assert "Gulf Steel Co" in b
    assert "مائة فقط" in a
    assert "Bahraini Dinar   One Hundred only" in a or "One Hundred" in a
    assert "three months" in a


def test_contract_templates_still_use_focus_base() -> None:
    from airfare_management.application.documents import TEMPLATES_ROOT

    for key in ("contract_unlimited", "contract_limited"):
        rel = _TEMPLATE_INDEX[key].template
        path = TEMPLATES_ROOT.joinpath(*rel.split("/"))
        body = path.read_text(encoding="utf-8")
        assert 'extends "documents/contract/focus_base.html"' in body
        assert "CONTRACT OF EMPLOYMENT" in body or "Contract of Employment" in body or "عقد" in body
        assert "المادة" in body


def test_offer_pdf_bytes_valid() -> None:
    html = render_html(_TEMPLATE_INDEX["offer_default"], _offer_ctx(name="Atlas Aluminum", arabic="شركة أطلس ألمنيوم"))
    pdf = render_pdf(html)
    assert pdf[:4] == b"%PDF"
    assert len(pdf) > 5_000
