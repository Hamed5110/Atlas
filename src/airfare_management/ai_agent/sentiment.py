"""ESS request sentiment (lazy transformer with keyword fallback)."""

from __future__ import annotations

_PIPELINE: object | bool | None = None


def analyze_sentiment(text: str) -> dict[str, object]:
    """Return sentiment label and urgency flag for ESS notes."""
    global _PIPELINE
    cleaned = (text or "").strip()
    if not cleaned:
        return {"label": "neutral", "score": 0.5, "urgent": False, "method": "empty"}
    urgent_words = {"urgent", "emergency", "immediate", "asap", "critical"}
    urgent = any(word in cleaned.lower() for word in urgent_words)
    if _PIPELINE is None:
        try:
            from transformers import pipeline

            _PIPELINE = pipeline(
                "sentiment-analysis",
                model="distilbert-base-uncased-finetuned-sst-2-english",
            )
        except Exception:
            _PIPELINE = False
    if _PIPELINE:
        result = _PIPELINE(cleaned[:512])[0]
        label = str(result.get("label", "NEUTRAL")).lower()
        score = float(result.get("score", 0.5))
        return {
            "label": label,
            "score": score,
            "urgent": urgent or label == "negative",
            "method": "transformer",
        }
    negative = any(word in cleaned.lower() for word in {"delay", "problem", "issue", "complaint"})
    return {
        "label": "negative" if negative else "neutral",
        "score": 0.6 if negative else 0.5,
        "urgent": urgent,
        "method": "keyword",
    }
