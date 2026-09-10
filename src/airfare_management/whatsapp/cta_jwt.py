"""CTA portal JWT — RS256/ES256 preferred; HS256 fallback only in development."""

from __future__ import annotations

import secrets
import time
import uuid
from typing import Any

import jwt

from airfare_management.config import Settings


class CtaJwtError(Exception):
    pass


_USED_JTI: dict[str, float] = {}


def _purge_jti(now: float) -> None:
    expired = [k for k, exp in _USED_JTI.items() if exp < now]
    for k in expired:
        _USED_JTI.pop(k, None)


def mint_cta_token(
    settings: Settings,
    *,
    external_id: str,
    jid: str,
    purpose: str = "download",
) -> str:
    """Mint 15m single-use jti CTA token."""
    now = int(time.time())
    jti = secrets.token_urlsafe(16)
    claims = {
        "iss": settings.jwt_issuer,
        "aud": "wa",
        "sub": external_id,
        "jid": jid,
        "purpose": purpose,
        "jti": jti,
        "iat": now,
        "exp": now + settings.whatsapp_cta_jwt_minutes * 60,
    }
    key, alg = _signing_material(settings)
    return jwt.encode(claims, key, algorithm=alg)


def consume_cta_token(settings: Settings, token: str) -> dict[str, Any]:
    key, alg = _verify_material(settings)
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience="wa",
            issuer=settings.jwt_issuer,
        )
    except jwt.PyJWTError as exc:
        raise CtaJwtError(str(exc)) from exc
    jti = str(claims.get("jti") or "")
    if not jti:
        raise CtaJwtError("missing_jti")
    now = time.time()
    _purge_jti(now)
    if jti in _USED_JTI:
        raise CtaJwtError("jti_replay")
    _USED_JTI[jti] = float(claims.get("exp") or now)
    return claims


def _signing_material(settings: Settings) -> tuple[Any, str]:
    pem = (settings.whatsapp_cta_private_key_pem or "").strip()
    if pem:
        alg = "ES256" if "EC PRIVATE KEY" in pem or "BEGIN EC" in pem else "RS256"
        return pem, alg
    if settings.environment == "production":
        raise CtaJwtError("AIRFARE_WHATSAPP_CTA_PRIVATE_KEY_PEM required in production")
    # Dev fallback — HS256 with jwt_secret (not for production CTAs)
    return settings.jwt_secret, "HS256"


def _verify_material(settings: Settings) -> tuple[Any, str]:
    return _signing_material(settings)


def new_external_id() -> str:
    return str(uuid.uuid4())
