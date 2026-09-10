"""Unit: anomaly scorer must not DivisionByZero on zero entitlement (TRUE MODE)."""

from __future__ import annotations

from decimal import Decimal

from airfare_management.ai_agent.anomaly_detector import score_ticket_anomalies


def test_score_ticket_anomalies_zero_entitlement():
    rows = [
        {"ticket_cost": "500", "entitlement": "0", "employee_id": "a"},
        {"ticket_cost": "100", "entitlement": "0.0000", "employee_id": "b"},
        {"ticket_cost": "120", "entitlement": "100", "employee_id": "c"},
    ]
    flagged = score_ticket_anomalies(rows)
    assert isinstance(flagged, list)
    # zero entitlement uses rate=1 → ratio 500 > 1.25 → flagged
    assert any(str(r.get("employee_id")) == "a" for r in flagged)


def test_score_ticket_anomalies_null_rate():
    rows = [{"ticket_cost": Decimal("50"), "entitlement": None, "employee_id": "x"}]
    flagged = score_ticket_anomalies(rows)
    assert isinstance(flagged, list)
