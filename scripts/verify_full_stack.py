"""Full live verification for HCM Airfare API + local AI learning."""

from __future__ import annotations

import json
import socket
import time
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:3389"
ROOT = Path(__file__).resolve().parents[1]


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def rec(results: list[dict], name: str, ok: bool, detail: object = "") -> None:
    text = str(detail)[:240]
    results.append({"name": name, "ok": bool(ok), "detail": text})
    print(("PASS" if ok else "FAIL"), name, text[:180])


def req(
    method: str,
    path: str,
    data: dict | None = None,
    token: str | None = None,
    timeout: float = 120,
) -> tuple[int, dict | list]:
    body = None if data is None else json.dumps(data).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as resp:
        raw = resp.read().decode()
        return resp.status, (json.loads(raw) if raw else {})


def tcp_ok(host: str, port: int) -> bool:
    sock = socket.socket()
    sock.settimeout(2)
    try:
        sock.connect((host, port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def main() -> int:
    env = load_env()
    user = env.get("AIRFARE_BOOTSTRAP_ADMIN_USERNAME", "admin")
    password = env.get("AIRFARE_BOOTSTRAP_ADMIN_PASSWORD", "")
    results: list[dict] = []

    try:
        status, health = req("GET", "/health")
        rec(results, "health", status == 200 and health.get("status") == "ok", health)
    except Exception as exc:  # noqa: BLE001
        rec(results, "health", False, exc)

    try:
        status, _ = req("GET", "/health/live")
        rec(results, "health_live", status == 200)
    except Exception as exc:  # noqa: BLE001
        rec(results, "health_live", False, exc)

    token = None
    try:
        status, login = req("POST", "/v1/auth/login", {"username": user, "password": password})
        token = login.get("access_token")
        rec(results, "auth_login", bool(token), f"token_len={len(token or '')}")
    except Exception as exc:  # noqa: BLE001
        rec(results, "auth_login", False, exc)

    if not token:
        (ROOT / ".tmp_verify_full.json").write_text(
            json.dumps({"passed": 0, "total": len(results), "results": results}, indent=2),
            encoding="utf-8",
        )
        return 2

    try:
        status, llm = req("GET", "/v1/ai/llm/status", token=token)
        rec(
            results,
            "llm_status",
            status == 200 and llm.get("ollama", {}).get("online") is True,
            f"active={llm.get('active_provider')} model={llm.get('ollama', {}).get('model')}",
        )
    except Exception as exc:  # noqa: BLE001
        rec(results, "llm_status", False, exc)

    try:
        status, schema = req("GET", "/v1/ai/agent/schema", token=token)
        rec(results, "agent_schema", status == 200, f"keys={list(schema.keys())[:6]}")
    except Exception as exc:  # noqa: BLE001
        rec(results, "agent_schema", False, exc)

    try:
        status, chat = req(
            "POST",
            "/v1/ai/agent/chat",
            {"message": "What can you do? capabilities"},
            token=token,
        )
        rec(
            results,
            "agent_capabilities",
            status == 200 and chat.get("outcome") == "ok",
            f"intent={chat.get('intent')} tools={chat.get('tools_used')}",
        )
    except Exception as exc:  # noqa: BLE001
        rec(results, "agent_capabilities", False, exc)

    try:
        status, learn = req("GET", "/v1/ai/support/learning", token=token)
        rec(
            results,
            "support_learning",
            status == 200,
            f"total={learn.get('total_events')} by_type={learn.get('by_type')}",
        )
    except Exception as exc:  # noqa: BLE001
        rec(results, "support_learning", False, exc)

    try:
        status, diag = req("GET", "/v1/ai/support/diagnose", token=token)
        rec(
            results,
            "support_diagnose",
            status == 200,
            f"keys={list(diag.keys())[:8]} healthy={diag.get('healthy')}",
        )
    except Exception as exc:  # noqa: BLE001
        rec(results, "support_diagnose", False, exc)

    try:
        started = time.time()
        status, chat = req(
            "POST",
            "/v1/ai/agent/chat",
            {"message": "Run diagnostics and summarize database health"},
            token=token,
            timeout=180,
        )
        latency_ms = int((time.time() - started) * 1000)
        used_ollama = "ollama" in (chat.get("tools_used") or [])
        rec(
            results,
            "agent_diagnose_ollama",
            status == 200 and chat.get("intent") == "diagnose",
            f"tools={chat.get('tools_used')} ollama={used_ollama} latency_ms={latency_ms}",
        )
    except Exception as exc:  # noqa: BLE001
        rec(results, "agent_diagnose_ollama", False, exc)

    try:
        status, chat = req(
            "POST",
            "/v1/ai/agent/chat",
            {"message": "Show AI learning stats and training memory"},
            token=token,
        )
        rec(
            results,
            "agent_learning",
            status == 200,
            f"intent={chat.get('intent')} outcome={chat.get('outcome')}",
        )
    except Exception as exc:  # noqa: BLE001
        rec(results, "agent_learning", False, exc)

    try:
        status, chat = req(
            "POST",
            "/v1/ai/agent/chat",
            {"message": "machine learning anomalies"},
            token=token,
            timeout=120,
        )
        rec(
            results,
            "agent_ml",
            status == 200,
            f"intent={chat.get('intent')} tools={chat.get('tools_used')}",
        )
    except Exception as exc:  # noqa: BLE001
        rec(results, "agent_ml", False, exc)

    try:
        status, saa = req("POST", "/v1/ai/saa/baseline", token=token, timeout=180)
        rec(results, "saa_baseline", status == 200, f"keys={list(saa.keys())[:10]}")
    except Exception as exc:  # noqa: BLE001
        rec(results, "saa_baseline", False, exc)

    try:
        status, feedback = req(
            "POST",
            "/v1/ai/support/feedback",
            {
                "check_code": "smoke_verify_2026",
                "worked": True,
                "notes": "Automated verification training signal",
            },
            token=token,
        )
        rec(
            results,
            "support_feedback_train",
            status == 200 and feedback.get("recorded") is True,
            feedback,
        )
    except Exception as exc:  # noqa: BLE001
        rec(results, "support_feedback_train", False, exc)

    try:
        status, train = req("POST", "/v1/ai/support/train", token=token, timeout=60)
        rec(
            results,
            "support_train",
            status == 200 and train.get("trained") is True,
            f"upserts={train.get('product_knowledge_upserts')} total={((train.get('learning') or {}).get('total_events'))}",
        )
    except Exception as exc:  # noqa: BLE001
        rec(results, "support_train", False, exc)

    try:
        status, learn = req("GET", "/v1/ai/support/learning", token=token)
        rec(
            results,
            "learning_after_feedback",
            status == 200 and (learn.get("total_events") or 0) >= 1,
            f"total={learn.get('total_events')}",
        )
    except Exception as exc:  # noqa: BLE001
        rec(results, "learning_after_feedback", False, exc)

    try:
        status, report = req(
            "GET",
            "/v1/reports/data/airfare-payable?year=2026",
            token=token,
            timeout=120,
        )
        row_count = None
        if isinstance(report, dict):
            rows = report.get("rows") or report.get("data") or report.get("items")
            row_count = len(rows) if isinstance(rows, list) else report.get("row_count")
        rec(results, "report_payable_data", status == 200, f"row_count={row_count}")
    except Exception as exc:  # noqa: BLE001
        rec(results, "report_payable_data", False, exc)

    try:
        status, employees = req("GET", "/v1/employees?limit=5", token=token)
        if isinstance(employees, list):
            count = len(employees)
        else:
            count = len(employees.get("items") or employees.get("data") or [])
        rec(results, "employees_list", status == 200, f"n={count}")
    except Exception as exc:  # noqa: BLE001
        rec(results, "employees_list", False, exc)

    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=5) as resp:
            tags = json.loads(resp.read().decode())
        names = [model.get("name") for model in tags.get("models") or []]
        rec(
            results,
            "ollama_tags",
            any("deepseek" in (name or "") for name in names),
            names,
        )
    except Exception as exc:  # noqa: BLE001
        rec(results, "ollama_tags", False, exc)

    rec(results, "redis_tcp", tcp_ok("127.0.0.1", 6379))
    rec(results, "mssql_tcp", tcp_ok("127.0.0.1", 1433))

    passed = sum(1 for item in results if item["ok"])
    failed = [item for item in results if not item["ok"]]
    print("---")
    print(f"SUMMARY {passed}/{len(results)} PASS")
    for item in failed:
        print(" -", item["name"], item["detail"])

    (ROOT / ".tmp_verify_full.json").write_text(
        json.dumps({"passed": passed, "total": len(results), "results": results}, indent=2),
        encoding="utf-8",
    )
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
