"""Shared pytest fixtures for unit and integration tests."""

from __future__ import annotations

from collections.abc import Generator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from airfare_management.api.main import DEFAULT_COMPANY_ID, create_app
from airfare_management.config import Settings
from airfare_management.infrastructure.security import issue_access_token


@pytest.fixture
def settings() -> Settings:
    """Isolated in-memory test settings."""
    return Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="t" * 32,
        bootstrap_admin_password="StrongPassword!2026",
        attachment_root="./var/test-pyramid-attachments",
    )


@pytest.fixture
def client(settings: Settings) -> Generator[TestClient, None, None]:
    """FastAPI test client backed by SQLite in memory."""
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def auth_headers(client: TestClient) -> dict[str, str]:
    """Bearer token from the bootstrap admin login flow."""
    response = client.post(
        "/v1/auth/login",
        json={"username": "admin", "password": "StrongPassword!2026"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def admin_headers(settings: Settings) -> dict[str, str]:
    """Pre-issued admin token without exercising login."""
    token = issue_access_token(uuid4(), {"admin", "hr", "manager", "finance"}, settings)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def client_and_headers(
    client: TestClient, admin_headers: dict[str, str]
) -> tuple[TestClient, dict[str, str]]:
    """Pair client with admin authorization headers."""
    return client, admin_headers
