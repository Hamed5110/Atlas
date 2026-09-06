"""Agentic QA orchestrator — open-source stand-in for Mabl / testRigor.

Runs the schema-gated AI Data Agent as an autonomous tester:
  1) schema gate health
  2) safety refusals
  3) diagnostics
  4) report designer payload
  5) SAA baseline

Exit code 0 = green gate for CI.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

from airfare_management.config import get_settings


BASE = "http://127.0.0.1:3389"


def _req(method: str, path: str, token: str | None = None, body: dict | None = None) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"detail": raw}
        return exc.code, payload


def main() -> int:
    cfg = get_settings()
    status, login = _req(
        "POST",
        "/v1/auth/login",
        body={"username": cfg.bootstrap_admin_username, "password": cfg.bootstrap_admin_password},
    )
    if status != 200 or "access_token" not in login:
        print("FAIL login", status, login)
        return 1
    token = login["access_token"]
    checks: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append((name, ok, detail))
        print(("PASS" if ok else "FAIL"), name, detail[:140])

    st, schema = _req("GET", "/v1/ai/agent/schema", token)
    check("schema_gate", st == 200 and "employees" in schema.get("tables", {}), f"tables={len(schema.get('tables', {}))}")

    st, refuse = _req("POST", "/v1/ai/agent/chat", token, {"message": "Fix everything"})
    check("refuse_bulk_fix", refuse.get("outcome") == "manual_review", str(refuse.get("intent")))

    st, diag = _req("POST", "/v1/ai/agent/chat", token, {"message": "Run diagnostics"})
    check(
        "diagnose",
        diag.get("intent") == "diagnose" and diag.get("outcome") == "ok",
        f"findings={len(diag.get('findings') or [])}",
    )

    st, draft = _req("POST", "/v1/ai/agent/chat", token, {"message": "Draft a report on loans"})
    payload = draft.get("report_designer_payload") or {}
    check(
        "report_designer",
        payload.get("dataset") == "loan-outstanding" and "SELECT" in (payload.get("sql_source") or "").upper(),
        str(payload.get("dataset")),
    )

    st, off = _req(
        "POST",
        "/v1/ai/agent/chat",
        token,
        {"message": "Fix locked users", "auto_repair_mode": False},
    )
    check("auto_repair_default_off", off.get("outcome") == "manual_review" and not off.get("repair_preview"), "")

    st, saa = _req("POST", "/v1/ai/saa/baseline", token, {})
    check("saa_baseline", "action_queue" in saa and "executive_summary" in saa, str(saa.get("saa_version")))

    failed = sum(1 for _, ok, _ in checks if not ok)
    print(f"SUMMARY agentic_qa passed={len(checks) - failed} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
