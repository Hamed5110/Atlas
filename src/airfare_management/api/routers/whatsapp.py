"""WhatsApp / Evolution BFF + webhook ingress."""

import logging
import re
from collections.abc import Callable, Generator
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from airfare_management.api.dependencies import Claims
from airfare_management.config import Settings, get_settings
from airfare_management.whatsapp.client import EvolutionClient, EvolutionError
from airfare_management.whatsapp.cta_jwt import consume_cta_token, mint_cta_token, new_external_id, CtaJwtError
from airfare_management.whatsapp import events as wa_events
from airfare_management.whatsapp.gates import AttachmentGateError, validate_attachment_bytes
from airfare_management.whatsapp.nonce import NonceStore, build_button_id, parse_button_payload
from airfare_management.whatsapp.templates import (
    build_marketing_digest,
    list_templates,
    require_template,
)

LOGGER = logging.getLogger("airfare.whatsapp.api")

WaAdminRoles = ("admin", "SYSTEM_ADMIN", "HR_MANAGER", "hr")

_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001F9FF"
    "\U00002700-\U000027BF"
    "\U0001F600-\U0001F64F"
    "]+",
    flags=re.UNICODE,
)


class CreateInstanceBody(BaseModel):
    instance_name: str = Field(min_length=3, max_length=64)
    mode: Literal["baileys", "cloud"] = "baileys"
    token: str | None = None
    number: str | None = None
    business_id: str | None = None


class SendTextBody(BaseModel):
    instance_name: str
    number: str = Field(min_length=8, max_length=20)
    text: str = Field(min_length=1, max_length=1024)
    external_id: str | None = None


class SendMediaBody(BaseModel):
    instance_name: str
    number: str = Field(min_length=8, max_length=20)
    media_url: str
    file_name: str
    mimetype: str
    caption: str = Field(default="", max_length=1024)
    external_id: str | None = None


class SendTemplateBody(BaseModel):
    instance_name: str
    number: str = Field(min_length=8, max_length=20)
    name: str
    language: str = "en_US"
    components: list[dict[str, Any]] = Field(default_factory=list)
    external_id: str | None = None


class TestSendBody(BaseModel):
    instance_name: str
    number: str = Field(min_length=8, max_length=20)
    template_hint: str = "usr_request_received_en"
    text: str = Field(min_length=1, max_length=1024)


class DigestPreviewBody(BaseModel):
    language: str = "en"
    lines: list[str] = Field(default_factory=list, max_length=40)


class SimulateButtonBody(BaseModel):
    instance_name: str = "lab"
    button_id: str
    sender_jid: str = Field(min_length=8, max_length=32)


class CtaMintBody(BaseModel):
    external_id: str | None = None
    jid: str = Field(min_length=8, max_length=32)
    purpose: str = "download"


class CtaConsumeBody(BaseModel):
    token: str = Field(min_length=20)


# Simple per-process send rate window for digest fallback (E2E-07)
_SEND_WINDOW: list[float] = []
_SEND_LIMIT_PER_MIN = 20


def _strip_emoji(text: str) -> str:
    return _EMOJI_RE.sub("", text).strip()


def _digits(number: str) -> str:
    return re.sub(r"[^\d]", "", number or "")


def _client(settings: Settings) -> EvolutionClient:
    return EvolutionClient(settings.evolution_base_url, settings.evolution_api_key)


def _nonce_store(settings: Settings) -> NonceStore:
    return NonceStore(
        settings.redis_url,
        action_hours=settings.whatsapp_nonce_hours,
        replay_hours=settings.whatsapp_nonce_replay_hours,
    )


def _rate_limit_or_digest() -> dict[str, Any] | None:
    """Return digest directive when send rate exceeded; else None."""
    import time

    now = time.time()
    cutoff = now - 60
    while _SEND_WINDOW and _SEND_WINDOW[0] < cutoff:
        _SEND_WINDOW.pop(0)
    if len(_SEND_WINDOW) >= _SEND_LIMIT_PER_MIN:
        return {
            "code": "rate_limited",
            "action": "bulk_digest",
            "template_hint": "mgr_bulk_digest_en",
            "message": "Per-minute send cap reached. Use MARKETING digest template with STOP.",
        }
    _SEND_WINDOW.append(now)
    return None


def _instance_is_cloud(settings: Settings, instance_name: str) -> bool:
    meta = wa_events.get_instance_meta(instance_name) or {}
    if str(meta.get("mode") or "").lower() == "cloud":
        return True
    try:
        raw = _client(settings).fetch_instances()
    except EvolutionError:
        return False
    rows = raw if isinstance(raw, list) else []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = (
            row.get("instanceName")
            or row.get("name")
            or (row.get("instance") or {}).get("instanceName")
            or ""
        )
        if str(name) != instance_name:
            continue
        integration = str(row.get("integration") or "")
        return "BUSINESS" in integration.upper()
    return False


def create_whatsapp_router(
    database: Callable[[], Generator[Session, None, None]],
    authorized: Callable[..., Callable[[Claims], Claims]],
) -> APIRouter:
    router = APIRouter(tags=["whatsapp"])

    def require_configured(settings: Settings) -> None:
        if not settings.evolution_enabled:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "evolution_disabled",
                    "message": "Set AIRFARE_EVOLUTION_ENABLED=true and AIRFARE_EVOLUTION_API_KEY.",
                },
            )
        if not settings.evolution_api_key:
            raise HTTPException(status_code=503, detail="AIRFARE_EVOLUTION_API_KEY missing")

    @router.get("/v1/admin/wa/status")
    def wa_status(
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        reachable = False
        reach_error = None
        if settings.evolution_enabled and settings.evolution_api_key:
            try:
                _client(settings).fetch_instances()
                reachable = True
            except EvolutionError as exc:
                reach_error = str(exc)
            except Exception as exc:  # noqa: BLE001
                reach_error = str(exc)
        return {
            "enabled": settings.evolution_enabled,
            "configured": bool(settings.evolution_api_key),
            "reachable": reachable,
            "reach_error": reach_error,
            "base_url": settings.evolution_base_url if settings.evolution_enabled else None,
            "default_instance": settings.whatsapp_default_instance,
            "webhook_public_url": settings.evolution_webhook_public_url or None,
            "decision_lock": {
                "no_emoji": True,
                "external_id": "uuidv4",
                "cta_jwt_minutes": settings.whatsapp_cta_jwt_minutes,
                "nonce_hours": settings.whatsapp_nonce_hours,
                "cloud_first_buttons": True,
                "templates": len(list_templates()),
            },
        }

    @router.get("/v1/admin/wa/templates")
    def wa_templates(
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        return {
            "templates": list_templates(),
            "note": "Register these names in Meta Business Manager (EN+AR). Cloud-only for interactive.",
        }

    @router.get("/v1/admin/wa/instances")
    def list_instances(
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        require_configured(settings)
        client = _client(settings)
        try:
            raw = client.fetch_instances()
        except EvolutionError as exc:
            # Fall back to local meta when Evolution is down
            wa_events.push_event(
                event_type="ERROR",
                instance="*",
                summary=str(exc),
                detail={"payload": getattr(exc, "payload", None)},
            )
            return {"instances": wa_events.list_instance_meta(), "evolution_error": str(exc)}

        items: list[dict[str, Any]] = []
        rows = raw if isinstance(raw, list) else raw.get("instance", raw) if isinstance(raw, dict) else []
        if isinstance(rows, dict):
            rows = [rows]
        if not isinstance(rows, list):
            rows = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = (
                row.get("instanceName")
                or row.get("name")
                or (row.get("instance") or {}).get("instanceName")
                or ""
            )
            state = (
                row.get("connectionStatus")
                or row.get("status")
                or (row.get("instance") or {}).get("status")
                or "unknown"
            )
            phone = row.get("owner") or row.get("ownerJid") or row.get("number") or ""
            if isinstance(phone, str) and "@" in phone:
                phone = phone.split("@")[0]
            meta = {
                "name": str(name),
                "state": str(state).lower(),
                "phone": str(phone) if phone else None,
                "mode": "cloud" if "BUSINESS" in str(row.get("integration", "")).upper() else "baileys",
            }
            # meta includes name=; set_instance_meta param is instance_name so this is safe
            wa_events.set_instance_meta(str(name), **meta)
            items.append(meta)
        # Merge local-only metas
        known = {i["name"] for i in items}
        for local in wa_events.list_instance_meta():
            if local.get("name") not in known:
                items.append(local)
        return {"instances": items}

    @router.post("/v1/admin/wa/instances")
    def create_instance(
        body: CreateInstanceBody,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        require_configured(settings)
        if body.mode == "cloud" and not (body.token and body.number and body.business_id):
            raise HTTPException(
                status_code=400,
                detail="Cloud mode requires token, number (Phone Number ID), and business_id",
            )
        integration = "WHATSAPP-BUSINESS" if body.mode == "cloud" else "WHATSAPP-BAILEYS"
        client = _client(settings)
        webhook_url = settings.evolution_webhook_public_url or None
        try:
            result = client.create_instance(
                instance_name=body.instance_name,
                integration=integration,
                qrcode=body.mode == "baileys",
                webhook_url=webhook_url,
                webhook_secret=settings.evolution_webhook_secret,
                token=body.token,
                number=body.number,
                business_id=body.business_id,
            )
        except EvolutionError as exc:
            raise HTTPException(status_code=502, detail={"code": "evolution_error", "message": str(exc), "payload": exc.payload}) from exc

        qr = None
        if isinstance(result, dict):
            q = result.get("qrcode") or {}
            if isinstance(q, dict):
                qr = q.get("base64")
        wa_events.set_instance_meta(
            body.instance_name,
            state="qrcode" if qr else "connecting",
            mode=body.mode,
            phone=body.number,
        )
        wa_events.push_event(
            event_type="INSTANCE_CREATE",
            instance=body.instance_name,
            summary=f"Created {body.mode} instance",
        )
        return {"instance": body.instance_name, "mode": body.mode, "qrcode_base64": qr, "raw": result}

    @router.post("/v1/admin/wa/instances/{instance_name}/connect")
    def connect_instance(
        instance_name: str,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        require_configured(settings)
        client = _client(settings)
        try:
            result = client.connect(instance_name)
        except EvolutionError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        qr = None
        if isinstance(result, dict):
            qr = (result.get("base64") or (result.get("qrcode") or {}).get("base64"))
        wa_events.push_event(event_type="CONNECT", instance=instance_name, summary="connect called")
        return {"instance": instance_name, "qrcode_base64": qr, "raw": result}

    @router.get("/v1/admin/wa/instances/{instance_name}/status")
    def instance_status(
        instance_name: str,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        require_configured(settings)
        client = _client(settings)
        try:
            result = client.connection_state(instance_name)
        except EvolutionError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        state = "unknown"
        if isinstance(result, dict):
            state = str(
                result.get("instance", {}).get("state")
                if isinstance(result.get("instance"), dict)
                else result.get("state") or result.get("status") or "unknown"
            ).lower()
        wa_events.set_instance_meta(instance_name, state=state)
        return {"instance": instance_name, "state": state, "raw": result}

    @router.get("/v1/admin/wa/instances/{instance_name}/qr")
    def instance_qr(
        instance_name: str,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        require_configured(settings)
        client = _client(settings)
        try:
            result = client.connect(instance_name)
        except EvolutionError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        qr = None
        if isinstance(result, dict):
            qr = result.get("base64") or (result.get("qrcode") or {}).get("base64")
        return {"instance": instance_name, "qrcode_base64": qr}

    @router.post("/v1/admin/wa/instances/{instance_name}/webhook/sync")
    def sync_webhook(
        instance_name: str,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        require_configured(settings)
        if not settings.evolution_webhook_public_url:
            raise HTTPException(status_code=400, detail="AIRFARE_EVOLUTION_WEBHOOK_PUBLIC_URL not set")
        client = _client(settings)
        try:
            result = client.set_webhook(
                instance_name,
                settings.evolution_webhook_public_url,
                settings.evolution_webhook_secret,
            )
        except EvolutionError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return {"ok": True, "raw": result}

    @router.post("/v1/admin/wa/send/text")
    def send_text(
        body: SendTextBody,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        require_configured(settings)
        limited = _rate_limit_or_digest()
        if limited:
            raise HTTPException(status_code=429, detail=limited)
        text = _strip_emoji(body.text)
        if not text:
            raise HTTPException(status_code=400, detail="Empty text after emoji strip")
        number = _digits(body.number)
        external_id = body.external_id or new_external_id()
        # UUID-only external IDs on the wire (decision #2)
        try:
            import uuid as _uuid

            _uuid.UUID(external_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="external_id must be UUIDv4") from exc
        meta = wa_events.get_instance_meta(body.instance_name) or {}
        state = str(meta.get("state") or "").lower()
        if state in {"close", "closed"}:
            queued = wa_events.enqueue_outbox(
                instance=body.instance_name,
                kind="text",
                payload={"number": number, "text": text, "external_id": external_id},
            )
            return {"ok": False, "queued": True, "outbox": queued, "external_id": external_id}
        client = _client(settings)
        try:
            result = client.send_text(body.instance_name, number, text)
        except EvolutionError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        wa_events.push_event(
            event_type="SEND_TEXT",
            instance=body.instance_name,
            summary=f"text → {number}",
            detail={"external_id": external_id},
        )
        return {"ok": True, "external_id": external_id, "raw": result}

    @router.post("/v1/admin/wa/send/media")
    def send_media(
        body: SendMediaBody,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        require_configured(settings)
        number = _digits(body.number)
        external_id = body.external_id or new_external_id()
        caption = _strip_emoji(body.caption)
        mediatype = "document" if "pdf" in body.mimetype else "image"
        client = _client(settings)
        try:
            result = client.send_media(
                body.instance_name,
                number=number,
                mediatype=mediatype,
                mimetype=body.mimetype,
                media=body.media_url,
                file_name=body.file_name,
                caption=caption,
            )
        except EvolutionError as exc:
            # Fallback: text + CTA
            portal = settings.whatsapp_portal_base_url.rstrip("/")
            try:
                token = mint_cta_token(settings, external_id=external_id, jid=number, purpose="download")
                fallback = (
                    f"Document delivery failed. Download: {portal}/portal/wa/download?t={token}"
                )
                client.send_text(body.instance_name, number, _strip_emoji(fallback))
            except Exception:  # noqa: BLE001
                LOGGER.exception("media_fallback_failed")
            raise HTTPException(status_code=502, detail={"code": "media_failed", "message": str(exc)}) from exc
        wa_events.push_event(
            event_type="SEND_MEDIA",
            instance=body.instance_name,
            summary=f"media → {number}",
            detail={"external_id": external_id, "file": body.file_name},
        )
        return {"ok": True, "external_id": external_id, "raw": result}

    @router.post("/v1/admin/wa/send/template")
    def send_template(
        body: SendTemplateBody,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        require_configured(settings)
        # Decision #8 — interactive / template path is Cloud-only
        if not _instance_is_cloud(settings, body.instance_name):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "cloud_required",
                    "message": "Interactive templates require a WHATSAPP-BUSINESS (Cloud) instance.",
                },
            )
        lang = body.language or "en"
        try:
            tpl = require_template(body.name, lang)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"code": str(exc), "message": "Unknown or mismatched template"}) from exc
        number = _digits(body.number)
        external_id = body.external_id or new_external_id()
        payload = {
            "number": number,
            "name": tpl.name,
            "language": body.language if "_" in body.language else f"{tpl.language}_{'US' if tpl.language == 'en' else 'AE'}",
            "components": body.components,
        }
        client = _client(settings)
        try:
            result = client.send_template(body.instance_name, payload)
        except EvolutionError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        wa_events.push_event(
            event_type="SEND_TEMPLATE",
            instance=body.instance_name,
            summary=f"{tpl.name} → {number}",
            detail={"external_id": external_id, "category": tpl.category},
        )
        return {"ok": True, "external_id": external_id, "template": tpl.name, "raw": result}

    @router.post("/v1/admin/wa/send/test")
    def send_test(
        body: TestSendBody,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        require_configured(settings)
        text = _strip_emoji(body.text)
        number = _digits(body.number)
        external_id = new_external_id()
        client = _client(settings)
        try:
            result = client.send_text(body.instance_name, number, text)
        except EvolutionError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return {
            "ok": True,
            "external_id": external_id,
            "template_hint": body.template_hint,
            "raw": result,
        }

    @router.post("/v1/admin/wa/attachments/upload")
    async def upload_attachment(
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
        file: Annotated[UploadFile, File()],
        template_name: str = Query(default="attachment"),
    ) -> dict[str, Any]:
        settings = get_settings()
        data = await file.read()
        filename = file.filename or "upload.bin"
        try:
            gate = validate_attachment_bytes(
                data,
                declared_mime=file.content_type,
                filename=filename,
                max_bytes=settings.whatsapp_max_attachment_bytes,
                require_clamav=settings.whatsapp_require_clamav,
            )
        except AttachmentGateError as exc:
            wa_events.push_event(
                event_type="SECURITY",
                instance="*",
                summary=f"attachment blocked: {exc.code}",
            )
            raise HTTPException(status_code=400, detail={"code": exc.code, "message": str(exc)}) from exc

        ext_id = new_external_id()
        ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        safe_name = f"{ext_id}_{template_name}_{ts}.{gate.extension}"
        root = Path(settings.attachment_root).resolve() / "whatsapp-attachments" / datetime.now(timezone.utc).strftime("%Y-%m-%d")
        root.mkdir(parents=True, exist_ok=True)
        dest = root / safe_name
        dest.write_bytes(data)

        # Local serve URL (dev). Production should replace with S3 pre-sign.
        public = f"{settings.api_base_url.rstrip('/')}/v1/admin/wa/attachments/files/{datetime.now(timezone.utc).strftime('%Y-%m-%d')}/{safe_name}"
        return {
            "ok": True,
            "attachment_id": ext_id,
            "file_name": safe_name,
            "mimetype": gate.mime,
            "mediatype": gate.mediatype,
            "size": gate.size,
            "media_url": public,
            "path": str(dest),
        }

    @router.get("/v1/admin/wa/attachments/files/{day}/{filename}")
    def serve_attachment(
        day: str,
        filename: str,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> Any:
        settings = get_settings()
        from fastapi.responses import FileResponse

        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or ".." in filename or "/" in filename:
            raise HTTPException(status_code=400, detail="invalid path")
        path = Path(settings.attachment_root).resolve() / "whatsapp-attachments" / day / filename
        if not path.is_file():
            raise HTTPException(status_code=404, detail="not found")
        return FileResponse(path)

    @router.get("/v1/admin/wa/events")
    def list_events(
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
        limit: int = Query(default=50, ge=1, le=50),
    ) -> dict[str, Any]:
        return {"events": wa_events.list_events(limit)}

    @router.post("/v1/admin/wa/nonce/issue")
    def issue_nonce(
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
        external_id: str = Query(...),
        action: str = Query(...),
        recipient_jid: str = Query(...),
    ) -> dict[str, Any]:
        settings = get_settings()
        store = _nonce_store(settings)
        nonce = store.issue(
            external_id=external_id,
            action=action,
            recipient_jid=_digits(recipient_jid),
        )
        button_id = build_button_id(action, external_id, nonce)
        return {"nonce": nonce, "button_id": button_id, "ttl_hours": settings.whatsapp_nonce_hours}

    @router.post("/v1/admin/wa/digest/preview")
    def digest_preview(
        body: DigestPreviewBody,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        text = build_marketing_digest(language=body.language, lines=body.lines, include_stop=True)
        if "STOP" not in text:
            raise HTTPException(status_code=500, detail="digest_missing_stop")
        return {
            "ok": True,
            "category": "MARKETING",
            "text": text,
            "template_hint": "mgr_bulk_digest_en" if body.language.startswith("en") else "mgr_bulk_digest_ar",
        }

    @router.post("/v1/admin/wa/cta/mint")
    def cta_mint(
        body: CtaMintBody,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        external_id = body.external_id or new_external_id()
        try:
            token = mint_cta_token(
                settings,
                external_id=external_id,
                jid=_digits(body.jid),
                purpose=body.purpose,
            )
        except CtaJwtError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        portal = (settings.whatsapp_portal_base_url or settings.api_base_url).rstrip("/")
        return {
            "ok": True,
            "external_id": external_id,
            "token": token,
            "ttl_minutes": settings.whatsapp_cta_jwt_minutes,
            "url": f"{portal}/portal/wa/{body.purpose}?t={token}",
        }

    @router.post("/v1/admin/wa/cta/consume")
    def cta_consume(
        body: CtaConsumeBody,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        settings = get_settings()
        try:
            claims = consume_cta_token(settings, body.token)
        except CtaJwtError as exc:
            raise HTTPException(status_code=401, detail={"code": str(exc)}) from exc
        return {"ok": True, "claims": {k: claims[k] for k in ("sub", "jid", "purpose", "jti", "exp") if k in claims}}

    @router.post("/v1/admin/wa/lab/simulate-button")
    def lab_simulate_button(
        body: SimulateButtonBody,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        """Lab-only Approve cascade without Meta — feeds the same webhook handler path."""
        settings = get_settings()
        try:
            parsed = parse_button_payload(body.button_id)
            store = _nonce_store(settings)
            store.validate_and_consume(parsed, _digits(body.sender_jid))
        except ValueError as exc:
            wa_events.push_event(
                event_type="BUTTON_FAIL",
                instance=body.instance_name,
                summary=str(exc),
                detail={"button_id": body.button_id},
            )
            return {"ok": False, "reason": str(exc), "processed": False}
        wa_events.push_event(
            event_type="BUTTON_OK",
            instance=body.instance_name,
            summary=f"{parsed.action} {parsed.external_id}",
            detail={"jid": _digits(body.sender_jid), "lab": True},
        )
        return {
            "ok": True,
            "action": parsed.action,
            "external_id": parsed.external_id,
            "processed": True,
            "lab": True,
        }

    @router.get("/v1/admin/wa/outbox")
    def wa_outbox(
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
        limit: int = Query(default=50, ge=1, le=200),
    ) -> dict[str, Any]:
        return {"outbox": wa_events.list_outbox(limit)}

    @router.post("/v1/admin/wa/outbox/{instance_name}/drain")
    def wa_outbox_drain(
        instance_name: str,
        _: Annotated[Claims, Depends(authorized("admin", "hr", "SYSTEM_ADMIN", "HR_MANAGER"))],
    ) -> dict[str, Any]:
        ready = wa_events.drain_outbox(instance_name)
        return {"ok": True, "ready": ready, "count": len(ready)}

    async def _handle_evolution_webhook(
        request: Request,
        authorization: str | None,
        *,
        event_path: str | None = None,
    ) -> dict[str, Any]:
        """Ingress for Evolution webhooks (base URL and byEvents path suffixes)."""
        settings = get_settings()
        expected = f"Bearer {settings.evolution_webhook_secret}"
        if not authorization or authorization != expected:
            wa_events.push_event(
                event_type="SECURITY",
                instance="*",
                summary="webhook rejected: bad signature",
            )
            raise HTTPException(status_code=401, detail="unauthorized")

        try:
            payload = await request.json()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="invalid json") from exc

        # Evolution byEvents posts to /webhook/evolution/{event-kebab}; payload.event may also be set.
        path_event = (event_path or "").strip("/").replace("-", ".") if event_path else ""
        event = str(payload.get("event") or payload.get("type") or path_event or "unknown")
        instance = str(payload.get("instance") or "*")
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        wa_events.push_event(
            event_type=event.upper(),
            instance=instance,
            summary=event,
            detail={"keys": list(data.keys())[:20], "path": event_path or ""},
        )

        # Connection updates
        if "CONNECTION" in event.upper():
            state = str(
                (data.get("state") or data.get("status") or "")
            ).lower()
            if state:
                wa_events.set_instance_meta(instance, state=state)
            if state == "open":
                wa_events.drain_outbox(instance)

        # QR updates
        if "QRCODE" in event.upper():
            qr = data.get("qrcode") or data.get("base64")
            if isinstance(qr, dict):
                qr = qr.get("base64")
            if isinstance(qr, str) and qr:
                wa_events.set_instance_meta(instance, state="qrcode", last_qr=qr[:80] + "…")

        # Button clicks
        button_id = _extract_button_id(data)
        if button_id:
            remote = ""
            key = data.get("key") if isinstance(data.get("key"), dict) else {}
            remote = str(key.get("remoteJid") or "")
            jid = _digits(remote.split("@")[0] if remote else "")
            try:
                parsed = parse_button_payload(button_id)
                store = _nonce_store(settings)
                store.validate_and_consume(parsed, jid)
                wa_events.push_event(
                    event_type="BUTTON_OK",
                    instance=instance,
                    summary=f"{parsed.action} {parsed.external_id}",
                    detail={"jid": jid},
                )
                # Confirm to manager (best-effort)
                if settings.evolution_enabled and settings.evolution_api_key and jid:
                    try:
                        _client(settings).send_text(
                            instance,
                            jid,
                            f"Action recorded: {parsed.action}. Request reference: {parsed.external_id}. Status updated.",
                        )
                    except EvolutionError:
                        LOGGER.warning("confirm_send_failed", exc_info=True)
                return {
                    "ok": True,
                    "action": parsed.action,
                    "external_id": parsed.external_id,
                    "processed": True,
                }
            except ValueError as exc:
                reason = str(exc)
                wa_events.push_event(
                    event_type="BUTTON_FAIL",
                    instance=instance,
                    summary=reason,
                    detail={"button_id": button_id, "jid": jid},
                )
                if settings.evolution_enabled and settings.evolution_api_key and jid:
                    try:
                        msg = (
                            "This request has expired. A new approval message has been sent."
                            if reason == "expired"
                            else f"This action could not be processed. Reason: {reason}. If urgent, use the portal link."
                        )
                        _client(settings).send_text(instance, jid, msg)
                    except EvolutionError:
                        LOGGER.warning("error_notify_failed", exc_info=True)
                return {"ok": False, "reason": reason, "processed": False}

        return {"ok": True, "processed": False}

    @router.post("/v1/webhook/evolution")
    async def evolution_webhook(
        request: Request,
        authorization: Annotated[str | None, Header()] = None,
    ) -> dict[str, Any]:
        return await _handle_evolution_webhook(request, authorization)

    @router.post("/v1/webhook/evolution/{event_path:path}")
    async def evolution_webhook_by_event(
        event_path: str,
        request: Request,
        authorization: Annotated[str | None, Header()] = None,
    ) -> dict[str, Any]:
        # Evolution webhookByEvents / byEvents appends kebab event names:
        # /connection-update, /messages-upsert, /messages-update, /qrcode-updated, ...
        return await _handle_evolution_webhook(request, authorization, event_path=event_path)

    return router


def _extract_button_id(data: dict[str, Any]) -> str | None:
    msg = data.get("message") if isinstance(data.get("message"), dict) else {}
    for key in ("buttonsResponseMessage", "templateButtonReplyMessage", "listResponseMessage"):
        node = msg.get(key)
        if isinstance(node, dict):
            for field in ("selectedButtonId", "selectedId", "id", "buttonId"):
                val = node.get(field)
                if isinstance(val, str) and "|" in val:
                    return val
    # Cloud interactive
    interactive = msg.get("interactiveResponseMessage") or msg.get("interactive")
    if isinstance(interactive, dict):
        br = interactive.get("buttonReply") or interactive.get("nativeFlowResponseMessage") or {}
        if isinstance(br, dict):
            for field in ("id", "selectedButtonId"):
                val = br.get(field)
                if isinstance(val, str) and "|" in val:
                    return val
    return None
