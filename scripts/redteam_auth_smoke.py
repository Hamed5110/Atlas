"""Red-team authenticated smoke — no secrets printed."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(r"C:\HCM Airfare")
BASE = "http://127.0.0.1:3389"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def req(method: str, path: str, data: dict | None = None, token: str | None = None):
    body = None if data is None else json.dumps(data).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            payload = json.loads(raw) if raw else {}
        except Exception:  # noqa: BLE001
            payload = {"raw": raw[:200]}
        return exc.code, payload


def main() -> int:
    env = load_env()
    status, login = req(
        "POST",
        "/v1/auth/login",
        {
            "username": env.get("AIRFARE_BOOTSTRAP_ADMIN_USERNAME", "admin"),
            "password": env["AIRFARE_BOOTSTRAP_ADMIN_PASSWORD"],
        },
    )
    token = login.get("access_token")
    print("login", status, bool(token))
    if not token:
        return 2

    status, wa = req("GET", "/v1/admin/wa/status", token=token)
    print(
        "wa_status",
        status,
        "enabled=",
        wa.get("enabled"),
        "configured=",
        wa.get("configured"),
        "reachable=",
        wa.get("reachable"),
        "has_reach_error=",
        bool(wa.get("reach_error")),
    )

    status, inst = req("GET", "/v1/admin/wa/instances", token=token)
    rows = inst.get("instances") if isinstance(inst, dict) else None
    print(
        "wa_instances",
        status,
        "n=",
        len(rows or []),
        "evo_err=",
        bool(inst.get("evolution_error")) if isinstance(inst, dict) else None,
    )

    status, emps = req("GET", "/v1/employees?limit=5", token=token)
    print("employees", status, "n=", len(emps) if isinstance(emps, list) else type(emps).__name__)
    emp = emps[0] if isinstance(emps, list) and emps else None
    if not emp:
        print("NO_EMPLOYEE")
        return 3

    status, one = req("GET", f"/v1/employees/{emp['id']}", token=token)
    print("employee_reload", status, "has_code=", bool(one.get("code")))

    status, prev = req(
        "POST",
        "/v1/allocations/preview",
        {
            "employee_id": emp["id"],
            "as_of_date": str(date.today()),
            "requested_ticket_amount": 300,
        },
        token=token,
    )
    print(
        "alloc_preview",
        status,
        "has_entitlement=",
        "final_entitlement_amount" in (prev or {}),
    )

    status, bad = req(
        "POST",
        "/v1/allocations/issue",
        {
            "employee_id": emp["id"],
            "as_of_date": str(date.today()),
            "requested_ticket_amount": "99999",
            "excess_option": "CONVERT_TO_LOAN",
            "tenure_months": 12,
            "origin_code": "DEL",
            "destination_code": "BLR",
            "notes": "redteam-no-approval",
            "manager_approval": "",
        },
        token=token,
    )
    detail = str(bad)[:200]
    gate_ok = status in (400, 409, 422) or "manager_approval" in detail.lower() or "approval" in detail.lower()
    print("issue_loan_no_approval", status, "gate_ok=", gate_ok)
    print("DONE")
    return 0 if status != 201 else 4


if __name__ == "__main__":
    raise SystemExit(main())
