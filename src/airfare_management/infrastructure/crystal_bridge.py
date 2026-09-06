"""Optional SAP BusinessObjects / Crystal Reports BIP bridge.

Requires AIRFARE_CRYSTAL_BIP_URL (and credentials). When unset, the UI hides
Crystal actions and the API reports configured=false.
"""

from __future__ import annotations

from typing import Any
from urllib import error, parse, request
from xml.etree import ElementTree as ET

from airfare_management.config import Settings


def crystal_configured(settings: Settings) -> bool:
    return bool(settings.crystal_bip_url and settings.crystal_username)


def crystal_status(settings: Settings) -> dict[str, Any]:
    return {
        "configured": crystal_configured(settings),
        "bip_url": settings.crystal_bip_url or None,
        "opendocument_base": settings.crystal_opendocument_base or None,
        "note": (
            "Native Crystal-style builder is primary. SAP Crystal 2020 mainstream "
            "support winds down ~Dec 2026; use BIP only when licensed."
            if not crystal_configured(settings)
            else "BIP bridge ready — export uses RESTful logon + OpenDocument."
        ),
    }


def _logon_token(settings: Settings) -> str:
    if not crystal_configured(settings):
        raise RuntimeError("Crystal BIP is not configured.")
    base = settings.crystal_bip_url.rstrip("/")
    body = f"""<attrs xmlns="http://www.sap.com/rws/bip">
  <attr name="userName" type="string">{settings.crystal_username}</attr>
  <attr name="password" type="string">{settings.crystal_password}</attr>
  <attr name="auth" type="string">secEnterprise</attr>
</attrs>"""
    req = request.Request(
        f"{base}/logon/long",
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/xml", "Accept": "application/xml"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=30) as response:
            payload = response.read().decode("utf-8", errors="replace")
    except error.URLError as exc:
        raise RuntimeError(f"Crystal BIP logon failed: {exc}") from exc
    root = ET.fromstring(payload)
    for node in root.iter():
        if node.attrib.get("name") == "logonToken" and node.text:
            return node.text
    # Some BIP builds return the token as the body text of attr
    token_nodes = [n for n in root.iter() if (n.text or "").startswith('"')]
    if token_nodes and token_nodes[0].text:
        return token_nodes[0].text.strip().strip('"')
    raise RuntimeError("Crystal BIP logon succeeded but no logonToken was returned.")


def opendocument_url(settings: Settings, *, cuid: str | None = None, doc_id: str | None = None) -> str:
    if not settings.crystal_opendocument_base:
        raise RuntimeError("AIRFARE_CRYSTAL_OPENDOCUMENT_BASE is not set.")
    base = settings.crystal_opendocument_base.rstrip("/")
    params: dict[str, str] = {"sOutputFormat": "P"}
    if cuid:
        params["iDocID"] = cuid
    elif doc_id:
        params["iDocID"] = doc_id
    else:
        raise RuntimeError("Provide cuid or doc_id for OpenDocument.")
    return f"{base}?{parse.urlencode(params)}"


def export_report_pdf(settings: Settings, *, report_id: str) -> bytes:
    """Export a Crystal report PDF via BIP REST (best-effort)."""
    token = _logon_token(settings)
    base = settings.crystal_bip_url.rstrip("/")
    url = f"{base}/raylight/v1/documents/{parse.quote(report_id)}"
    req = request.Request(
        url,
        headers={
            "Accept": "application/pdf",
            "X-SAP-LogonToken": token,
        },
        method="GET",
    )
    try:
        with request.urlopen(req, timeout=120) as response:
            return response.read()
    except error.URLError as exc:
        raise RuntimeError(f"Crystal export failed: {exc}") from exc
