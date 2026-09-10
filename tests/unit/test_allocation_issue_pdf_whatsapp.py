"""Unit tests: Issue attaches A4 print PDF via Evolution send_media (base64)."""

from __future__ import annotations

import base64
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from airfare_management.api import main as api_main
from airfare_management.whatsapp.gates import validate_attachment_bytes


MINIMAL_PDF = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def test_gate_accepts_minimal_allocation_pdf() -> None:
    result = validate_attachment_bytes(
        MINIMAL_PDF,
        declared_mime="application/pdf",
        filename="airfare-allocation-E0001-T-000028.pdf",
        max_bytes=5 * 1024 * 1024,
    )
    assert result.mediatype == "document"
    assert result.mime == "application/pdf"


def test_notify_sends_text_then_media_base64(tmp_path: Path) -> None:
    ticket = SimpleNamespace(
        id=str(uuid4()),
        ticket_code="T-000028",
        ticket_number=28,
        travel_date=date(2026, 9, 8),
        origin_code="BAH",
        destination_code="DXB",
        ticket_cost=Decimal("120.000"),
        entitlement=Decimal("100.000"),
        excess_cost=Decimal("20.000"),
        excess_handling="SELF_PAID",
        company_paid=Decimal("100.000"),
        company_payout=Decimal("100.000"),
        employee_payable=Decimal("20.000"),
        as_of_date=date(2026, 9, 8),
        tenure_months=None,
        status="approved",
        notes="Approval authority: Mgr",
        rate_source="pay_group",
        daily_rate=Decimal("1"),
        airfare_rate=Decimal("365"),
        scenario="A",
        employee_id=uuid4(),
    )
    employee = SimpleNamespace(
        code="E0001",
        full_name="Test Employee",
        arabic_name="",
        nationality="BH",
        department="IT",
        designation="Engineer",
        pay_group="PG1",
        branch="HQ",
        join_date=date(2020, 1, 1),
        company_id="company-1",
        reporting_officer_id=None,
    )
    attachment = SimpleNamespace(id="att-1")

    client = MagicMock()
    client.resolve_open_instance.return_value = ("atlas-smoke-test", "open")
    client.send_text.return_value = {"ok": True}
    client.send_media.return_value = {"ok": True}

    settings = SimpleNamespace(
        evolution_enabled=True,
        evolution_api_key="test-key",
        evolution_base_url="http://127.0.0.1:8080",
        whatsapp_default_instance="atlas-smoke-test",
        whatsapp_max_attachment_bytes=5 * 1024 * 1024,
        whatsapp_require_clamav=False,
    )

    with (
        patch.object(api_main, "get_settings", return_value=settings),
        patch.object(
            api_main,
            "_render_and_persist_issue_pdf",
            return_value={
                "pdf_attached": False,
                "attachment_id": attachment.id,
                "pdf_bytes": len(MINIMAL_PDF),
                "pdf_filename": "airfare-allocation-E0001-T-000028.pdf",
                "pdf_b64": base64.b64encode(MINIMAL_PDF).decode("ascii"),
                "pdf_error": None,
            },
        ),
        patch(
            "airfare_management.whatsapp.client.EvolutionClient",
            return_value=client,
        ),
        patch("airfare_management.whatsapp.events.set_instance_meta"),
        patch("airfare_management.whatsapp.events.push_event"),
        patch("airfare_management.whatsapp.events.drain_outbox", return_value=[]),
    ):
        result = api_main._notify_allocation_whatsapp(
            manager_wa="97335000000",
            approval_ref="Mgr Test",
            ticket=ticket,  # type: ignore[arg-type]
            employee=employee,  # type: ignore[arg-type]
            session=MagicMock(),
            attachment_root=tmp_path,
            linked_loan=None,
            prepared_by="admin",
        )

    assert result["sent"] is True
    assert result["pdf_attached"] is True
    assert result["attachment_id"] == "att-1"
    assert "pdf_b64" not in result
    client.send_text.assert_called_once()
    client.send_media.assert_called_once()
    kwargs = client.send_media.call_args.kwargs
    assert kwargs["mediatype"] == "document"
    assert kwargs["mimetype"] == "application/pdf"
    assert kwargs["file_name"].endswith(".pdf")
    decoded = base64.b64decode(kwargs["media"])
    assert decoded.startswith(b"%PDF")


def test_notify_offline_queues_text_keeps_pdf_meta(tmp_path: Path) -> None:
    ticket = SimpleNamespace(
        id=str(uuid4()),
        ticket_code="T-000029",
        ticket_number=29,
        travel_date=date(2026, 9, 8),
        origin_code="BAH",
        destination_code="CAI",
        ticket_cost=Decimal("80"),
        entitlement=Decimal("80"),
        excess_cost=Decimal("0"),
        excess_handling="SELF_PAID",
        company_paid=Decimal("80"),
        company_payout=Decimal("80"),
        employee_payable=Decimal("0"),
        as_of_date=date(2026, 9, 8),
        tenure_months=None,
        status="approved",
        notes="",
        rate_source=None,
        daily_rate=None,
        airfare_rate=None,
        scenario=None,
        employee_id=uuid4(),
    )
    client = MagicMock()
    client.resolve_open_instance.side_effect = [
        ("lab-ops-bh-01", "connecting"),
        ("lab-ops-bh-01", "connecting"),
        (None, "none"),
    ]
    settings = SimpleNamespace(
        evolution_enabled=True,
        evolution_api_key="test-key",
        evolution_base_url="http://127.0.0.1:8080",
        whatsapp_default_instance="lab-ops-bh-01",
        whatsapp_max_attachment_bytes=5 * 1024 * 1024,
        whatsapp_require_clamav=False,
    )
    with (
        patch.object(api_main, "get_settings", return_value=settings),
        patch.object(
            api_main,
            "_render_and_persist_issue_pdf",
            return_value={
                "pdf_attached": False,
                "attachment_id": "att-stored",
                "pdf_bytes": 100,
                "pdf_filename": "x.pdf",
                "pdf_b64": base64.b64encode(MINIMAL_PDF).decode("ascii"),
                "pdf_error": None,
            },
        ),
        patch(
            "airfare_management.whatsapp.client.EvolutionClient",
            return_value=client,
        ),
        patch(
            "airfare_management.whatsapp.events.enqueue_outbox",
            return_value={"id": "ob-1"},
        ),
    ):
        result = api_main._notify_allocation_whatsapp(
            manager_wa="97335000000",
            approval_ref="",
            ticket=ticket,  # type: ignore[arg-type]
            employee=None,
            session=MagicMock(),
            attachment_root=tmp_path,
        )

    assert result["sent"] is False
    assert result["queued"] is True
    assert result["pdf_attached"] is False
    assert result["attachment_id"] == "att-stored"
    client.send_media.assert_not_called()


def test_parse_whatsapp_recipients_dedupes_and_caps() -> None:
    nums = api_main._parse_whatsapp_recipients(
        "97335000001\n97335000002",
        ["97335000001", "97335000003", "123", "97335000004", "97335000005", "97335000006"],
    )
    assert nums == [
        "97335000001",
        "97335000002",
        "97335000003",
        "97335000004",
        "97335000005",
    ]


def test_notify_fans_out_to_multiple_numbers(tmp_path: Path) -> None:
    ticket = SimpleNamespace(
        id=str(uuid4()),
        ticket_code="T-000030",
        ticket_number=30,
        travel_date=date(2026, 9, 8),
        origin_code="BAH",
        destination_code="DXB",
        ticket_cost=Decimal("100"),
        entitlement=Decimal("100"),
        excess_cost=Decimal("0"),
        excess_handling="SELF_PAID",
        company_paid=Decimal("100"),
        company_payout=Decimal("100"),
        employee_payable=Decimal("0"),
        as_of_date=date(2026, 9, 8),
        tenure_months=None,
        status="approved",
        notes="",
        rate_source=None,
        daily_rate=None,
        airfare_rate=None,
        scenario=None,
        employee_id=uuid4(),
    )
    client = MagicMock()
    client.resolve_open_instance.return_value = ("atlas-smoke-test", "open")
    settings = SimpleNamespace(
        evolution_enabled=True,
        evolution_api_key="test-key",
        evolution_base_url="http://127.0.0.1:8080",
        whatsapp_default_instance="atlas-smoke-test",
        whatsapp_max_attachment_bytes=5 * 1024 * 1024,
        whatsapp_require_clamav=False,
    )
    with (
        patch.object(api_main, "get_settings", return_value=settings),
        patch("airfare_management.api.main.time.sleep") as sleep_mock,
        patch.object(
            api_main,
            "_render_and_persist_issue_pdf",
            return_value={
                "pdf_attached": False,
                "attachment_id": "att-m",
                "pdf_bytes": len(MINIMAL_PDF),
                "pdf_filename": "m.pdf",
                "pdf_b64": base64.b64encode(MINIMAL_PDF).decode("ascii"),
                "pdf_error": None,
            },
        ),
        patch(
            "airfare_management.whatsapp.client.EvolutionClient",
            return_value=client,
        ),
        patch("airfare_management.whatsapp.events.set_instance_meta"),
        patch("airfare_management.whatsapp.events.push_event"),
        patch("airfare_management.whatsapp.events.drain_outbox", return_value=[]),
    ):
        result = api_main._notify_allocation_whatsapp(
            manager_wa=["97335000001", "97335000002"],
            approval_ref="Mgr",
            ticket=ticket,  # type: ignore[arg-type]
            employee=None,
            session=MagicMock(),
            attachment_root=tmp_path,
            purpose="update",
            trip_type="ROUND_TRIP",
        )

    assert result["sent"] is True
    assert result["recipients"] == ["97335000001", "97335000002"]
    assert client.send_text.call_count == 2
    assert client.send_media.call_count == 2
    assert sleep_mock.call_count == 1
    assert result["pdf_attached"] is True
