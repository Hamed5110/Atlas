"""Shared FastAPI dependency helpers."""

from collections.abc import Callable, Generator
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

from airfare_management.config import Settings
from airfare_management.domain.models import DomainError
from airfare_management.infrastructure.database import actor_context, session_context
from airfare_management.infrastructure.security import decode_access_token, require_roles


class Claims(BaseModel):
    """Validated access-token claims."""

    subject: UUID
    roles: set[str]
    username: str | None = None


def build_database(sessions: object) -> Callable[[], Generator[Session, None, None]]:
    """Return a request-scoped SQLAlchemy session dependency."""

    def database() -> Generator[Session, None, None]:
        with sessions() as session:  # type: ignore[operator]
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise

    return database


def build_authenticated(config: Settings) -> Callable[..., Claims]:
    """Return a Bearer-token authentication dependency."""

    def authenticated(authorization: Annotated[str | None, Header()] = None) -> Claims:
        if not authorization or not authorization.startswith("Bearer "):
            raise DomainError("invalid_token", "A Bearer access token is required.")
        payload = decode_access_token(authorization[7:], config)
        try:
            subject = UUID(payload["sub"])
        except (KeyError, TypeError, ValueError) as exc:
            raise DomainError("invalid_token", "Access token subject is invalid.") from exc
        claims = Claims(
            subject=subject,
            roles=set(payload.get("roles", ())),
            username=payload.get("username"),
        )
        actor_context.set(str(claims.subject))
        session_context.set(payload.get("session_id"))
        return claims

    return authenticated


def build_authorized(
    authenticated: Callable[..., Claims],
) -> Callable[..., Callable[[Claims], Claims]]:
    """Return a role-checking dependency factory."""

    def authorized(*roles: str) -> Callable[[Claims], Claims]:
        def dependency(claims: Annotated[Claims, Depends(authenticated)]) -> Claims:
            aliases = {
                "admin": "SYSTEM_ADMIN",
                "hr": "HR_MANAGER",
                "manager": "HR_MANAGER",
                "finance": "FINANCE_MANAGER",
                "auditor": "FINANCE_MANAGER",
            }
            allowed = set(roles) | {aliases[role] for role in roles if role in aliases}
            require_roles(claims.model_dump(), allowed)
            return claims

        return dependency

    return authorized
