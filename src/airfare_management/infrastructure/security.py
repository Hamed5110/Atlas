"""Password hashing, JWT authentication, and role authorization."""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import bcrypt
import jwt

from airfare_management.config import Settings
from airfare_management.domain.models import DomainError


def hash_password(password: str) -> str:
    """Hash a password using bcrypt's adaptive work factor.

    Args:
        password: Plaintext password received over a protected channel.

    Returns:
        Encoded bcrypt hash.
    """
    if len(password) < 12:
        raise DomainError("weak_password", "Password must contain at least 12 characters.")
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, encoded_hash: str) -> bool:
    """Verify a password without exposing hash details.

    Args:
        password: Candidate plaintext.
        encoded_hash: Stored bcrypt hash.

    Returns:
        Whether the password matches.
    """
    return bcrypt.checkpw(password.encode(), encoded_hash.encode())


def issue_access_token(
    subject: UUID,
    roles: set[str],
    settings: Settings,
    now: datetime | None = None,
    *,
    username: str | None = None,
    session_id: str | None = None,
) -> str:
    """Issue a short-lived signed access token.

    Args:
        subject: User identifier.
        roles: Granted RBAC roles.
        settings: JWT configuration.
        now: Injectable UTC clock value.
        username: Optional username copied into claims.
        session_id: Refresh-token session family identifier.

    Returns:
        Encoded JWT.
    """
    issued = now or datetime.now(UTC)
    claims: dict[str, Any] = {
        "sub": str(subject),
        "roles": sorted(roles),
        "iss": settings.jwt_issuer,
        "iat": issued,
        "exp": issued + timedelta(minutes=settings.access_token_minutes),
        "jti": secrets.token_hex(16),
        "token_type": "access",
    }
    if username is not None:
        claims["username"] = username
    if session_id is not None:
        claims["session_id"] = session_id
    return jwt.encode(claims, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str, settings: Settings) -> dict[str, Any]:
    """Validate and decode an access token.

    Args:
        token: Encoded JWT.
        settings: JWT configuration.

    Returns:
        Validated claims.

    Raises:
        DomainError: If validation fails.
    """
    try:
        return dict(
            jwt.decode(
                token,
                settings.jwt_secret,
                algorithms=["HS256"],
                issuer=settings.jwt_issuer,
                options={"require": ["sub", "exp", "iat", "iss", "jti", "token_type"]},
            )
        )
    except jwt.PyJWTError as exc:
        raise DomainError("invalid_token", "The access token is invalid or expired.") from exc


def require_roles(claims: dict[str, Any], allowed: set[str]) -> None:
    """Enforce role membership.

    Args:
        claims: Validated token claims.
        allowed: Roles accepted by the operation.

    Raises:
        DomainError: If no allowed role is present.
    """
    if not set(claims.get("roles", ())).intersection(allowed):
        raise DomainError("forbidden", "You do not have permission for this operation.")


@dataclass(frozen=True, slots=True)
class RefreshToken:
    """Opaque refresh-token value and its non-reversible database digest."""

    value: str
    digest: str


def create_refresh_token() -> RefreshToken:
    """Create a cryptographically random opaque refresh token."""
    value = secrets.token_urlsafe(48)
    return RefreshToken(value=value, digest=hash_refresh_token(value))


def hash_refresh_token(value: str) -> str:
    """Return the SHA-256 digest used for refresh-token lookup."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
