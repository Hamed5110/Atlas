"""Template catalog + marketing digest STOP."""

from airfare_management.whatsapp.templates import build_marketing_digest, list_templates, require_template


def test_en_ar_catalog_pairs() -> None:
    names = {t["name"] for t in list_templates()}
    assert "mgr_approval_request_en" in names
    assert "mgr_approval_request_ar" in names
    assert "mgr_bulk_digest_en" in names


def test_digest_includes_stop() -> None:
    text = build_marketing_digest(language="en", lines=["REQ pending"])
    assert "STOP" in text
    assert "MARKETING" not in text  # body is plain; category is separate


def test_require_template_language() -> None:
    tpl = require_template("mgr_approval_request_en", "en")
    assert tpl.cloud_only is True
    try:
        require_template("mgr_approval_request_en", "ar")
        raise AssertionError("expected mismatch")
    except ValueError as exc:
        assert str(exc) == "template_language_mismatch"
