"""Travel intelligence: expense anomaly detection and EMI default risk scoring.

Uses scikit-learn / pandas when installed. Falls back to transparent statistical
rules so the API remains usable without the optional ML stack.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal
from statistics import mean
from typing import Any, Mapping, Sequence


ANOMALY_THRESHOLD_PCT = Decimal("25")
_CACHED_MODELS: dict[str, object] = {}


def _cached_isolation_forest(peer_amounts: list[float]) -> object | None:
    """Fit IsolationForest once and reuse for the process lifetime."""
    if len(peer_amounts) < 8:
        return None
    cached = _CACHED_MODELS.get("isolation_forest")
    if cached is not None:
        return cached
    try:
        from sklearn.ensemble import IsolationForest

        model = IsolationForest(contamination=0.15, random_state=42)
        model.fit([[value] for value in peer_amounts])
        _CACHED_MODELS["isolation_forest"] = model
        return model
    except Exception:
        return None


def _cached_logistic_risk_model() -> object | None:
    """Return a process-wide logistic risk model (synthetic prior)."""
    cached = _CACHED_MODELS.get("logistic_risk")
    if cached is not None:
        return cached
    try:
        import numpy as np
        from sklearn.linear_model import LogisticRegression

        rng = np.random.default_rng(42)
        x_train: list[list[float]] = []
        y_train: list[int] = []
        for _ in range(80):
            burden = float(rng.uniform(5, 80))
            tenure = float(rng.uniform(1, 36))
            defaults = float(rng.integers(0, 4))
            x_train.append([burden, tenure, defaults])
            y_train.append(1 if (burden > 35 or defaults >= 2 or (burden > 25 and tenure > 24)) else 0)
        model = LogisticRegression(max_iter=200)
        model.fit(np.array(x_train), np.array(y_train))
        _CACHED_MODELS["logistic_risk"] = model
        return model
    except Exception:
        return None


@dataclass(frozen=True)
class AnomalyResult:
    """Expense anomaly assessment for one claim."""

    is_anomaly: bool
    deviation_pct: Decimal
    pay_group_average: Decimal
    claim_amount: Decimal
    threshold_pct: Decimal
    method: str
    message: str

    def as_dict(self) -> dict[str, Any]:
        """JSON-serializable payload."""
        payload = asdict(self)
        for key, value in list(payload.items()):
            if isinstance(value, Decimal):
                payload[key] = str(value)
        return payload


@dataclass(frozen=True)
class EmiRiskResult:
    """Loan EMI default-risk score before approving over-budget travel loans."""

    risk_score: Decimal
    risk_band: str
    recommend_approve: bool
    features: dict[str, Decimal]
    method: str
    message: str

    def as_dict(self) -> dict[str, Any]:
        """JSON-serializable payload."""
        payload = asdict(self)
        payload["features"] = {key: str(value) for key, value in self.features.items()}
        payload["risk_score"] = str(self.risk_score)
        return payload


def _to_decimal(value: object, default: str = "0") -> Decimal:
    try:
        return Decimal(str(value if value is not None else default))
    except Exception:
        return Decimal(default)


def detect_expense_anomaly(
    claim_amount: Decimal | float | str,
    peer_amounts: Sequence[Decimal | float | str],
    *,
    threshold_pct: Decimal = ANOMALY_THRESHOLD_PCT,
) -> AnomalyResult:
    """Flag claims that deviate more than threshold_pct from the peer average.

    Prefers IsolationForest when scikit-learn is available and enough peers exist;
    otherwise uses absolute percent deviation from the mean.
    """
    claim = _to_decimal(claim_amount)
    peers = [_to_decimal(item) for item in peer_amounts if _to_decimal(item) > 0]
    if not peers:
        return AnomalyResult(
            is_anomaly=False,
            deviation_pct=Decimal("0"),
            pay_group_average=Decimal("0"),
            claim_amount=claim,
            threshold_pct=threshold_pct,
            method="insufficient_history",
            message="No pay-group history available; anomaly check skipped.",
        )
    average = Decimal(str(mean(peers))).quantize(Decimal("0.0001"))
    if average <= 0:
        deviation = Decimal("0")
    else:
        deviation = ((claim - average).copy_abs() / average * Decimal("100")).quantize(
            Decimal("0.01")
        )

    method = "percent_deviation"
    is_anomaly = deviation > threshold_pct
    peer_floats = [float(item) for item in peers]
    model = _cached_isolation_forest(peer_floats + [float(claim)])
    if model is not None:
        labels = model.predict([[float(claim)]])
        is_anomaly = bool(labels[0] == -1) or deviation > threshold_pct
        method = "isolation_forest+percent"

    message = (
        f"Claim {claim} is {deviation}% from pay-group average {average} "
        f"(threshold {threshold_pct}%)."
    )
    return AnomalyResult(
        is_anomaly=is_anomaly,
        deviation_pct=deviation,
        pay_group_average=average,
        claim_amount=claim,
        threshold_pct=threshold_pct,
        method=method,
        message=message,
    )


def score_emi_default_risk(
    *,
    principal: Decimal | float | str,
    tenure_months: int,
    outstanding_loans: Decimal | float | str = 0,
    prior_defaults: int = 0,
    salary_proxy: Decimal | float | str | None = None,
    entitlement: Decimal | float | str | None = None,
) -> EmiRiskResult:
    """Score repayment risk for an over-budget travel loan before approval.

    Higher scores mean higher default risk (0–100). Uses a logistic-style blend of
    debt burden, tenure stretch, and prior defaults. Optional sklearn LogisticRegression
    is fitted on a small synthetic prior when available.
    """
    principal_d = _to_decimal(principal)
    outstanding = _to_decimal(outstanding_loans)
    tenure = max(1, int(tenure_months))
    emi = (principal_d / Decimal(tenure)).quantize(Decimal("0.0001"))
    income = _to_decimal(salary_proxy or entitlement or "150", default="150")
    if income <= 0:
        income = Decimal("150")
    burden = ((emi + outstanding / Decimal("12")) / income * Decimal("100")).quantize(
        Decimal("0.01")
    )
    tenure_factor = Decimal(min(40, tenure)).quantize(Decimal("0.01"))
    default_factor = Decimal(min(30, prior_defaults * 10))
    features = {
        "emi": emi,
        "debt_burden_pct": burden,
        "tenure_months": Decimal(tenure),
        "prior_defaults": Decimal(prior_defaults),
        "income_proxy": income,
    }

    method = "rule_blend"
    # Weighted blend → 0..100
    score = min(
        Decimal("100"),
        (burden * Decimal("0.55") + tenure_factor * Decimal("0.25") + default_factor * Decimal("0.20")),
    ).quantize(Decimal("0.01"))

    try:
        model = _cached_logistic_risk_model()
        if model is not None:
            import numpy as np

            prob = float(
                model.predict_proba(
                    np.array([[float(burden), float(tenure), float(prior_defaults)]])
                )[0][1]
            )
            score = (Decimal(str(prob)) * Decimal("100")).quantize(Decimal("0.01"))
            method = "logistic_regression"
    except Exception:
        method = "rule_blend"

    if score >= Decimal("70"):
        band = "high"
        approve = False
    elif score >= Decimal("40"):
        band = "medium"
        approve = True
    else:
        band = "low"
        approve = True

    return EmiRiskResult(
        risk_score=score,
        risk_band=band,
        recommend_approve=approve,
        features=features,
        method=method,
        message=(
            f"EMI risk {band} ({score}/100); "
            f"{'approve with caution' if approve else 'do not auto-approve'}."
        ),
    )


def summarize_peer_amounts(rows: Sequence[Mapping[str, Any]], amount_key: str = "ticket_cost") -> list[Decimal]:
    """Extract numeric peer claim amounts from MSSQL-backed row mappings."""
    return [_to_decimal(row.get(amount_key)) for row in rows if row.get(amount_key) is not None]
