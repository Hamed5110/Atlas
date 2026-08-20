"""Compatibility path expected by product docs: app.ai_agent.travel_intelligence."""

from airfare_management.ai_agent.travel_intelligence import (
    AnomalyResult,
    EmiRiskResult,
    detect_expense_anomaly,
    score_emi_default_risk,
    summarize_peer_amounts,
)

__all__ = [
    "AnomalyResult",
    "EmiRiskResult",
    "detect_expense_anomaly",
    "score_emi_default_risk",
    "summarize_peer_amounts",
]
