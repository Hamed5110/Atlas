"""Smart AI Agent (SAA) baseline tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from airfare_management.ai_agent.smart_system_agent import ZERO_RISK_WHITELIST, SAA_VERSION

pytestmark = pytest.mark.integration


def test_saa_baseline_returns_queue(client: TestClient, admin_headers: dict[str, str]) -> None:
    resp = client.post("/v1/ai/saa/baseline", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["saa_version"] == SAA_VERSION
    assert "executive_summary" in body
    assert "action_queue" in body
    assert body["focus8080"]["focus_origin_count"] >= 0
    assert "Shall I proceed" in body["ask"]


def test_saa_silent_fixes_whitelist_only(client: TestClient, admin_headers: dict[str, str]) -> None:
    assert "update_statistics" in ZERO_RISK_WHITELIST
    resp = client.post(
        "/v1/ai/saa/silent-fixes",
        headers=admin_headers,
        json={"codes": ["update_statistics"], "confirm": "SILENT_APPLY"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["format"] == "autonomous_action_report"
    assert any(a["code"] == "update_statistics" for a in body["applied"])
