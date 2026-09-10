"""Red Team surfaces H/I — error_class + outbound taxonomy."""

from __future__ import annotations

from airfare_management.api.error_taxonomy import (
    classify_error_class,
    classify_outbound_status,
    with_outbound_status,
)
from airfare_management.domain.models import DomainError


def test_domain_error_defaults_to_business_rule() -> None:
    assert classify_error_class("company_mismatch", status=422) == "business_rule"
    assert classify_error_class("footer_overflow", status=422) == "business_rule"
    assert classify_error_class("stale_version", status=409) == "business_rule"
    assert classify_error_class("forbidden", status=403) == "business_rule"


def test_infrastructure_codes_and_5xx() -> None:
    assert classify_error_class("pdf_missing", status=503) == "infrastructure_retryable"
    assert classify_error_class("evolution_unreachable", status=503) == "infrastructure_retryable"
    assert classify_error_class("anything", status=500) == "infrastructure_retryable"
    assert (
        classify_error_class("custom", status=422, explicit="infrastructure_retryable")
        == "infrastructure_retryable"
    )


def test_domain_error_carries_explicit_class() -> None:
    err = DomainError(
        "pdf_missing",
        "missing",
        error_class="infrastructure_retryable",
    )
    assert err.error_class == "infrastructure_retryable"
    assert classify_error_class(err.code, status=503, explicit=err.error_class) == (
        "infrastructure_retryable"
    )


def test_outbound_taxonomy_matrix() -> None:
    assert (
        classify_outbound_status(sent=False, skipped="evolution_disabled") == "config_missing"
    )
    assert classify_outbound_status(sent=False, skipped="no_number") == "config_missing"
    assert classify_outbound_status(sent=False, skipped="no_instance") == "config_missing"
    assert (
        classify_outbound_status(
            sent=False,
            queued=True,
            state="close",
            error="WhatsApp session 'x' is offline. scan QR",
            instance="x",
        )
        == "config_missing"
    )
    assert (
        classify_outbound_status(sent=False, error="Number not on WhatsApp")
        == "user_unreachable"
    )
    assert (
        classify_outbound_status(sent=False, error="Evolution POST failed (502)", queued=True)
        == "provider_reject"
    )
    assert classify_outbound_status(sent=True) == "success"


def test_with_outbound_status_enriches_results() -> None:
    payload = with_outbound_status(
        {
            "sent": False,
            "skipped": "evolution_disabled",
            "results": [{"to": "97300000000", "sent": False}],
        }
    )
    assert payload["outbound_status"] == "config_missing"
    assert payload["results"][0]["outbound_status"] == "config_missing"
