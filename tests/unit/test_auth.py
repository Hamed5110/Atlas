"""Unit and integration tests for authentication and session security."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from airfare_management.config import Settings
from airfare_management.domain.models import DomainError
from airfare_management.infrastructure.security import (
    create_refresh_token,
    decode_access_token,
    hash_password,
    hash_refresh_token,
    issue_access_token,
    verify_password,
)


def test_bcrypt_cost_is_twelve() -> None:
    encoded = hash_password("CorrectHorseBattery")
    assert encoded.startswith("$2b$12$")


def test_jwt_issue_and_decode_round_trip() -> None:
    settings = Settings(jwt_secret="a" * 32, jwt_issuer="airfare-tests")
    subject = uuid4()
    token = issue_access_token(subject, {"admin", "hr"}, settings, username="admin")
    claims = decode_access_token(token, settings)
    assert claims["sub"] == str(subject)
    assert "admin" in claims["roles"]


def test_jwt_tampered_signature_rejected() -> None:
    settings = Settings(jwt_secret="b" * 32, jwt_issuer="airfare-tests")
    token = issue_access_token(uuid4(), {"admin"}, settings)
    parts = token.split(".")
    parts[-1] = "invalidsignature"
    with pytest.raises(DomainError, match="invalid"):
        decode_access_token(".".join(parts), settings)


def test_expired_token_rejected() -> None:
    settings = Settings(jwt_secret="c" * 32, jwt_issuer="airfare-tests", access_token_minutes=5)
    past = datetime.now(UTC) - timedelta(hours=1)
    token = issue_access_token(uuid4(), {"admin"}, settings, now=past)
    with pytest.raises(DomainError, match="invalid"):
        decode_access_token(token, settings)


@pytest.fixture
def auth_client() -> TestClient:
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="d" * 32,
        bootstrap_admin_password="StrongPassword!2026",
    )
    from airfare_management.api.main import create_app

    return TestClient(create_app(settings))


def test_refresh_rotation_and_reuse_revokes_family(auth_client: TestClient) -> None:
    login = auth_client.post(
        "/v1/auth/login",
        json={"username": "admin", "password": "StrongPassword!2026"},
    )
    assert login.status_code == 200
    tokens = login.json()
    rotated = auth_client.post(
        "/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert rotated.status_code == 200
    reused = auth_client.post(
        "/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert reused.status_code == 401
    assert reused.json()["code"] == "token_reuse"


def test_logout_revokes_refresh_token(auth_client: TestClient) -> None:
    login = auth_client.post(
        "/v1/auth/login",
        json={"username": "admin", "password": "StrongPassword!2026"},
    )
    tokens = login.json()
    assert auth_client.post(
        "/v1/auth/logout", json={"refresh_token": tokens["refresh_token"]}
    ).status_code == 204
    refresh = auth_client.post(
        "/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert refresh.status_code == 401


def test_account_lockout_after_failed_attempts(auth_client: TestClient) -> None:
    for _ in range(5):
        auth_client.post(
            "/v1/auth/login",
            json={"username": "admin", "password": "WrongPassword!2026"},
        )
    locked = auth_client.post(
        "/v1/auth/login",
        json={"username": "admin", "password": "StrongPassword!2026"},
    )
    assert locked.status_code == 403
    assert locked.json()["code"] == "account_locked"


def test_password_history_rejects_recent_password(auth_client: TestClient) -> None:
    login = auth_client.post(
        "/v1/auth/login",
        json={"username": "admin", "password": "StrongPassword!2026"},
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    same = auth_client.post(
        "/v1/auth/change-password",
        headers=headers,
        json={
            "current_password": "StrongPassword!2026",
            "new_password": "StrongPassword!2026",
        },
    )
    assert same.status_code == 409
    assert same.json()["code"] == "password_reuse"


def test_refresh_token_hash_is_sha256() -> None:
    opaque = create_refresh_token()
    assert opaque.digest == hash_refresh_token(opaque.value)
    assert len(opaque.digest) == 64
