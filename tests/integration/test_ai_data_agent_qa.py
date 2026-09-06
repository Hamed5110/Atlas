"""QA decision-table tests for the schema-gated AI Data Agent.

Covers: intent routing, safety refusals, SQL gate, repair preview/APPLY,
report designer handoff, audit trail, and API↔UI contract fields.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from airfare_management.ai_agent.schema_dictionary import SCHEMA_VERSION, WHITELIST_REPAIRS
from airfare_management.ai_agent.smart_agent import _classify
from airfare_management.ai_agent.sql_gate import validate_against_schema
from airfare_management.infrastructure.schema import AiAgentAuditRow, UserRow

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Fix everything you find", "unsafe_bulk_fix"),
        ("please repair all issues", "unsafe_bulk_fix"),
        ("truncate all tables", "unsafe"),
        ("drop table employees", "unsafe"),
        ("Run diagnostics", "diagnose"),
        ("scan for duplicate employees", "diagnose"),
        ("Fix locked users", "repair_preview"),
        ("unlock locked accounts", "repair_preview"),
        ("Draft a report on loans", "draft_report"),
        ("Build report for tickets", "draft_report"),
        ("Show schema dictionary", "schema"),
        ("what tables do you know", "schema"),
        ("Forecast spend next quarter", "forecast"),
        ("Find anomalies and outliers", "anomaly"),
        ("Show learning confidence", "learning"),
        ("write a SELECT query", "sql"),
        ("hello there", "general"),
    ],
)
def test_qa_intent_classifier_decision_table(message: str, expected: str) -> None:
    assert _classify(message) == expected


@pytest.mark.parametrize(
    ("sql", "must_fail"),
    [
        ("DELETE FROM employees", True),
        ("UPDATE employees SET code='X'", True),
        ("INSERT INTO employees (code) VALUES ('X')", True),
        ("DROP TABLE employees", True),
        ("SELECT * FROM gl_journals", True),
        ("SELECT code, full_name FROM employees WHERE deleted_at IS NULL", False),
    ],
)
def test_qa_sql_gate_matrix(sql: str, must_fail: bool) -> None:
    if must_fail:
        with pytest.raises(ValueError):
            validate_against_schema(sql)
    else:
        assert validate_against_schema(sql)["ok"] is True


def test_qa_agent_schema_contract(client: TestClient, admin_headers: dict[str, str]) -> None:
    resp = client.get("/v1/ai/agent/schema", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["schema_version"] == SCHEMA_VERSION
    assert "employees" in body["tables"]
    assert "loans" in body["tables"]
    assert "locked_users" in body["whitelist_repairs"]
    assert "loan-outstanding" in body["report_datasets"]
    assert "pii_columns" in body
    assert body["tables"]["employees"]["soft_delete"] is True


def test_qa_agent_intent_api_outcomes(client: TestClient, admin_headers: dict[str, str]) -> None:
    cases = [
        ("Fix everything", "unsafe_bulk_fix", "manual_review", None),
        ("Run diagnostics", "diagnose", "ok", None),
        ("Draft a report on loans", "draft_report", "ok", "report_designer_payload"),
        ("Show schema", "schema", "ok", None),
        ("Forecast budget spend", "forecast", "ok", "forecast"),
        ("Find ticket anomalies", "anomaly", "ok", "anomalies"),
        ("Show learning stats", "learning", "ok", "learning"),
    ]
    for message, intent, outcome, payload_key in cases:
        resp = client.post(
            "/v1/ai/agent/chat",
            headers=admin_headers,
            json={"message": message},
        )
        assert resp.status_code == 200, f"{message}: {resp.text}"
        body = resp.json()
        assert body["intent"] == intent, message
        assert body["outcome"] == outcome, message
        assert "confidence_score" in body
        assert "tools_used" in body
        assert "schema_version" in body
        if payload_key:
            assert body.get(payload_key) is not None, f"{message} missing {payload_key}"
        if intent == "draft_report":
            assert body["report_designer_payload"]["dataset"] == "loan-outstanding"
            assert "SELECT" in body["report_designer_payload"]["sql_source"].upper()
            assert body["report_designer_payload"]["columns"]


def test_qa_diagnose_findings_shape(client: TestClient, admin_headers: dict[str, str]) -> None:
    resp = client.post(
        "/v1/ai/agent/chat",
        headers=admin_headers,
        json={"message": "Run diagnostics and health scan"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["intent"] == "diagnose"
    assert isinstance(body.get("findings"), list)
    for finding in body["findings"]:
        assert "check_code" in finding
        assert "severity" in finding
        assert "summary" in finding
        assert "confidence" in finding


def _lock_user(client: TestClient) -> None:
    factory = client.app.state.session_factory
    with factory() as session:
        user = session.scalar(select(UserRow).where(UserRow.username == "admin"))
        assert user is not None
        user.locked_until = datetime.now(UTC) + timedelta(hours=1)
        user.failed_login_count = 5
        session.commit()


def test_qa_repair_preview_apply_lifecycle(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    off = client.post(
        "/v1/ai/agent/chat",
        headers=auth_headers,
        json={"message": "Fix locked users", "auto_repair_mode": False},
    )
    assert off.status_code == 200
    assert off.json()["outcome"] == "manual_review"
    assert off.json().get("repair_preview") is None

    _lock_user(client)

    preview = client.post(
        "/v1/ai/agent/chat",
        headers=auth_headers,
        json={"message": "Fix locked users", "auto_repair_mode": True},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["intent"] == "repair_preview"
    assert body["outcome"] == "awaiting_confirm"
    assert body["repair_preview"] is not None
    token = body["repair_preview"]["apply_token"]
    assert len(token) >= 16
    assert body["repair_preview"]["check_code"] == "locked_users"
    assert body["repair_preview"]["before_count"] >= 1

    blocked = client.post(
        "/v1/ai/agent/repair/apply",
        headers=auth_headers,
        json={"apply_token": token, "confirm": "APPLY", "auto_repair_mode": False},
    )
    assert blocked.status_code >= 400

    applied = client.post(
        "/v1/ai/agent/chat",
        headers=auth_headers,
        json={
            "message": "confirm locked_users",
            "auto_repair_mode": True,
            "apply_token": token,
            "confirm": "APPLY",
        },
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["outcome"] == "ok"
    assert applied.json()["intent"] == "apply_repair"
    assert applied.json()["remediation"]["check_code"] == "locked_users"
    assert applied.json()["remediation"]["fixed"] >= 1

    reuse = client.post(
        "/v1/ai/agent/chat",
        headers=auth_headers,
        json={
            "message": "confirm again",
            "auto_repair_mode": True,
            "apply_token": token,
            "confirm": "APPLY",
        },
    )
    assert reuse.status_code == 200
    assert reuse.json()["outcome"] == "error"

    preview2 = client.post(
        "/v1/ai/agent/chat",
        headers=auth_headers,
        json={"message": "Fix locked users", "auto_repair_mode": True},
    )
    assert preview2.json().get("repair_preview") is not None
    token2 = preview2.json()["repair_preview"]["apply_token"]
    bad = client.post(
        "/v1/ai/agent/chat",
        headers=auth_headers,
        json={
            "message": "confirm",
            "auto_repair_mode": True,
            "apply_token": token2,
            "confirm": "YES",
        },
    )
    assert bad.status_code == 200
    assert bad.json()["outcome"] == "error"


def test_qa_non_whitelist_repair_stays_manual(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    assert "duplicate_employee_codes" not in WHITELIST_REPAIRS
    resp = client.post(
        "/v1/ai/agent/chat",
        headers=admin_headers,
        json={"message": "Fix duplicate employee codes", "auto_repair_mode": True},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["outcome"] in {"ok", "manual_review", "awaiting_confirm", "needs_clarification"}
    if body.get("repair_preview"):
        assert body["repair_preview"]["check_code"] in WHITELIST_REPAIRS


def test_qa_agent_writes_audit_log(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    marker = f"QA-AUDIT-{uuid4().hex[:8]}"
    resp = client.post(
        "/v1/ai/agent/chat",
        headers=auth_headers,
        json={"message": f"Run diagnostics {marker}"},
    )
    assert resp.status_code == 200
    factory = client.app.state.session_factory
    with factory() as session:
        rows = session.scalars(
            select(AiAgentAuditRow).where(AiAgentAuditRow.prompt.contains(marker))
        ).all()
        assert len(rows) >= 1
        assert rows[0].intent == "diagnose"
        assert rows[0].schema_version == SCHEMA_VERSION


def test_qa_report_datasets_cover_ui_catalog(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    prompts = {
        "Draft a report on employees": "employee-master",
        "Draft a report on opening balances": "opening-balances",
        "Draft a report on tickets": "ticket-register",
        "Draft a report on excess recovery": "excess-recovery",
        "Draft a report on entitlements": "entitlements",
    }
    for message, dataset in prompts.items():
        resp = client.post(
            "/v1/ai/agent/chat",
            headers=admin_headers,
            json={"message": message},
        )
        assert resp.status_code == 200, message
        payload = resp.json()["report_designer_payload"]
        assert payload["dataset"] == dataset, message
        assert payload["sql_source"]
        assert payload["columns"]
