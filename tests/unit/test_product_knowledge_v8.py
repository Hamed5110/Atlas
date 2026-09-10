"""Product knowledge v8 — full app catalog + easy-path capability replies."""

from __future__ import annotations

from airfare_management.ai_agent.product_knowledge import (
    KNOWLEDGE_VERSION,
    MODULE_CATALOG,
    capability_reply,
    match_capabilities,
)


def test_knowledge_version_v8():
    assert KNOWLEDGE_VERSION.endswith("v8")


def test_module_catalog_covers_core_and_advanced():
    ids = {m["id"] for m in MODULE_CATALOG}
    for need in (
        "ess",
        "finance_gl",
        "allocation",
        "entitlement_reconcile",
        "entitlement_accounts",
        "entitlement_payroll",
        "backups",
        "audit",
    ):
        assert need in ids


def test_ess_match_and_easy_howto():
    caps = match_capabilities("How do ESS requests work")
    assert any(c["id"] == "ess_self_service" for c in caps)
    text = capability_reply(caps)
    assert "/ess" in text
    assert "Easy steps" in text or "New request" in text


def test_whole_process_capability():
    caps = match_capabilities("Whole airfare process step by step")
    assert any(c["id"] == "end_to_end_airfare" for c in caps)
