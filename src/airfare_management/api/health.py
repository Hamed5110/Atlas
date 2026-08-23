"""Liveness and readiness probes."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

if TYPE_CHECKING:
    from collections.abc import Callable, Generator

    from redis import Redis

    from airfare_management.config import Settings


def register_health_routes(
    app: FastAPI,
    config: Settings,
    redis_client: Redis | None,
    get_session: Callable[..., Generator[Session, None, None]],
) -> None:
    """Attach /health/live and /health/ready to the application."""

    @app.get("/health/live")
    def live() -> dict[str, str]:
        """Kubernetes liveness: process is running."""
        return {"status": "alive"}

    @app.get("/health/ready")
    def ready(session: Session = Depends(get_session)) -> JSONResponse:
        """Readiness: database, Redis, and Celery worker availability."""
        checks: dict[str, str] = {}
        try:
            session.scalar(text("SELECT 1"))
            checks["database"] = "ok"
        except Exception:  # noqa: BLE001
            checks["database"] = "down"

        if config.environment == "test":
            checks["redis"] = "skipped"
            checks["celery"] = "skipped"
        elif redis_client is not None:
            try:
                redis_client.ping()
                checks["redis"] = "ok"
            except Exception:  # noqa: BLE001
                checks["redis"] = "down"
        else:
            checks["redis"] = "down"

        if config.environment != "test":
            try:
                from celery import Celery

                celery_app = Celery(broker=config.celery_broker_url)
                ping = celery_app.control.ping(timeout=1.0)
                checks["celery"] = "ok" if ping else "down"
            except Exception:  # noqa: BLE001
                checks["celery"] = "down"

        all_ok = all(status in {"ok", "skipped"} for status in checks.values())
        body = {"status": "ready" if all_ok else "degraded", "checks": checks}
        return JSONResponse(body, status_code=200 if all_ok else 503)


def update_operational_gauges(session: Session) -> None:
    """Refresh business gauges for Prometheus scrapes."""
    from airfare_management.infrastructure.schema import LoanRow, TicketRow
    from airfare_management.infrastructure.telemetry import ACTIVE_LOANS, PENDING_TICKETS

    active = session.scalar(
        select(func.count())
        .select_from(LoanRow)
        .where(LoanRow.deleted_at.is_(None), LoanRow.status.in_(("active", "deferred")))
    )
    pending = session.scalar(
        select(func.count())
        .select_from(TicketRow)
        .where(TicketRow.deleted_at.is_(None), TicketRow.status == "submitted")
    )
    ACTIVE_LOANS.set(int(active or 0))
    PENDING_TICKETS.set(int(pending or 0))
