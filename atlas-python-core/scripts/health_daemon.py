from __future__ import annotations

import json
import logging
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import psutil


ROOT = Path(__file__).resolve().parents[1]
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "health_daemon.log"
HEALTH_URL = "http://127.0.0.1:3356/api/v1/health"
SERVICE_NAME = "AtlasPythonCore3356"
POLL_SECONDS = 30
FAILURE_LIMIT = 3


class JsonLineFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestampUtc": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "event": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if hasattr(record, "extra_payload"):
            payload.update(getattr(record, "extra_payload"))
        return json.dumps(payload, separators=(",", ":"), default=str)


def configure_logging() -> logging.Logger:
    logger = logging.getLogger("atlas.health_daemon")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    handler.setFormatter(JsonLineFormatter())
    logger.addHandler(handler)
    return logger


def system_stats(latency_ms: int, status_code: int | None) -> dict[str, Any]:
    return {
        "latencyMs": latency_ms,
        "statusCode": status_code,
        "cpuPercent": psutil.cpu_percent(interval=None),
        "memoryPercent": psutil.virtual_memory().percent,
        "serviceName": SERVICE_NAME,
        "url": HEALTH_URL,
    }


def restart_service(logger: logging.Logger) -> None:
    logger.warning("health.restart.requested", extra={"extra_payload": {"serviceName": SERVICE_NAME}})
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", f"Restart-Service -Name '{SERVICE_NAME}' -Force"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if completed.returncode != 0:
        logger.error(
            "health.restart.failed",
            extra={"extra_payload": {"returnCode": completed.returncode, "stderr": completed.stderr.strip()}},
        )
        return
    logger.info("health.restart.completed", extra={"extra_payload": {"stdout": completed.stdout.strip()}})


def poll_once(client: httpx.Client) -> tuple[bool, dict[str, Any]]:
    started = time.perf_counter()
    response = client.get(HEALTH_URL)
    latency_ms = int((time.perf_counter() - started) * 1000)
    healthy = response.status_code == 200 and response.json().get("status") == "ok"
    return healthy, system_stats(latency_ms, response.status_code)


def main() -> None:
    logger = configure_logging()
    logger.info("health.daemon.start", extra={"extra_payload": {"pollSeconds": POLL_SECONDS, "failureLimit": FAILURE_LIMIT}})
    consecutive_failures = 0
    with httpx.Client(timeout=10) as client:
        while True:
            try:
                healthy, payload = poll_once(client)
                if healthy:
                    consecutive_failures = 0
                    logger.info("health.ok", extra={"extra_payload": payload})
                else:
                    consecutive_failures += 1
                    payload["consecutiveFailures"] = consecutive_failures
                    logger.error("health.bad_response", extra={"extra_payload": payload})
            except Exception:
                consecutive_failures += 1
                logger.exception("health.exception", extra={"extra_payload": {"consecutiveFailures": consecutive_failures}})

            if consecutive_failures >= FAILURE_LIMIT:
                restart_service(logger)
                consecutive_failures = 0

            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
