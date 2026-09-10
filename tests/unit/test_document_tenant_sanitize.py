"""Sprint-critical: tenant binding + printable-field sanitization."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from airfare_management.application.documents import (
    sanitize_printable_field,
    _assert_employee_arabic_for_issue,
    _company_profile,
    _resolve_company_id,
)
from airfare_management.domain.models import DomainError


class _FakeSession:
    def __init__(self, companies: dict[str, object], employees: dict[str, object] | None = None):
        self._companies = companies
        self._employees = employees or {}

    def get(self, model, key):  # noqa: ANN001
        name = getattr(model, "__name__", str(model))
        if "Company" in name:
            return self._companies.get(str(key))
        if "Employee" in name:
            return self._employees.get(str(key))
        return None


def test_sanitize_strips_crlf_and_format_tokens() -> None:
    raw = "Ali\r\nIssued OK %s %n %x Khan"
    cleaned = sanitize_printable_field(raw, limit=200)
    assert "\r" not in cleaned and "\n" not in cleaned
    assert "%s" not in cleaned and "%n" not in cleaned and "%x" not in cleaned
    assert "Ali" in cleaned and "Khan" in cleaned
    assert cleaned.count(" ") >= 1


def test_sanitize_keeps_arabic_letters() -> None:
    text = sanitize_printable_field("شركة أطلس ألمنيوم", limit=80)
    assert "أطلس" in text or "اطلس" in text or "شركة" in text


def test_resolve_rejects_employee_company_mismatch() -> None:
    company_a = str(uuid4())
    company_b = str(uuid4())
    session = _FakeSession(
        companies={company_a: object(), company_b: object()},
    )
    employee = SimpleNamespace(company_id=company_a)
    with pytest.raises(DomainError) as exc:
        _resolve_company_id(
            session,  # type: ignore[arg-type]
            company_id=__import__("uuid").UUID(company_b),
            employee=employee,  # type: ignore[arg-type]
        )
    assert exc.value.code == "company_mismatch"


def test_resolve_locks_voucher_company_on_update() -> None:
    company_a = str(uuid4())
    company_b = str(uuid4())
    session = _FakeSession(companies={company_a: object(), company_b: object()})
    with pytest.raises(DomainError) as exc:
        _resolve_company_id(
            session,  # type: ignore[arg-type]
            company_id=__import__("uuid").UUID(company_b),
            locked_company_id=company_a,
        )
    assert exc.value.code == "company_mismatch"
    assert (
        _resolve_company_id(
            session,  # type: ignore[arg-type]
            company_id=__import__("uuid").UUID(company_a),
            locked_company_id=company_a,
        )
        == company_a
    )


def test_company_profile_blocks_missing_arabic_on_issue() -> None:
    cid = str(uuid4())
    company = SimpleNamespace(
        name="Unknown Holdings LLC",
        arabic_name="",
        code="UH",
        currency="BHD",
        cr_no="123",
        address="Manama",
    )
    session = _FakeSession(companies={cid: company})
    with pytest.raises(DomainError) as exc:
        _company_profile(session, cid, require_arabic=True)  # type: ignore[arg-type]
    assert exc.value.code == "arabic_name_required"
    degraded = _company_profile(session, cid, require_arabic=False)  # type: ignore[arg-type]
    assert degraded["arabic_name_degraded"] is True
    assert degraded["arabic_name"] == "Unknown Holdings LLC"


def test_employee_arabic_required_on_issue() -> None:
    with pytest.raises(DomainError) as exc:
        _assert_employee_arabic_for_issue({"arabic_name": ""})
    assert exc.value.code == "arabic_name_required"
    _assert_employee_arabic_for_issue({"arabic_name": "أحمد المنصوري"})
