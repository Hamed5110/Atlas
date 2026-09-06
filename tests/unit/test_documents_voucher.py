"""Unit tests for Focus-inspired ATLAS document vouchers (no Focus8080)."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from airfare_management.application.documents import (
    DocumentParamsError,
    _TEMPLATE_INDEX,
    validate_params,
)


def test_validate_params_computes_net_from_focus_grid() -> None:
    template = _TEMPLATE_INDEX["offer_default"]
    params = validate_params(
        template,
        {
            "full_name": "Test Candidate",
            "nationality": "BAHRAINI",
            "nature_of_employment": "Sales Executive",
            "joining_date": "2026-09-02",
            "document_date": "2026-09-02",
            "probation_months": "3",
            "basic": "400",
            "hra": "0",
            "petrol_allowance": "0",
            "car_allowance": "0",
            "special_duty_allowance": "50",
            "annual_leave_days": "30",
            "signatory_name": "HR Manager",
            "offer_valid_until": (date.today() + timedelta(days=14)).isoformat(),
            "traveling_airfare": "true",
        },
    )
    assert Decimal(params["net"]) == Decimal("450")
    assert params["basic_fmt"] is not None
    assert params["position_title"] == "Sales Executive"


def test_validate_params_rejects_past_offer_validity() -> None:
    template = _TEMPLATE_INDEX["offer_default"]
    with pytest.raises(DocumentParamsError):
        validate_params(
            template,
            {
                "full_name": "Test Candidate",
                "nationality": "BAHRAINI",
                "nature_of_employment": "Clerk",
                "joining_date": "2026-09-02",
                "document_date": "2026-09-02",
                "probation_months": "3",
                "basic": "300",
                "annual_leave_days": "30",
                "offer_valid_until": "2020-01-01",
            },
        )


def test_signatory_defaults_when_blank() -> None:
    template = _TEMPLATE_INDEX["contract_unlimited"]
    params = validate_params(
        template,
        {
            "full_name": "Test Candidate",
            "nationality": "INDIAN",
            "nature_of_employment": "Technician",
            "joining_date": "2026-09-02",
            "document_date": "2026-09-02",
            "probation_months": "3",
            "basic": "500",
            "annual_leave_days": "30",
            "working_hours": "48",
            "notice_period_days": "30",
            "signatory_name": "",
        },
    )
    assert params["signatory_name"] == "Authorized Signatory"
    assert "net_in_words" in params
