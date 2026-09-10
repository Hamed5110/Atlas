"""Unit tests for WhatsApp attachment gates and nonce validation."""

from __future__ import annotations

import pytest

from airfare_management.whatsapp.gates import AttachmentGateError, validate_attachment_bytes
from airfare_management.whatsapp.nonce import NonceStore, parse_button_payload


def test_pdf_magic_and_size() -> None:
    data = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
    result = validate_attachment_bytes(
        data,
        declared_mime="application/pdf",
        filename="a1b2c3d4-e5f6-7890-abcd-ef1234567890_usr_approved_en_20260907.pdf",
        max_bytes=5 * 1024 * 1024,
    )
    assert result.mime == "application/pdf"
    assert result.mediatype == "document"


def test_csv_blocked() -> None:
    with pytest.raises(AttachmentGateError) as exc:
        validate_attachment_bytes(
            b"a,b\n1,2\n",
            declared_mime="text/csv",
            filename="export.csv",
            max_bytes=1024,
        )
    assert exc.value.code == "spreadsheet_forbidden"


def test_exe_renamed_pdf_blocked() -> None:
    data = b"MZ\x90\x00this is not a pdf"
    with pytest.raises(AttachmentGateError) as exc:
        validate_attachment_bytes(
            data,
            declared_mime="application/pdf",
            filename="evil.pdf",
            max_bytes=5 * 1024 * 1024,
        )
    assert exc.value.code in {"magic", "mime"}


def test_pdf_javascript_blocked() -> None:
    data = b"%PDF-1.4\n/JavaScript (alert(1))\n%%EOF\n"
    with pytest.raises(AttachmentGateError) as exc:
        validate_attachment_bytes(
            data, declared_mime="application/pdf", filename="x.pdf", max_bytes=1024 * 1024
        )
    assert exc.value.code == "pdf_js"


def test_pdf_with_embedded_pan_like_digits_allowed() -> None:
    """Chromium print PDFs embed digit runs that look like PANs — must not block."""
    # Mastercard-shaped run that appears in real contract print binaries.
    data = (
        b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
        b"stream\n5555555555555555 font widths noise 4111111111111111\nendstream\n"
        b"trailer<<>>\n%%EOF\n"
    )
    result = validate_attachment_bytes(
        data,
        declared_mime="application/pdf",
        filename="CO-26-003.pdf",
        max_bytes=5 * 1024 * 1024,
    )
    assert result.mime == "application/pdf"


def test_png_with_luhn_pan_still_blocked() -> None:
    # Minimal PNG header + Luhn-valid Visa test PAN in payload.
    png = b"\x89PNG\r\n\x1a\n" + b"xxxx4111111111111111yyyy"
    with pytest.raises(AttachmentGateError) as exc:
        validate_attachment_bytes(
            png, declared_mime="image/png", filename="card.png", max_bytes=1024 * 1024
        )
    assert exc.value.code == "pii"


def test_nonce_uuid_and_expiry() -> None:
    store = NonceStore("redis://127.0.0.1:6379/15", action_hours=48, replay_hours=72)
    ext = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    jid = "973501111111"
    nonce = store.issue(external_id=ext, action="APPROVE", recipient_jid=jid)
    payload = parse_button_payload(f"APPROVE|{ext}|{nonce}|{int(__import__('time').time())}")
    assert store.validate_and_consume(payload, jid) == "ok"
    with pytest.raises(ValueError, match="replay"):
        store.validate_and_consume(payload, jid)


def test_nonce_wrong_jid() -> None:
    store = NonceStore("redis://127.0.0.1:6379/15")
    ext = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    nonce = store.issue(external_id=ext, action="APPROVE", recipient_jid="973501111111")
    payload = parse_button_payload(f"APPROVE|{ext}|{nonce}|{int(__import__('time').time())}")
    with pytest.raises(ValueError, match="jid_mismatch|nonce_unknown"):
        store.validate_and_consume(payload, "973502222222")


def test_button_payload_rejects_sequential_id() -> None:
    with pytest.raises(ValueError):
        parse_button_payload("APPROVE|REQ-8842|abc|1700000000")
