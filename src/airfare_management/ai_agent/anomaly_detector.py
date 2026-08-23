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
    """Flag rows whose ticket cost deviates from peer averages."""
    peers = [row.get(amount_key) for row in rows if row.get(amount_key) is not None]
    flagged: list[dict[str, Any]] = []
    for row in rows:
        amount = row.get(amount_key)
        if amount is None:
            continue
        rate = row.get(rate_key) or Decimal("1")
        ratio = Decimal(str(amount)) / Decimal(str(rate or "1"))
        result = detect_expense_anomaly(amount, peers)
        if result.is_anomaly or ratio > Decimal("1.25"):
            flagged.append({**row, "anomaly": result.as_dict()})
    return flagged
