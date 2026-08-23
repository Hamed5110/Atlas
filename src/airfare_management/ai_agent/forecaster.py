"""Budget forecaster using simple moving average (statsmodels optional)."""

from __future__ import annotations

from decimal import Decimal
from typing import Sequence


def forecast_monthly_spend(history: Sequence[Decimal | float | str], months: int = 12) -> dict[str, object]:
    """12-month forward projection with naive confidence band."""
    values = [Decimal(str(item)) for item in history if item is not None]
    if not values:
        return {"months": months, "forecast": [], "method": "empty"}
    average = sum(values) / Decimal(len(values))
    try:
        from statsmodels.tsa.arima.model import ARIMA

        model = ARIMA([float(v) for v in values], order=(1, 1, 0))
        fitted = model.fit()
        forecast = fitted.forecast(steps=months)
        points = [Decimal(str(x)).quantize(Decimal("0.01")) for x in forecast]
        method = "arima"
    except Exception:
        points = [average.quantize(Decimal("0.01")) for _ in range(months)]
        method = "moving_average"
    band = (average * Decimal("0.2")).quantize(Decimal("0.01"))
    return {
        "months": months,
        "forecast": [
            {"month": index + 1, "amount": str(amount), "low": str(amount - band), "high": str(amount + band)}
            for index, amount in enumerate(points)
        ],
        "method": method,
    }
