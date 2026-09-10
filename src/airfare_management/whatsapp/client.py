"""HTTP client for Evolution API v2."""

from __future__ import annotations

import logging
from typing import Any

import httpx

LOGGER = logging.getLogger("airfare.whatsapp.evolution")

WEBHOOK_EVENTS = [
    "QRCODE_UPDATED",
    "CONNECTION_UPDATE",
    "MESSAGES_UPSERT",
    "MESSAGES_UPDATE",
    "SEND_MESSAGE",
]


class EvolutionError(Exception):
    """Evolution API call failed."""

    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


class EvolutionClient:
    """Thin Evolution v2 client. Browser never holds apikey — BFF only."""

    def __init__(self, base_url: str, api_key: str, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def enabled(self) -> bool:
        return bool(self.base_url and self.api_key)

    def _headers(self) -> dict[str, str]:
        return {"apikey": self.api_key, "Content-Type": "application/json"}

    def _request(self, method: str, path: str, json_body: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.request(method, url, headers=self._headers(), json=json_body)
        except httpx.HTTPError as exc:
            raise EvolutionError(f"Evolution unreachable: {exc}") from exc
        try:
            data = resp.json() if resp.content else {}
        except Exception:  # noqa: BLE001
            data = {"raw": resp.text[:500]}
        if resp.status_code >= 400:
            raise EvolutionError(
                f"Evolution {method} {path} failed ({resp.status_code})",
                status_code=resp.status_code,
                payload=data,
            )
        return data

    def create_instance(
        self,
        *,
        instance_name: str,
        integration: str,
        qrcode: bool = True,
        webhook_url: str | None = None,
        webhook_secret: str | None = None,
        token: str | None = None,
        number: str | None = None,
        business_id: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "instanceName": instance_name,
            "integration": integration,
            "qrcode": bool(qrcode and "BAILEYS" in integration.upper()),
        }
        if token:
            body["token"] = token
        if number:
            body["number"] = number
        if business_id:
            body["businessId"] = business_id
        if webhook_url:
            # byEvents=True appends /{event} to the URL (e.g. .../messages-update).
            # ATLAS accepts both the base path and /{event} suffixes.
            body["webhook"] = {
                "enabled": True,
                "url": webhook_url.rstrip("/"),
                "byEvents": True,
                "base64": False,
                "events": WEBHOOK_EVENTS,
                "headers": {"Authorization": f"Bearer {webhook_secret or ''}"},
            }
        return self._request("POST", "/instance/create", body)

    def connect(self, instance_name: str) -> dict[str, Any]:
        return self._request("GET", f"/instance/connect/{instance_name}")

    def connection_state(self, instance_name: str) -> dict[str, Any]:
        return self._request("GET", f"/instance/connectionState/{instance_name}")

    def resolve_open_instance(self, preferred: str | None = None) -> tuple[str | None, str]:
        """Return (instance_name, state) for an open session; prefer ``preferred`` if open."""
        preferred = (preferred or "").strip()
        rows = self.fetch_instances()
        if not isinstance(rows, list):
            rows = []
        candidates: list[tuple[str, str]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(
                row.get("instanceName")
                or row.get("name")
                or (row.get("instance") or {}).get("instanceName")
                or ""
            ).strip()
            if not name:
                continue
            state = str(
                row.get("connectionStatus")
                or row.get("status")
                or (row.get("instance") or {}).get("status")
                or ""
            ).lower()
            # Live connectionState is authoritative when list status is stale
            try:
                live = self.connection_state(name)
                if isinstance(live, dict):
                    inst = live.get("instance") if isinstance(live.get("instance"), dict) else live
                    state = str((inst or {}).get("state") or state).lower()
            except EvolutionError:
                pass
            candidates.append((name, state))
        if preferred:
            for name, state in candidates:
                if name == preferred and state == "open":
                    return name, state
        for name, state in candidates:
            if state == "open":
                return name, state
        if preferred:
            for name, state in candidates:
                if name == preferred:
                    return name, state or "unknown"
        return (candidates[0] if candidates else (None, "none"))[0], (
            candidates[0][1] if candidates else "none"
        )

    def fetch_instances(self) -> Any:
        return self._request("GET", "/instance/fetchInstances")

    def set_webhook(self, instance_name: str, webhook_url: str, webhook_secret: str) -> dict[str, Any]:
        # Evolution v2 expects nested webhook + byEvents (not legacy webhookByEvents alone).
        nested = {
            "enabled": True,
            "url": webhook_url.rstrip("/"),
            "byEvents": True,
            "base64": False,
            "events": WEBHOOK_EVENTS,
            "headers": {"Authorization": f"Bearer {webhook_secret}"},
        }
        try:
            return self._request("POST", f"/webhook/set/{instance_name}", {"webhook": nested})
        except EvolutionError:
            # Older shapes: flat body with webhookByEvents alias
            flat = {
                "enabled": True,
                "url": nested["url"],
                "webhookByEvents": True,
                "webhookBase64": False,
                "events": WEBHOOK_EVENTS,
                "headers": nested["headers"],
            }
            return self._request("POST", f"/webhook/set/{instance_name}", flat)

    def send_text(self, instance_name: str, number: str, text: str) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/message/sendText/{instance_name}",
            {"number": number, "text": text},
        )

    def send_media(
        self,
        instance_name: str,
        *,
        number: str,
        mediatype: str,
        mimetype: str,
        media: str,
        file_name: str,
        caption: str = "",
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/message/sendMedia/{instance_name}",
            {
                "number": number,
                "mediatype": mediatype,
                "mimetype": mimetype,
                "media": media,
                "fileName": file_name,
                "caption": caption,
            },
        )

    def send_template(self, instance_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/message/sendTemplate/{instance_name}", payload)
