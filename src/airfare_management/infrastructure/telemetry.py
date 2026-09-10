"""Structured logging and Prometheus metrics for the API."""

from __future__ import annotations

import logging
import re
import time
from typing import TYPE_CHECKING

import structlog
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from airfare_management.config import Settings

HTTP_REQUESTS = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"],
)
HTTP_DURATION = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency",
    ["method", "endpoint"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)
DB_QUERY_DURATION = Histogram(
    "db_query_duration_seconds",
    "Database query latency",
    buckets=(0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0),
)
CELERY_TASKS = Counter(
    "celery_tasks_total",
    "Celery task executions",
    ["task_name", "status"],
)
ACTIVE_LOANS = Gauge("active_loans_total", "Active employee loans")
PENDING_TICKETS = Gauge("pending_tickets_total", "Tickets awaiting approval")


def configure_logging(settings: Settings) -> None:
    """Configure structlog for JSON (production) or console (development)."""
    shared = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        redact_sensitive,
        sanitize_log_event_values,
    ]
    if settings.environment == "production":
        processors = [*shared, structlog.processors.dict_tracebacks, structlog.processors.JSONRenderer()]
    else:
        processors = [*shared, structlog.dev.ConsoleRenderer()]
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        cache_logger_on_first_use=True,
    )
    logging.basicConfig(level=logging.INFO, format="%(message)s")


def redact_sensitive(_: object, __: str, event_dict: dict[str, object]) -> dict[str, object]:
    """Strip password and token fields from log events."""
    for key in list(event_dict):
        lowered = key.lower()
        if any(token in lowered for token in ("password", "token", "secret", "sqlcmdpassword")):
            event_dict[key] = "***"
    return event_dict


_LOG_CRLF_RE = re.compile(r"[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+")
_LOG_FORMAT_RE = re.compile(r"%[0-9.#\-+ ]*[sdnxXfFeEgGc%]")


def sanitize_log_event_values(
    _: object, __: str, event_dict: dict[str, object]
) -> dict[str, object]:
    """Neutralize CR/LF and format tokens in string log values (forensic integrity)."""
    for key, value in list(event_dict.items()):
        if isinstance(value, str):
            cleaned = _LOG_CRLF_RE.sub(" ", value)
            cleaned = _LOG_FORMAT_RE.sub("", cleaned)
            event_dict[key] = " ".join(cleaned.split())
    return event_dict


class PrometheusMiddleware(BaseHTTPMiddleware):
    """Record request counts and latency histograms."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.url.path == "/metrics":
            return await call_next(request)
        started = time.perf_counter()
        response = await call_next(request)
        endpoint = request.url.path
        for prefix in ("/v1/", "/health"):
            if endpoint.startswith(prefix):
                parts = endpoint.strip("/").split("/")
                endpoint = "/".join(parts[:3]) if len(parts) >= 3 else endpoint
                break
        HTTP_REQUESTS.labels(request.method, endpoint, str(response.status_code)).inc()
        HTTP_DURATION.labels(request.method, endpoint).observe(time.perf_counter() - started)
        return response


def metrics_response() -> Response:
    """Return the Prometheus scrape payload."""
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
