"""Unit tests for Atlas-style airfare allocation print PDF."""

from datetime import date, datetime, timezone
from pathlib import Path

import pymupdf

from airfare_management.infrastructure.documents import build_allocation_print_pdf


def _pdf_text(pdf: bytes) -> str:
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    return "\n".join(page.get_text() for page in doc)


def test_build_allocation_print_pdf_includes_entitlement_and_branding() -> None:
    pdf = build_allocation_print_pdf(
        {
            "ticket_code": "TKT-1001",
            "employee_code": "5110",
            "employee_name": "Test Employee",
            "join_date": "2024-12-06",
            "nationality": "BAHRAINI",
            "designation": "Analyst",
            "department": "Finance",
            "branch": "Askar",
            "reporting_officer": "HASAN ABDULLA MAHMOOD",
            "origin_code": "BAH",
            "destination_code": "CAI",
            "entitlement_amount": "125.50",
            "as_of_date": "2026-08-23",
            "requested_ticket_amount": "180.00",
            "company_payout": "125.50",
            "employee_payable": "54.50",
            "status": "APPROVED",
            "excess_option": "ENTITLEMENT_AMOUNT",
            "rate_source": "COMPANY_PREFERENCE",
            "per_day_rate": "0.4167",
            "maximum_payout": "150.00",
            "opening_balance_amount": "40.00",
            "current_year_earned_amount": "85.50",
            "already_paid_amount": "0.00",
            "notes": "Family ticket settlement",
            "pay_group": "Monthly",
            "scenario": "opening_balance_accrual",
        },
        prepared_by="admin@atlas-aluminum.com",
        generated_at=datetime(2026, 8, 23, 10, 0, tzinfo=timezone.utc),
    )
    assert pdf.startswith(b"%PDF")
    text = _pdf_text(pdf)
    assert "Airfare Allocation" in text
    assert "ENTITLEMENT AMOUNT" in text
    assert "125.50" in text
    assert "computer-generated document" in text
    assert "1. EMPLOYEE INFORMATION" in text
    assert "Photo" not in text
    assert "3. ENTITLEMENT BALANCE SUMMARY" in text


def test_allocation_print_sample_matches_leave_layout_markers(tmp_path: Path) -> None:
    pdf = build_allocation_print_pdf(
        {
            "document_number": "3352",
            "employee_code": "0150",
            "employee_name": "GHALEB HUSAIN",
            "join_date": date(2024, 12, 6),
            "department": "Finance Department",
            "designation": "Customer Account Controller",
            "nationality": "BAHRAINI",
            "branch": "Hamalah",
            "entitlement_amount": "150.00",
            "requested_ticket_amount": "150.00",
            "as_of_date": date(2026, 8, 23),
            "origin_code": "ORG",
            "destination_code": "DST",
            "status": "APPROVED",
            "scenario": "Ticket Issue",
        },
        prepared_by="suatlasalum@gmail.com",
    )
    out = tmp_path / "airfare-allocation-print.pdf"
    out.write_bytes(pdf)
    assert out.stat().st_size > 1000
    text = _pdf_text(pdf)
    assert "APPROVALS REMARKS" in text
    assert "Prepared by" in text
    assert "suatlasalum@gmail.com" in text
    assert "HCM Airfare Management" in text
