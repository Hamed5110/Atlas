"""Hybrid airfare rate recommender (rules + historical average)."""

from __future__ import annotations

from decimal import Decimal
from typing import Sequence


def recommend_rate(
    *,
    tenure_years: int,
    pay_group: str,
    repair_center: str,
    historical_ticket_costs: Sequence[Decimal | float | str],
    global_default: Decimal | float | str = "150",
) -> dict[str, object]:
    """Suggest MaxPayout based on tenure, org unit, and peer spend."""
    base = Decimal(str(global_default))
    if tenure_years >= 10:
        base *= Decimal("1.10")
    elif tenure_years >= 5:
        base *= Decimal("1.05")
    if pay_group.upper().startswith("EXEC"):
        base *= Decimal("1.15")
    costs = [Decimal(str(item)) for item in historical_ticket_costs if item]
    if costs:
        peer = sum(costs) / Decimal(len(costs))
        base = (base + peer) / Decimal("2")
    seasonal = base * Decimal("1.02")
    return {
        "recommended_max_payout": str(seasonal.quantize(Decimal("0.01"))),
        "basis": {
            "tenure_years": tenure_years,
            "pay_group": pay_group,
            "repair_center": repair_center,
            "peer_samples": len(costs),
        },
    }
