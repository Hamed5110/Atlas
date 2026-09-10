"""Fail-closed attachment security gates for WhatsApp media."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

LOGGER = logging.getLogger("airfare.whatsapp.gates")

ALLOWED_MIME = {
    "application/pdf": (b"%PDF", "pdf", "document"),
    "image/jpeg": (b"\xff\xd8\xff", "jpg", "image"),
    "image/jpg": (b"\xff\xd8\xff", "jpg", "image"),
    "image/png": (b"\x89PNG\r\n\x1a\n", "png", "image"),
}

BLOCKED_EXTENSIONS = frozenset({"csv", "xlsx", "xls", "xlsm", "ods", "tsv"})

# PAN-like / SSN-like — used on non-PDF payloads only (see validate_attachment_bytes).
_PAN_RE = re.compile(rb"(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})")
_SSN_RE = re.compile(rb"\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b")


class AttachmentGateError(Exception):
    """Attachment rejected by security gates."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class GateResult:
    mime: str
    extension: str
    mediatype: str
    size: int


def validate_attachment_bytes(
    data: bytes,
    *,
    declared_mime: str | None,
    filename: str,
    max_bytes: int,
    require_clamav: bool = False,
) -> GateResult:
    """Validate WhatsApp attachment. Never returns soft-fail for bad files."""
    if not data:
        raise AttachmentGateError("empty", "Empty attachment.")
    if len(data) > max_bytes:
        raise AttachmentGateError("oversize", f"Attachment exceeds {max_bytes} bytes.")

    name_ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if name_ext in BLOCKED_EXTENSIONS:
        raise AttachmentGateError(
            "spreadsheet_forbidden",
            "CSV/XLSX and spreadsheet attachments are not allowed on WhatsApp.",
        )

    mime = (declared_mime or "").split(";")[0].strip().lower()
    if mime in {
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }:
        raise AttachmentGateError(
            "spreadsheet_forbidden",
            "CSV/XLSX and spreadsheet attachments are not allowed on WhatsApp.",
        )
    if mime not in ALLOWED_MIME:
        mime = _sniff_mime(data)
    if mime not in ALLOWED_MIME:
        raise AttachmentGateError("mime", f"MIME not allowed: {declared_mime or 'unknown'}")

    magic, ext, mediatype = ALLOWED_MIME[mime]
    if not data.startswith(magic):
        raise AttachmentGateError("magic", "Magic bytes do not match declared type.")

    # Extension spoof
    name_ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if name_ext and name_ext not in {ext, "jpeg" if ext == "jpg" else ext}:
        if not (ext == "jpg" and name_ext == "jpeg"):
            raise AttachmentGateError("extension", "Filename extension does not match content.")

    if mime == "application/pdf":
        _validate_pdf(data)
        # Do NOT binary-scan PDFs for PAN/SSN. Chromium print PDFs embed font/ICC
        # streams that routinely contain digit runs (e.g. 5555555555555555) and
        # employment contracts intentionally include CPR/passport identifiers.
        # Structure gates above remain fail-closed for JS/Launch/Encrypt/etc.
    elif _has_unexpected_pii(data):
        raise AttachmentGateError("pii", "Unexpected PII pattern detected in attachment.")

    if require_clamav:
        _clamav_scan(data)

    return GateResult(mime=mime, extension=ext, mediatype=mediatype, size=len(data))


def _luhn_ok(digits: bytes) -> bool:
    """Return True if digits pass the Luhn check (real card-number heuristic)."""
    try:
        nums = [int(c) for c in digits.decode("ascii")]
    except (UnicodeDecodeError, ValueError):
        return False
    if len(nums) < 13:
        return False
    total = 0
    parity = len(nums) % 2
    for i, n in enumerate(nums):
        if i % 2 == parity:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def _has_unexpected_pii(data: bytes) -> bool:
    """Binary PII heuristic for images/other non-PDF allowed MIME types."""
    if _SSN_RE.search(data):
        return True
    for match in _PAN_RE.finditer(data):
        # Require Luhn so random digit runs in image payloads are not blocked.
        if _luhn_ok(match.group(0)):
            return True
    return False


def _sniff_mime(data: bytes) -> str:
    for mime, (magic, _, _) in ALLOWED_MIME.items():
        if data.startswith(magic):
            return mime if mime != "image/jpg" else "image/jpeg"
    return ""


def _validate_pdf(data: bytes) -> None:
    lower = data.lower()
    # Reject common risky PDF features (defense-in-depth, not a full PDF parser)
    for marker, code in (
        (b"/javascript", "pdf_js"),
        (b"/js ", "pdf_js"),
        (b"/launch", "pdf_launch"),
        (b"/embeddedfile", "pdf_embedded"),
        (b"/encrypt", "pdf_encrypted"),
    ):
        if marker in lower:
            raise AttachmentGateError(code, f"PDF rejected ({code}).")


def _clamav_scan(data: bytes) -> None:
    try:
        import clamd  # type: ignore
    except ImportError as exc:
        raise AttachmentGateError("clamav_missing", "ClamAV client not installed.") from exc
    try:
        cd = clamd.ClamdUnixSocket()
        result = cd.instream(data)
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("clamav_scan_failed", exc_info=True)
        raise AttachmentGateError("clamav_error", f"ClamAV scan failed: {exc}") from exc
    status = (result or {}).get("stream")
    if status and status[0] != "OK":
        raise AttachmentGateError("malware", f"ClamAV hit: {status}")
