from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("PORT", "3388")
os.environ.setdefault("ATLAS_PYTHON_PORT", "3388")
os.environ.setdefault("ATLAS_PYTHON_DB_NAME", "AtlasPythonCore3388")

from app.main import create_app  # noqa: E402
import app.server as production_server  # noqa: E402


def test_http_contract_is_port_3388_only() -> None:
    assert production_server.PORT == 3388
    routes = {route.path for route in create_app().routes}
    assert "/api/v1/health" in routes
    assert "/api/v1/employees" in routes
    assert "/api/v1/import/verify-preview" in routes
    assert "/api/v1/import/commit" in routes
    assert "/api/v1/airfare/entitlement/{emp_id}" in routes
    assert "/api/v1/airfare/claims" in routes


def test_openapi_has_split_operational_routers() -> None:
    schema = create_app().openapi()
    tags = {tag for path in schema["paths"].values() for method in path.values() for tag in method.get("tags", [])}
    assert "Employee Master" in tags
    assert "Employee Import" in tags
    assert "Continuous Entitlement and Operations" in tags
