"""Locked Meta template catalog (EN + AR) — decision lock #6."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class WaTemplate:
    name: str
    language: str  # en | ar
    category: str  # UTILITY | MARKETING
    purpose: str
    cloud_only: bool = True


# Names are registry keys for Meta Business Manager — operator must register these.
TEMPLATES: tuple[WaTemplate, ...] = (
    WaTemplate("usr_request_received_en", "en", "UTILITY", "Request received ack"),
    WaTemplate("usr_request_received_ar", "ar", "UTILITY", "Request received ack"),
    WaTemplate("mgr_approval_request_en", "en", "UTILITY", "Manager Approve/Reject/Escalate"),
    WaTemplate("mgr_approval_request_ar", "ar", "UTILITY", "Manager Approve/Reject/Escalate"),
    WaTemplate("mgr_bulk_digest_en", "en", "MARKETING", "Bulk digest with STOP"),
    WaTemplate("mgr_bulk_digest_ar", "ar", "MARKETING", "Bulk digest with STOP"),
    WaTemplate("usr_decision_notice_en", "en", "UTILITY", "Decision outcome notice"),
    WaTemplate("usr_decision_notice_ar", "ar", "UTILITY", "Decision outcome notice"),
)

_BY_NAME = {t.name: t for t in TEMPLATES}


def list_templates() -> list[dict[str, str | bool]]:
    return [
        {
            "name": t.name,
            "language": t.language,
            "category": t.category,
            "purpose": t.purpose,
            "cloud_only": t.cloud_only,
        }
        for t in TEMPLATES
    ]


def get_template(name: str) -> WaTemplate | None:
    return _BY_NAME.get(name)


def require_template(name: str, language: str) -> WaTemplate:
    tpl = get_template(name)
    if tpl is None:
        raise ValueError("unknown_template")
    lang = (language or "").lower().split("-")[0]
    if tpl.language != lang:
        raise ValueError("template_language_mismatch")
    return tpl


def build_marketing_digest(*, language: str, lines: list[str], include_stop: bool = True) -> str:
    """Plain-text digest body with mandatory STOP for MARKETING (decision #7)."""
    lang = (language or "en").lower().split("-")[0]
    header = (
        "ATLAS Airfare — pending approvals digest"
        if lang != "ar"
        else "اطلس لتذاكر السفر — ملخص الموافقات المعلقة"
    )
    body = "\n".join([header, *[ln for ln in lines if ln], ""])
    if include_stop:
        stop = (
            "Reply STOP to opt out of marketing digests."
            if lang != "ar"
            else "أرسل STOP لإيقاف رسائل التسويق."
        )
        body += stop
    return body.strip()
