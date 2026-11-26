"""Unit tests for security helpers and preference layering."""

from uuid import uuid4

import pytest

from airfare_management.config import Settings
from airfare_management.domain.models import DomainError
from airfare_management.infrastructure.security import (
    decode_access_token,
    hash_password,
    issue_access_token,
    require_roles,
    verify_password,
)


def test_password_hash_round_trip() -> None:
    """Bcrypt hashes verify and reject weak passwords."""
    encoded = hash_password("CorrectHorseBattery")
    assert verify_password("CorrectHorseBattery", encoded)
    assert not verify_password("WrongPassword!!!!!", encoded)
    with pytest.raises(DomainError, match="12 characters"):
        hash_password("short")


def test_jwt_roles_and_issuer_validation() -> None:
    """Access tokens carry roles and reject unauthorized callers."""
    settings = Settings(jwt_secret="x" * 32, jwt_issuer="airfare-tests")
    token = issue_access_token(uuid4(), {"hr"}, settings)
    claims = decode_access_token(token, settings)
    require_roles(claims, {"hr", "admin"})
    with pytest.raises(DomainError, match="permission"):
        require_roles(claims, {"admin"})
