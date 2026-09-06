"""Schema-gated AI Data Agent tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from airfare_management.ai_agent.sql_gate import validate_against_schema

pytestmark = pytest.mark.integration


def test_sql_gate_blocks_dml_and_unknown_tables() -> None:
    with pytest.raises(ValueError, match="DML"):
        validate_against_schema("DELETE FROM employees")
    with pytest.raises(ValueError, match="don't see table"):
        validate_against_schema("SELECT * FROM gl_journals")
    ok = validate_against_schema(
        "SELECT code, full_name FROM employees WHERE deleted_at IS NULL"
    )
    assert ok["ok"] is True
    assert "employees" in ok["tables"]


def test_agent_diagnose_and_refuse_fix_everything(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    schema = client.get("/v1/ai/agent/schema", headers=admin_headers)
    assert schema.status_code == 200
    assert "employees" in schema.json()["tables"]

    refuse = client.post(
        "/v1/ai/agent/chat",
        headers=admin_headers,
        json={"message": "Fix everything you find"},
    )
    assert refuse.status_code == 200
    assert refuse.json()["outcome"] == "manual_review"

    diagnose = client.post(
        "/v1/ai/agent/chat",
        headers=admin_headers,
        json={"message": "Run diagnostics"},
    )
    assert diagnose.status_code == 200, diagnose.text
    body = diagnose.json()
    assert body["intent"] == "diagnose"
    assert body["outcome"] == "ok"
    assert "confidence_score" in body

    draft = client.post(
        "/v1/ai/agent/chat",
        headers=admin_headers,
        json={"message": "Draft a report on loans"},
    )
    assert draft.status_code == 200
    payload = draft.json().get("report_designer_payload")
    assert payload is not None
    assert payload["dataset"] == "loan-outstanding"
    assert "SELECT" in payload["sql_source"].upper()


def test_agent_repair_requires_auto_mode(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    preview = client.post(
        "/v1/ai/agent/chat",
        headers=admin_headers,
        json={"message": "Fix locked users", "auto_repair_mode": False},
    )
    assert preview.status_code == 200
    assert preview.json()["outcome"] == "manual_review"
