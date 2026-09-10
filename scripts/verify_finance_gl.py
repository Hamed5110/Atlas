"""Verify Finance GL: unit tests + in-process API (MSSQL) + optional live :3389.

Usage:
  python scripts/verify_finance_gl.py
  python scripts/verify_finance_gl.py --live   # also hit running uvicorn
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


def _http(base: str, method: str, path: str, token: str | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        f"{base}{path}", data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"detail": raw}
        return exc.code, payload


def _run_unit() -> tuple[bool, str]:
    unit = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/unit/test_finance_ledger.py", "-q", "--tb=line"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    tail = (unit.stdout or unit.stderr or "").strip().splitlines()
    detail = tail[-1] if tail else f"exit={unit.returncode}"
    return unit.returncode == 0, detail


def _run_inprocess() -> list[tuple[str, bool, str]]:
    """Exercise finance routes against the configured MSSQL database (no uvicorn)."""
    from fastapi.testclient import TestClient

    from airfare_management.api.main import create_app
    from airfare_management.config import get_settings

    get_settings.cache_clear()
    settings = get_settings()
    app = create_app(settings)
    checks: list[tuple[str, bool, str]] = []

    with TestClient(app) as client:
        openapi = client.get("/openapi.json")
        paths = openapi.json().get("paths") or {}
        has_routes = all(
            p in paths
            for p in (
                "/v1/finance/status",
                "/v1/finance/seed",
                "/v1/finance/accounts",
                "/v1/finance/trial-balance",
                "/v1/finance/ledger-report",
            )
        )
        checks.append(("openapi_finance_paths", has_routes, f"n_paths={len(paths)}"))

        login = client.post(
            "/v1/auth/login",
            json={
                "username": settings.bootstrap_admin_username,
                "password": settings.bootstrap_admin_password,
            },
        )
        if login.status_code != 200:
            checks.append(("inprocess_login", False, f"{login.status_code} {login.text[:120]}"))
            return checks
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        checks.append(("inprocess_login", True, "ok"))

        st = client.get("/v1/finance/status", headers=headers)
        body = st.json() if st.headers.get("content-type", "").startswith("application/json") else {}
        ready = st.status_code == 200 and bool(body.get("ready"))
        checks.append(("inprocess_status", ready, f"{st.status_code} {body}"))

        seed = client.post("/v1/finance/seed", headers=headers, json={})
        sbody = seed.json() if seed.status_code == 200 else {"detail": seed.text[:200]}
        seeded = seed.status_code == 200 and int(sbody.get("count") or 0) >= 6
        checks.append(("inprocess_seed", seeded, f"{seed.status_code} count={sbody.get('count')}"))

        accounts = client.get("/v1/finance/accounts", headers=headers)
        alist = accounts.json() if accounts.status_code == 200 else []
        checks.append(
            (
                "inprocess_accounts",
                accounts.status_code == 200 and len(alist) >= 6,
                f"{accounts.status_code} n={len(alist) if isinstance(alist, list) else 0}",
            )
        )

        tb = client.get("/v1/finance/trial-balance", headers=headers)
        tbody = tb.json() if tb.status_code == 200 else {}
        ok_tb = (
            tb.status_code == 200
            and tbody.get("balanced") is True
            and tbody.get("currency") == "BHD"
        )
        checks.append(
            (
                "inprocess_trial_balance",
                ok_tb,
                f"{tb.status_code} balanced={tbody.get('balanced')} "
                f"dr={tbody.get('total_debit')} cr={tbody.get('total_credit')}",
            )
        )

        lg = client.get(
            "/v1/finance/ledger-report",
            headers=headers,
            params={"account_code": "1200", "limit": 50},
        )
        lbody = lg.json() if lg.status_code == 200 else {}
        ok_lg = lg.status_code == 200 and "entries" in lbody and "accounts" in lbody
        checks.append(
            (
                "inprocess_ledger_report",
                ok_lg,
                f"{lg.status_code} entries={len(lbody.get('entries') or [])} "
                f"filter={lbody.get('filter_account')}",
            )
        )

        # Print human-readable sample for support
        print("\n--- Sample trial balance (top accounts) ---")
        for row in (tbody.get("accounts") or [])[:8]:
            print(
                f"  {row.get('code')} {row.get('name')}: "
                f"Dr {row.get('debit')} Cr {row.get('credit')} Net {row.get('net')}"
            )
        print("--- Sample ledger entries (1200), up to 5 ---")
        for entry in (lbody.get("entries") or [])[:5]:
            print(
                f"  {entry.get('entry_date')} {entry.get('source_type')} "
                f"Dr {entry.get('debit')} Cr {entry.get('credit')} | {entry.get('narration')}"
            )

    return checks


def _run_live() -> list[tuple[str, bool, str]]:
    base = "http://127.0.0.1:3389"
    checks: list[tuple[str, bool, str]] = []
    st, health = _http(base, "GET", "/health")
    if st != 200:
        checks.append(("live_health", False, f"{st} {health}"))
        return checks
    checks.append(("live_health", True, str(health)))

    from airfare_management.config import get_settings

    get_settings.cache_clear()
    settings = get_settings()
    st, login = _http(
        base,
        "POST",
        "/v1/auth/login",
        body={
            "username": settings.bootstrap_admin_username,
            "password": settings.bootstrap_admin_password,
        },
    )
    if st != 200 or "access_token" not in login:
        checks.append(("live_login", False, f"{st} {login}"))
        return checks
    token = login["access_token"]
    checks.append(("live_login", True, "ok"))

    st, body = _http(base, "GET", "/v1/finance/status", token=token)
    checks.append(("live_status", st == 200 and bool(body.get("ready")), f"{st} {body}"))

    st, body = _http(base, "POST", "/v1/finance/seed", token=token, body={})
    checks.append(
        ("live_seed", st == 200 and int(body.get("count") or 0) >= 6, f"{st} count={body.get('count')}")
    )

    st, accounts = _http(base, "GET", "/v1/finance/accounts", token=token)
    n = len(accounts) if isinstance(accounts, list) else 0
    checks.append(("live_accounts", st == 200 and n >= 6, f"{st} n={n}"))

    st, tb = _http(base, "GET", "/v1/finance/trial-balance", token=token)
    checks.append(
        (
            "live_trial_balance",
            st == 200 and tb.get("balanced") is True,
            f"{st} balanced={tb.get('balanced')}",
        )
    )

    st, report = _http(
        base, "GET", "/v1/finance/ledger-report?account_code=1200&limit=50", token=token
    )
    checks.append(
        (
            "live_ledger_report",
            st == 200 and "entries" in report,
            f"{st} entries={len(report.get('entries') or [])}",
        )
    )
    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify ATLAS Finance GL")
    parser.add_argument(
        "--live",
        action="store_true",
        help="Also call the running API on :3389 (restart API first if routes 404)",
    )
    args = parser.parse_args()

    results: list[tuple[str, bool, str]] = []

    ok, detail = _run_unit()
    results.append(("unit_tests", ok, detail))
    print("UNIT", detail)

    print("\n=== In-process API (MSSQL) ===")
    results.extend(_run_inprocess())

    if args.live:
        print("\n=== Live :3389 ===")
        results.extend(_run_live())

    print("\n=== VERIFY SUMMARY ===")
    failed = 0
    for name, passed, detail in results:
        mark = "PASS" if passed else "FAIL"
        if not passed:
            failed += 1
        print(f"{mark} {name}: {detail[:220]}")
    if failed and not args.live:
        print(
            "\nNote: If you need live :3389 checks, restart the API "
            "(start-service.ps1 sets PYTHONPATH=src) then re-run with --live."
        )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
