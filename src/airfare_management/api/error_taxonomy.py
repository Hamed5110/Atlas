"""Stable API error_class and outbound failure taxonomy (Red Team H/I)."""

from __future__ import annotations

from typing import Any, Literal

ErrorClass = Literal["business_rule", "infrastructure_retryable"]
OutboundStatus = Literal[
    "config_missing",
    "provider_reject",
    "user_unreachable",
    "success",
]

# Codes that mean "retry later / infra", not a business invariant.
_INFRASTRUCTURE_CODES = frozenset(
    {
        "pdf_missing",
        "pdf_render_failed",
        "storage_unavailable",
        "database_unavailable",
        "upstream_timeout",
        "upstream_unavailable",
        "evolution_unreachable",
        "service_unavailable",
        "internal_error",
    }
)


def classify_error_class(
    code: str,
    *,
    status: int | None = None,
    explicit: ErrorClass | None = None,
) -> ErrorClass:
    """Map a machine code / HTTP status to business vs infrastructure_retryable."""
    if explicit in ("business_rule", "infrastructure_retryable"):
        return explicit
    normalized = (code or "").strip().lower()
    if normalized in _INFRASTRUCTURE_CODES:
        return "infrastructure_retryable"
    if status is not None and status >= 500:
        return "infrastructure_retryable"
    return "business_rule"


def classify_outbound_status(
    *,
    sent: bool = False,
    skipped: str | None = None,
    error: str | None = None,
    queued: bool = False,
    state: str | None = None,
    instance: str | None = None,
) -> OutboundStatus:
    """Classify a WhatsApp/outbound attempt into the four mandatory states."""
    if sent:
        return "success"

    skip = (skipped or "").strip().lower()
    if skip in {
        "evolution_disabled",
        "no_number",
        "no_instance",
        "api_key_missing",
        "config_missing",
    }:
        return "config_missing"

    err = (error or "").lower()
    if not instance and ("no evolution" in err or "create one in settings" in err):
        return "config_missing"
    if "api key" in err or "evolution_disabled" in err or "not configured" in err:
        return "config_missing"

    # Session not open / QR not scanned → treat as config until connected.
    if queued and state and state != "open":
        return "config_missing"
    if state and state != "open" and ("offline" in err or "session" in err or "scan qr" in err):
        return "config_missing"

    unreachable_tokens = (
        "not registered",
        "not on whatsapp",
        "exists\":false",
        "number not found",
        "invalid number",
        "user unreachable",
        "recipient unreachable",
    )
    if any(token in err for token in unreachable_tokens):
        return "user_unreachable"

    if error or queued:
        return "provider_reject"

    if skip:
        return "config_missing"
    return "provider_reject"


def with_outbound_status(result: dict[str, Any]) -> dict[str, Any]:
    """Ensure ``outbound_status`` is present and consistent on a send result."""
    out = dict(result)
    status = classify_outbound_status(
        sent=bool(out.get("sent")),
        skipped=out.get("skipped") if isinstance(out.get("skipped"), str) else None,
        error=out.get("error") if isinstance(out.get("error"), str) else None,
        queued=bool(out.get("queued")),
        state=out.get("state") if isinstance(out.get("state"), str) else None,
        instance=out.get("instance") if isinstance(out.get("instance"), str) else None,
    )
    out["outbound_status"] = status
    # Per-recipient rows inherit classification when missing.
    results = out.get("results")
    parent_skipped = out.get("skipped") if isinstance(out.get("skipped"), str) else None
    if isinstance(results, list):
        enriched: list[dict[str, Any]] = []
        for row in results:
            if not isinstance(row, dict):
                enriched.append(row)
                continue
            item = dict(row)
            if "outbound_status" not in item:
                item_skipped = (
                    item.get("skipped")
                    if isinstance(item.get("skipped"), str)
                    else parent_skipped
                )
                item["outbound_status"] = classify_outbound_status(
                    sent=bool(item.get("sent")),
                    skipped=item_skipped,
                    error=item.get("error") if isinstance(item.get("error"), str) else None,
                    queued=bool(item.get("queued")),
                    state=out.get("state") if isinstance(out.get("state"), str) else None,
                    instance=out.get("instance") if isinstance(out.get("instance"), str) else None,
                )
            enriched.append(item)
        out["results"] = enriched
    return out
