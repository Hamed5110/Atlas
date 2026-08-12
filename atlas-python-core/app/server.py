from __future__ import annotations

import json
import logging
import os
import signal
import sys
from typing import Any

import uvicorn


PORT = int(os.getenv("PORT", "3356"))
HOST = os.getenv("ATLAS_PYTHON_HOST", "0.0.0.0")
WORKERS = int(os.getenv("ATLAS_UVICORN_WORKERS", "1"))


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%SZ"),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, separators=(",", ":"), default=str)


def configure_logging() -> dict[str, Any]:
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"json": {"()": JsonFormatter}},
        "handlers": {
            "default": {"formatter": "json", "class": "logging.StreamHandler", "stream": "ext://sys.stdout"},
            "access": {"formatter": "json", "class": "logging.StreamHandler", "stream": "ext://sys.stdout"},
        },
        "loggers": {
            "uvicorn": {"handlers": ["default"], "level": "INFO", "propagate": False},
            "uvicorn.error": {"handlers": ["default"], "level": "INFO", "propagate": False},
            "uvicorn.access": {"handlers": ["access"], "level": "INFO", "propagate": False},
            "atlas": {"handlers": ["default"], "level": "INFO", "propagate": False},
        },
    }


def install_shutdown_handlers() -> None:
    logger = logging.getLogger("atlas")

    def handle_signal(signum: int, _frame: Any) -> None:
        logger.info("shutdown-signal-received signal=%s", signum)
        raise KeyboardInterrupt

    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, handle_signal)
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, handle_signal)


def run() -> None:
    if PORT != 3356:
        raise RuntimeError(f"Port isolation violation: expected 3356, got {PORT}.")
    install_shutdown_handlers()
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        workers=WORKERS,
        log_config=configure_logging(),
        timeout_graceful_shutdown=30,
        server_header=False,
        proxy_headers=True,
    )


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        logging.getLogger("atlas").info("server-stopped")
        sys.exit(0)
