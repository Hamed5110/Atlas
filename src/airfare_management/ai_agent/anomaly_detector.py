"""IsolationForest-based expense anomaly detection (on-premise, no paid APIs)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Sequence

from airfare_management.ai_agent.travel_intelligence import detect_expense_anomaly


def score_ticket_anomalies(
    rows: Sequence[dict[str, Any]],
    *,
    amount_key: str = "ticket_cost",
    rate_key: str = "entitlement",
) -> list[dict[str, Any]]:
    """Flag rows whose ticket cost deviates from peer averages.

    TRUE MODE: never crash on zero/null entitlement — treat zero rate as 1 for ratio.
    """
    peers = [row.get(amount_key) for row in rows if row.get(amount_key) is not None]
    flagged: list[dict[str, Any]] = []
    for row in rows:
        amount = row.get(amount_key)
        if amount is None:
            continue
        try:
            amount_dec = Decimal(str(amount))
        except Exception:  # noqa: BLE001
            continue
        try:
            rate_dec = Decimal(str(row.get(rate_key) if row.get(rate_key) is not None else "1"))
        except Exception:  # noqa: BLE001
            rate_dec = Decimal("1")
        if rate_dec <= 0:
            rate_dec = Decimal("1")
        ratio = amount_dec / rate_dec
        result = detect_expense_anomaly(amount_dec, peers)
        if result.is_anomaly or ratio > Decimal("1.25"):
            flagged.append({**row, "anomaly": result.as_dict()})
    return flagged
