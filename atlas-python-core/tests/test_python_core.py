from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("ATLAS_PYTHON_PORT", "3367")
os.environ.setdefault("ATLAS_PYTHON_DB_SERVER", "localhost")
os.environ.setdefault("ATLAS_PYTHON_DB_PORT", "1433")
os.environ.setdefault("ATLAS_PYTHON_DB_USER", "sa")
os.environ.setdefault("ATLAS_PYTHON_DB_PASSWORD", "Atlas@25")
os.environ.setdefault("ATLAS_PYTHON_DB_NAME", "AtlasPythonCoreTest")

from app import config, db  # noqa: E402


def test_database_repository_contract() -> None:
    proof = db.initialize()
    assert proof["databaseName"] == config.DB_NAME
    assert proof["objects"]["employees"] is True
    assert proof["objects"]["entitlementEvents"] is True
    assert proof["objects"]["airfareAllocations"] is True

    summary = db.summary("2026-12-31")
    assert summary["repository"] == "mssql-python-core"
    assert summary["employees"]["active"] >= 1
    assert summary["entitlement"]["balance"] >= 0

    employees = db.list_employees()
    assert any(row["employeeNumber"] == "5110" for row in employees)

    balances = db.entitlement_balance("2026-12-31")
    assert any(row["employeeNumber"] == "5110" for row in balances)


def test_http_contract() -> None:
    from app.server import Handler
    from http.server import ThreadingHTTPServer

    server = ThreadingHTTPServer(("127.0.0.1", config.PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        wait_for(f"http://127.0.0.1:{config.PORT}/api/health")
        health = get_json(f"http://127.0.0.1:{config.PORT}/api/health")
        assert health["status"] == "ok"
        assert health["repository"] == "mssql-python-core"
        assert health["yearEndProcess"] is False
        assert health["database"]["databaseName"] == config.DB_NAME

        summary = get_json(f"http://127.0.0.1:{config.PORT}/api/summary?asOfDate=2026-12-31")
        assert summary["database"] == config.DB_NAME
        assert summary["repository"] == "mssql-python-core"

        try:
            get_json(f"http://127.0.0.1:{config.PORT}/api/summary")
        except urllib.error.HTTPError as exc:
            assert exc.code == 400
        else:
            raise AssertionError("missing asOfDate must fail with 400")
    finally:
        server.shutdown()
        server.server_close()


def wait_for(url: str) -> None:
    deadline = time.time() + 15
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            get_json(url)
            return
        except Exception as exc:
            last_error = exc
            time.sleep(0.2)
    raise AssertionError(f"server did not become ready: {last_error}")


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))
