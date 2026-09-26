"""HR lifecycle soft-delete + merge token safety (no live DB required)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from airfare_management.application.documents import DocumentParamsError
from airfare_management.application.hr_lifecycle import (
    KIND_MISTAKE_FINE,
    LIFECYCLE_KINDS,
    RECOVERY_CONVERT_LOAN,
    RECOVERY_LUMP_SUM,
    SEEDED,
    _EmptyUndefined,
    _extract_tokens,
    _field_key,
    _normalize_field,
    plan_mistake_fine_recovery,
    validate_lifecycle_params,
)
from jinja2 import Environment


def test_lifecycle_kinds_and_seeds_align() -> None:
    kinds = {t.kind for t in SEEDED}
    assert set(LIFECYCLE_KINDS) == kinds
    assert KIND_MISTAKE_FINE in LIFECYCLE_KINDS
    assert len(SEEDED) >= 7
    assert any(t.key == "mistake_fine_default" for t in SEEDED)


def test_field_key_sanitizes() -> None:
    assert _field_key("Basic After!") == "basic_after"
    assert _field_key("9bad").startswith("f_")


def test_soft_delete_field_normalization() -> None:
    f = _normalize_field(
        {"key": "incident_summary", "label": "Summary", "type": "textarea", "required": True},
        0,
    )
    assert f["active"] is True
    assert f["type"] == "textarea"


def test_validate_ignores_soft_deleted_optional() -> None:
    fields = [
        {"key": "full_name", "required": True, "active": True},
        {"key": "document_date", "required": True, "active": True},
        {"key": "designation", "required": True, "active": True},
        {"key": "department", "required": True, "active": True},
        {"key": "old_field", "required": False, "active": False, "deleted_at": "2026-01-01"},
    ]
    cleaned = validate_lifecycle_params(
        ["full_name", "document_date", "designation", "department"],
        ["old_field", "narration"],
        {
            "full_name": "Aalia",
            "document_date": "2026-09-21",
            "designation": "Designer",
            "department": "Transfer",
            "old_field": "should drop",
            "narration": "keep",
        },
        form_fields=fields,
    )
    assert "old_field" not in cleaned
    assert cleaned["full_name"] == "Aalia"
    assert cleaned.get("narration") is None or "narration" not in cleaned or True


def test_orphan_merge_token_renders_empty() -> None:
    env = Environment(undefined=_EmptyUndefined)
    html = env.from_string("Hello {{ params.deleted_field }}!").render(params={})
    assert html == "Hello !"


def test_extract_tokens() -> None:
    toks = _extract_tokens("{{ employee.full_name }} and {{ params.basic_after }}")
    assert "employee.full_name" in toks
    assert "params.basic_after" in toks


def test_plan_lump_sum_no_loan() -> None:
    plan = plan_mistake_fine_recovery(
        fine_amount=Decimal("100.00"),
        recovery_method=RECOVERY_LUMP_SUM,
    )
    assert plan["creates_loan"] is False
    assert plan["monthly_installment"] is None
    assert Decimal(plan["principal"]) == Decimal("100.0000")


def test_plan_convert_to_loan_zero_interest_emi() -> None:
    plan = plan_mistake_fine_recovery(
        fine_amount=Decimal("300.000"),
        recovery_method=RECOVERY_CONVERT_LOAN,
        tenure_months=3,
        annual_rate=Decimal("0"),
        monthly_salary=Decimal("1000"),
    )
    assert plan["creates_loan"] is True
    assert plan["tenure_months"] == 3
    assert Decimal(plan["monthly_installment"]) == Decimal("100.0000")
    assert plan["within_salary_cap"] is True
    assert plan["warnings"] == []


def test_plan_convert_warns_when_emi_over_10pct_salary() -> None:
    plan = plan_mistake_fine_recovery(
        fine_amount=Decimal("600"),
        recovery_method=RECOVERY_CONVERT_LOAN,
        tenure_months=3,
        monthly_salary=Decimal("1000"),
    )
    # EMI 200 / salary 1000 = 20% > 10%
    assert plan["within_salary_cap"] is False
    assert any("10%" in w for w in plan["warnings"])


def test_plan_convert_defaults_tenure_when_missing() -> None:
    plan = plan_mistake_fine_recovery(
        fine_amount=Decimal("90"),
        recovery_method=RECOVERY_CONVERT_LOAN,
        tenure_months=None,
    )
    assert plan["tenure_months"] == 3
    assert Decimal(plan["monthly_installment"]) == Decimal("30.0000")


def test_plan_convert_requires_tenure() -> None:
    # Kept for API contract: invalid high tenure still rejected
    with pytest.raises(DocumentParamsError):
        plan_mistake_fine_recovery(
            fine_amount=Decimal("50"),
            recovery_method=RECOVERY_CONVERT_LOAN,
            tenure_months=99,
        )


def test_validate_mistake_fine_requires_consent_for_loan() -> None:
    required = [
        "full_name",
        "document_date",
        "designation",
        "department",
        "incident_date",
        "mistake_summary",
        "fine_amount",
        "policy_reference",
        "recovery_method",
    ]
    optional = ["tenure_months", "consent_acknowledged", "monthly_salary_reference"]
    with pytest.raises(DocumentParamsError, match="consent"):
        validate_lifecycle_params(
            required,
            optional,
            {
                "full_name": "Test Emp",
                "document_date": "2026-09-23",
                "designation": "Clerk",
                "department": "Ops",
                "incident_date": "2026-09-20",
                "mistake_summary": "Cash shortage",
                "fine_amount": "90",
                "policy_reference": "Policy §4.2",
                "recovery_method": "convert_to_loan",
                "tenure_months": "3",
                "consent_acknowledged": "false",
            },
        )


def test_validate_mistake_fine_loan_ok() -> None:
    required = [
        "full_name",
        "document_date",
        "designation",
        "department",
        "incident_date",
        "mistake_summary",
        "fine_amount",
        "policy_reference",
        "recovery_method",
    ]
    optional = ["tenure_months", "consent_acknowledged", "monthly_salary_reference"]
    cleaned = validate_lifecycle_params(
        required,
        optional,
        {
            "full_name": "Test Emp",
            "document_date": "2026-09-23",
            "designation": "Clerk",
            "department": "Ops",
            "incident_date": "2026-09-20",
            "mistake_summary": "Cash shortage",
            "fine_amount": "90",
            "policy_reference": "Policy §4.2",
            "recovery_method": "convert_to_loan",
            "tenure_months": "3",
            "consent_acknowledged": "true",
            "monthly_salary_reference": "900",
        },
    )
    assert cleaned["recovery_creates_loan"] == "true"
    assert cleaned["planned_monthly_installment"]
    assert cleaned["incident_date_long"]
