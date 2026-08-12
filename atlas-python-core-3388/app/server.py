from __future__ import annotations

import json
import logging
import os
import signal
import sys
from pathlib import Path
from typing import Any

import uvicorn


def runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def load_runtime_config() -> None:
    config_path = runtime_root() / "config" / "runtime-env.json"
    if not config_path.exists():
        return
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise RuntimeError(f"Invalid runtime config file: {config_path}. {exc}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"Invalid runtime config file: {config_path}. Expected JSON object.")
    for key, value in payload.items():
        if value is None:
            continue
        os.environ[str(key)] = str(value)


load_runtime_config()
PORT = int(os.getenv("PORT", "3388"))
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
    if PORT != 3388:
        raise RuntimeError(f"Port isolation violation: expected 3388, got {PORT}.")
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


def run_setup_database() -> int:
    from scripts import migrate_and_seed

    return migrate_and_seed.main()


if __name__ == "__main__":
    if "--setup-check-db" in sys.argv:
        sys.exit(run_setup_database())
    try:
        run()
    except KeyboardInterrupt:
        logging.getLogger("atlas").info("server-stopped")
        sys.exit(0)

