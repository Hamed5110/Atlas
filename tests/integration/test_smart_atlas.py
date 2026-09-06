"""Smart agent and report-template integration tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_ai_agent_diagnose_and_report_draft(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    diagnose = client.post(
        "/v1/ai/agent/chat",
        headers=admin_headers,
        json={"message": "Run diagnostics"},
    )
    assert diagnose.status_code == 200, diagnose.text
    body = diagnose.json()
    assert body["intent"] == "diagnose"
    assert body["outcome"] == "ok"
    assert "diagnose" in body["tools_used"]

    draft = client.post(
        "/v1/ai/agent/chat",
        headers=admin_headers,
        json={"message": "Draft a report on loans"},
    )
    assert draft.status_code == 200, draft.text
    payload = draft.json().get("report_designer_payload") or draft.json().get("report_spec")
    assert payload is not None
    assert payload["dataset"] == "loan-outstanding"

    unsafe = client.post(
        "/v1/ai/agent/chat",
        headers=admin_headers,
        json={"message": "please truncate all tables"},
    )
    assert unsafe.status_code == 200
    assert unsafe.json()["outcome"] == "manual_review"


def test_report_templates_seed_and_run(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    listed = client.get("/v1/report-templates", headers=admin_headers)
    assert listed.status_code == 200, listed.text
    templates = listed.json()
    assert len(templates) >= 8
    excess = next(t for t in templates if t["dataset"] == "excess-recovery")
    ran = client.get(
        f"/v1/report-templates/{excess['id']}/run",
        headers=admin_headers,
        params={"format": "json"},
    )
    assert ran.status_code == 200, ran.text
    assert "columns" in ran.json()
    assert ran.json()["dataset"] == "excess-recovery"


def test_crystal_status_unconfigured(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    status = client.get("/v1/crystal/status", headers=admin_headers)
    assert status.status_code == 200
    assert status.json()["configured"] is False
