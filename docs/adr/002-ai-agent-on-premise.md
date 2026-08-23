# ADR 002: On-premise AI agent (no paid APIs)

## Status

Accepted (2026-08-22)

## Context

Airfare anomaly detection, EMI risk scoring, budget forecasting, ESS sentiment, and rate recommendations must run entirely inside the customer network. External LLM/ML APIs introduce cost, latency, and data-residency risk.

## Decision

Implement AI features with open-source, on-prem libraries:

- **scikit-learn** — IsolationForest anomalies, LogisticRegression EMI risk
- **statsmodels** — ARIMA budget forecasts
- **transformers** — DistilBERT sentiment (lazy-loaded)

Models are cached in memory (and optionally Redis) after first fit. HTTP endpoints under `/v1/ai/*` expose scores to the Vue admin and ESS portal.

## Consequences

- Higher CPU/RAM at startup or first request; acceptable for batch/on-demand use.
- Model quality is bounded by local training data; no GPT-style reasoning.
- No recurring API fees or outbound data transfer for ML inference.
