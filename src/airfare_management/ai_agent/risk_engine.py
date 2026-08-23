"""Pre-trained EMI default risk engine (cached logistic model)."""

from __future__ import annotations

from decimal import Decimal

from airfare_management.ai_agent.travel_intelligence import score_emi_default_risk


def loan_risk_score(
    *,
    principal: Decimal | float | str,
    tenure_months: int,
    outstanding_loans: Decimal | float | str = 0,
    prior_defaults: int = 0,
    entitlement: Decimal | float | str | None = None,
) -> dict[str, object]:
    """Return probability, band, and top risk factors for a loan."""
    result = score_emi_default_risk(
        principal=principal,
        tenure_months=tenure_months,
        outstanding_loans=outstanding_loans,
        prior_defaults=prior_defaults,
        entitlement=entitlement,
    )
    factors = sorted(
        ((key, str(value)) for key, value in result.features.items()),
        key=lambda item: Decimal(item[1]),
        reverse=True,
    )[:3]
    payload = result.as_dict()
    payload["top_factors"] = [{"name": name, "value": value} for name, value in factors]
    return payload
