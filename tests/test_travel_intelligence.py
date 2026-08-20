"""Unit tests for travel intelligence anomaly and EMI risk scoring."""

from decimal import Decimal

from airfare_management.ai_agent.travel_intelligence import (
    detect_expense_anomaly,
    score_emi_default_risk,
)


def test_expense_anomaly_flags_large_deviation() -> None:
    """Claims >25% above pay-group average are anomalies."""
    result = detect_expense_anomaly(
        Decimal("200"),
        [Decimal("100"), Decimal("110"), Decimal("90"), Decimal("105")],
    )
    assert result.is_anomaly is True
    assert result.deviation_pct > Decimal("25")


def test_expense_anomaly_allows_near_average() -> None:
    """Near-average claims are not anomalies."""
    result = detect_expense_anomaly(
        Decimal("105"),
        [Decimal("100"), Decimal("110"), Decimal("95"), Decimal("102")],
    )
    assert result.is_anomaly is False


def test_emi_risk_high_burden_not_auto_approved() -> None:
    """Very large EMI relative to entitlement raises risk."""
    result = score_emi_default_risk(
        principal=Decimal("5000"),
        tenure_months=3,
        outstanding_loans=Decimal("2000"),
        prior_defaults=2,
        entitlement=Decimal("100"),
    )
    assert result.risk_score >= Decimal("40")
    assert result.risk_band in {"medium", "high"}


def test_emi_risk_small_loan_is_low() -> None:
    """Small short loans against healthy entitlement score low."""
    result = score_emi_default_risk(
        principal=Decimal("30"),
        tenure_months=6,
        outstanding_loans=Decimal("0"),
        prior_defaults=0,
        entitlement=Decimal("150"),
    )
    assert result.recommend_approve is True
    assert result.risk_band in {"low", "medium"}
