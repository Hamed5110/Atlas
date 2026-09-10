"""Unit tests: document WhatsApp + PDF fan-out via Evolution."""

from __future__ import annotations

import base64
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from airfare_management.api import main as api_main


MINIMAL_PDF = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def test_fanout_sends_text_and_media() -> None:
    client = MagicMock()
    client.resolve_open_instance.return_value = ("atlas-smoke-test", "open")
    settings = SimpleNamespace(
        evolution_enabled=True,
        evolution_api_key="k",
        evolution_base_url="http://127.0.0.1:8080",
        whatsapp_default_instance="atlas-smoke-test",
    )
    with (
        patch.object(api_main, "get_settings", return_value=settings),
        patch("airfare_management.whatsapp.client.EvolutionClient", return_value=client),
        patch("airfare_management.whatsapp.events.set_instance_meta"),
        patch("airfare_management.whatsapp.events.push_event"),
        patch("airfare_management.whatsapp.events.drain_outbox", return_value=[]),
    ):
        result = api_main._fanout_whatsapp_pdf(
            recipients=["97335000001"],
            text="ATLAS Offer Letter",
            caption="OFL-1",
            pdf_bytes=MINIMAL_PDF,
            filename="OFL-1.pdf",
            external_id="doc-1",
            purpose="document_offer_letter",
        )
    assert result["sent"] is True
    assert result["pdf_attached"] is True
    client.send_text.assert_called_once()
    client.send_media.assert_called_once()
    assert base64.b64decode(client.send_media.call_args.kwargs["media"]).startswith(b"%PDF")


def test_notify_document_whatsapp_loads_stored_pdf(tmp_path: Path) -> None:
    doc_id = str(uuid4())
    pdf_path = tmp_path / f"{doc_id}.pdf"
    pdf_path.write_bytes(MINIMAL_PDF)
    row = SimpleNamespace(
        id=doc_id,
        kind="offer_letter",
        voucher_no="OFL-0001",
        title="Offer — Test",
        params={"full_name": "Test Candidate"},
        pdf_key=f"{doc_id}.pdf",
    )
    session = MagicMock()
    settings = SimpleNamespace(
        evolution_enabled=True,
        evolution_api_key="k",
        evolution_base_url="http://127.0.0.1:8080",
        whatsapp_default_instance="atlas-smoke-test",
        whatsapp_max_attachment_bytes=5 * 1024 * 1024,
        whatsapp_require_clamav=False,
    )
    with (
        patch.object(api_main, "get_settings", return_value=settings),
        patch.object(api_main, "get_document", return_value=row),
        patch.object(api_main, "document_pdf_path", return_value=pdf_path),
        patch.object(
            api_main,
            "_fanout_whatsapp_pdf",
            return_value={"sent": True, "pdf_attached": True, "to": "97335000001"},
        ) as fanout,
    ):
        result = api_main._notify_document_whatsapp(
            session,
            document_id=doc_id,
            document_root=tmp_path,
            numbers=["97335000001"],
            prepared_by="admin",
        )
    assert result["sent"] is True
    assert fanout.call_args.kwargs["pdf_bytes"].startswith(b"%PDF")
    assert "Offer Letter" in fanout.call_args.kwargs["text"]
    assert fanout.call_args.kwargs["filename"].endswith(".pdf")
