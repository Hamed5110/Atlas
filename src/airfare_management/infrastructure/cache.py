"""Redis-backed preference cache with an in-process fallback."""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from redis import Redis
from redis.exceptions import RedisError

LOGGER = logging.getLogger("airfare.cache")


class PreferenceCache:
    """Five-minute preference cache using Redis when available."""

    def __init__(self, redis_url: str, ttl_seconds: int = 300) -> None:
        """Connect to Redis or fall back to process memory.

        Args:
            redis_url: Redis connection URL.
            ttl_seconds: Entry lifetime. Defaults to five minutes.
        """
        self._ttl = ttl_seconds
        self._memory: dict[str, tuple[float, dict[str, Any]]] = {}
        self._redis: Redis | None = None
        self.backend = "memory"
        try:
            client: Redis = Redis.from_url(
                redis_url,
                socket_connect_timeout=1,
                socket_timeout=1,
                decode_responses=True,
            )
            client.ping()
            self._redis = client
            self.backend = "redis"
            LOGGER.info("preference_cache_using_redis")
        except (RedisError, OSError, ValueError):
            LOGGER.warning(
                "preference_cache_redis_unavailable_falling_back_to_memory",
                exc_info=True,
            )

    def get(self, key: str) -> dict[str, Any] | None:
        """Return a cached preference document when it has not expired."""
        if self._redis is not None:
            try:
                payload = self._redis.get(self._redis_key(key))
                if payload:
                    loaded = json.loads(str(payload))
                    if isinstance(loaded, dict):
                        return loaded
                    return None
            except RedisError:
                LOGGER.warning("preference_cache_redis_read_failed_using_memory", exc_info=True)
                self._redis = None
                self.backend = "memory"
        cached = self._memory.get(key)
        if cached is None or cached[0] <= time.monotonic():
            self._memory.pop(key, None)
            return None
        return cached[1]

    def set(self, key: str, value: dict[str, Any]) -> None:
        """Store a preference document for the configured TTL."""
        self._memory[key] = (time.monotonic() + self._ttl, value)
        if self._redis is None:
            return
        try:
            self._redis.setex(self._redis_key(key), self._ttl, json.dumps(value, default=str))
        except RedisError:
            LOGGER.warning("preference_cache_redis_write_failed_using_memory", exc_info=True)
            self._redis = None
            self.backend = "memory"

    def clear(self) -> None:
        """Drop cached preference documents after an authoritative write."""
        self._memory.clear()
        if self._redis is None:
            return
        try:
            found = list(self._redis.scan_iter(match="airfare:prefs:*", count=100))
            if found:
                self._redis.delete(*found)
        except RedisError:
            LOGGER.warning("preference_cache_redis_clear_failed", exc_info=True)
            self._redis = None
            self.backend = "memory"

    @staticmethod
    def _redis_key(key: str) -> str:
        return f"airfare:prefs:{key}"
