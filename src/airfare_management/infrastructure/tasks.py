"""Celery worker composition for asynchronous operational jobs."""

from datetime import UTC, datetime

from celery import Celery  # type: ignore[import-untyped]

from airfare_management.config import get_settings

settings = get_settings()
celery_app = Celery(
    "airfare_management",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=("json",),
    enable_utc=True,
    timezone="UTC",
    task_track_started=True,
)


@celery_app.task(name="airfare.system_health")  # type: ignore[untyped-decorator]
def system_health() -> dict[str, str]:
    """Return a timestamped worker health result."""
    return {"status": "ok", "checked_at": datetime.now(UTC).isoformat()}
