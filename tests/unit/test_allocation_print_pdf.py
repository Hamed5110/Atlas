"""Unit tests for offer-letter-style airfare allocation print PDF."""

from pathlib import Path
from unittest.mock import MagicMock

import pymupdf

from airfare_management.application.documents import render_allocation_print_pdf
from airfare_management.infrastructure.documents import build_allocation_print_pdf
from airfare_management.infrastructure.schema import CompanyRow


def _pdf_text(pdf: bytes) -> str:
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    return "\n".join(page.get_text() for page in doc)


def test_render_allocation_print_pdf_uses_offer_letterhead(tmp_path: Path) -> None:
    company = CompanyRow(
        id="11111111-1111-1111-1111-111111111111",
        code="DEFAULT",
        name="Atlas Aluminum",
        currency="BHD",
        cr_no="12345-1",
        address="Askar",
        active=True,
    )
    session = MagicMock()
    session.get.return_value = company

    branding = tmp_path / "branding"
    branding.mkdir()
    # Use the real Atlas print asset (PIL-valid PNG)
    from airfare_management.infrastructure.documents import _ATLAS_LOGO
    import shutil

    logo = branding / f"{company.id}.png"
    shutil.copy2(_ATLAS_LOGO, logo)

    pdf = render_allocation_print_pdf(
        session,
        branding_root=branding,
        company_id=company.id,
        data={
            "ticket_code": "T-000100",
            "employee_code": "0013",
            "employee_name": "VIJAYKUMAR VADLA",
            "arabic_name": "",
            "nationality": "INDIAN",
            "department": "Atlas Transfer 2",
            "designation": "Cutting Leader",
            "pay_group": "New Worker Paygroup",
            "join_date": "2016-02-11",
            "travel_date": "2026-09-05",
            "as_of_date": "2026-09-05",
            "origin_code": "DEL",
            "destination_code": "BOM",
            "entitlement_amount": "0",
            "ticket_cost": "400",
            "company_payout": "0",
            "employee_payable": "400",
            "excess_cost": "400",
            "excess_option": "CONVERT_TO_LOAN",
            "loan_code": "L-000008",
            "loan_status": "active",
            "opening_balance_amount": "150",
            "current_year_earned_amount": "0",
            "already_paid_amount": "150",
            "status": "PAID",
            "reporting_officer": "NAVEEN KUMAR KAMMARI",
        },
        prepared_by="admin",
    )
    assert pdf.startswith(b"%PDF")
    text = _pdf_text(pdf)
    assert "Airfare Allocation" in text
    assert "Document No" in text
    assert "T-000100" in text
    assert "VIJAYKUMAR" in text
    assert "05/09/2026" in text or "5/09/2026" in text
    assert "PAID" in text
    assert "مدفوع" in text  # الحالة: مدفوع on Arabic status row
    assert "الرصيد" in text  # bilingual Balance header
    assert "Already Paid" in text or "ALREADY PAID" in text
    # pymupdf often reshapes Arabic (المدفوع → املدفوع); assert a stable stem
    assert "مدفوع" in text and ("مسبق" in text or "الرصيد" in text)
    assert "Nationality" in text
    assert "Department" in text
    assert "Employee Payable" in text
    assert "Prepared by" in text
    assert "L-000008" in text
    images = pymupdf.open(stream=pdf, filetype="pdf")[0].get_images()
    assert images, "company logo must be embedded like offer letter"


def test_build_allocation_print_pdf_still_renders() -> None:
    pdf = build_allocation_print_pdf(
        {
            "ticket_code": "TKT-1",
            "employee_code": "1",
            "employee_name": "Test",
            "entitlement_amount": "10",
            "requested_ticket_amount": "20",
            "origin_code": "BAH",
            "destination_code": "CAI",
            "status": "APPROVED",
            "as_of_date": "2026-09-05",
        },
        prepared_by="admin",
    )
    assert pdf.startswith(b"%PDF")
    assert "Airfare Allocation" in _pdf_text(pdf)
