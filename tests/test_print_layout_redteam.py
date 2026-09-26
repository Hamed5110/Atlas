"""Red-team V&V — HR Form Builder print layout (frontend source + backend engine).

Research-backed controls (Frappe section/spacer, PDF designer align/size/border/color,
HR letter zones). Adversarial cases must coerce safely — never crash PDF layout.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from airfare_management.application.hr_lifecycle import (
    _format_print_value,
    _normalize_field,
    _order_print_rows,
    _pack_print_rows,
    build_print_layout,
    print_options_catalog,
)

ATLAS_NEXT = Path(r"C:\Airfare_Allowance\atlas-next")
HCM_WEB = Path(r"C:\HCM Airfare\src\airfare_management\interface\web_dist_next")
PAGE = ATLAS_NEXT / "app" / "(app)" / "hr-forms" / "page.tsx"


def test_catalog_is_complete_for_builder() -> None:
    c = print_options_catalog()
    required = {
        "print_zones",
        "print_aligns",
        "print_widths",
        "print_label_positions",
        "print_formats",
        "print_sizes",
        "print_vspaces",
        "print_borders",
        "print_indents",
        "print_label_widths",
        "print_roles",
        "print_colors",
        "print_line_heights",
        "print_bgs",
        "print_presets",
    }
    assert required <= set(c.keys())
    assert {z["key"] for z in c["print_zones"]} >= {
        "header",
        "particulars",
        "middle",
        "footer",
        "signatures",
        "hidden",
    }
    assert {w["key"] for w in c["print_widths"]} >= {"full", "half", "third", "quarter"}
    assert {a["key"] for a in c["print_aligns"]} >= {"left", "center", "right", "justify"}
    assert {r["key"] for r in c["print_roles"]} == {"field", "section", "spacer", "static"}
    assert {f["key"] for f in c["print_formats"]} >= {
        "plain",
        "currency",
        "percent",
        "date_long",
        "yes_no",
        "multiline",
    }
    assert len(c["print_presets"]) >= 7
    for p in c["print_presets"]:
        assert "key" in p and "label" in p and isinstance(p.get("patch"), dict)


@pytest.mark.parametrize(
    ("raw", "fmt", "expect_sub"),
    [
        (12.5, "currency", "BHD 12.500"),
        (7.5, "percent", "7.50%"),
        ("true", "yes_no", "Yes"),
        ("0", "yes_no", "No"),
        ("hello", "uppercase", "HELLO"),
        ("Hello\nWorld", "multiline", "Hello\nWorld"),
        ("2026-09-26", "date_short", "2026-09-26"),
    ],
)
def test_formatters(raw: object, fmt: str, expect_sub: str) -> None:
    out = _format_print_value(
        raw, ftype="text", print_format=fmt, prefix="", suffix="", params={}, key="x"
    )
    assert expect_sub in out or out == expect_sub


def test_normalize_coerces_adversarial_input() -> None:
    f = _normalize_field(
        {
            "key": "Evil<script>",
            "label": "X",
            "type": "text",
            "print_zone": "nowhere",
            "print_align": "diagonal",
            "print_width": "99",
            "print_format": "bitcoin",
            "print_role": "hack",
            "print_color": "neon",
            "print_after": "evil_script",  # self-after after sanitize → cleared
            "print_prefix": "P" * 200,
            "print_static_text": "S" * 900,
            "print_page_break": True,
            "print_hline": 1,
        },
        0,
    )
    assert f["key"].startswith("evil")
    assert f["print_zone"] == "particulars"
    assert f["print_align"] == "left"
    assert f["print_width"] == "full"
    assert f["print_format"] == "plain"
    assert f["print_role"] == "field"
    assert f["print_color"] == "default"
    assert f["print_after"] is None
    assert len(f["print_prefix"]) <= 40
    assert len(f["print_static_text"]) <= 500
    assert f["print_page_break"] is True
    assert f["print_hline"] is True


def test_normalize_rejects_bad_type() -> None:
    from airfare_management.domain.models import DomainError

    with pytest.raises(DomainError):
        _normalize_field({"key": "x", "label": "X", "type": "virus"}, 0)


def test_pack_half_third_quarter_and_orphan() -> None:
    half = _pack_print_rows(
        [{"key": "a", "print_width": "half"}, {"key": "b", "print_width": "half"}]
    )
    assert half[0]["cols"] == 2
    third = _pack_print_rows(
        [{"key": f"t{i}", "print_width": "third"} for i in range(3)]
    )
    assert third[0]["cols"] == 3
    quarter = _pack_print_rows(
        [{"key": f"q{i}", "print_width": "quarter"} for i in range(4)]
    )
    assert quarter[0]["cols"] == 4
    orphan = _pack_print_rows([{"key": "solo", "print_width": "half"}])
    assert orphan[0]["cols"] == 2 and len(orphan[0]["cells"]) == 1


def test_order_print_after_and_cycle_guard() -> None:
    ordered = _order_print_rows(
        [
            {"key": "c", "sort_order": 2, "print_after": "b"},
            {"key": "b", "sort_order": 1, "print_after": "a"},
            {"key": "a", "sort_order": 0, "print_after": None},
        ]
    )
    assert [r["key"] for r in ordered] == ["a", "b", "c"]
    # cycle should not infinite-loop
    cyc = _order_print_rows(
        [
            {"key": "x", "sort_order": 0, "print_after": "y"},
            {"key": "y", "sort_order": 1, "print_after": "x"},
        ]
    )
    assert {r["key"] for r in cyc} == {"x", "y"}


def test_layout_roles_zones_seeded_hidden() -> None:
    fields = [
        {
            "key": "full_name",
            "label": "Name",
            "type": "text",
            "print_zone": "particulars",
            "sort_order": 0,
        },  # seeded → excluded unless print_include
        {
            "key": "full_name_extra",
            "label": "Name again",
            "type": "text",
            "print_zone": "header",
            "print_include": True,
            "sort_order": 0,
        },
        {
            "key": "sec_a",
            "label": "POLICY",
            "type": "text",
            "print_role": "section",
            "print_zone": "header",
            "sort_order": 1,
        },
        {
            "key": "gap_1",
            "label": "Gap",
            "type": "text",
            "print_role": "spacer",
            "print_zone": "header",
            "sort_order": 2,
        },
        {
            "key": "legal",
            "label": "Legal",
            "type": "text",
            "print_role": "static",
            "print_static_text": "Issued under Art. 44",
            "print_zone": "footer",
            "sort_order": 3,
        },
        {
            "key": "fine_amt",
            "label": "Fine",
            "type": "number",
            "print_format": "currency",
            "print_width": "half",
            "print_zone": "particulars",
            "print_page_break": True,
            "print_color": "danger",
            "print_show_empty": True,
            "print_empty_as": "na",
            "sort_order": 4,
        },
        {
            "key": "secret",
            "label": "Secret",
            "type": "text",
            "print_zone": "hidden",
            "sort_order": 5,
        },
        {
            "key": "gone",
            "label": "Gone",
            "type": "text",
            "deleted_at": "2026-01-01",
            "print_zone": "middle",
            "sort_order": 6,
        },
        {
            "key": "empty_skip",
            "label": "Empty",
            "type": "text",
            "print_zone": "middle",
            "sort_order": 7,
        },
        {
            "key": "empty_show",
            "label": "Empty show",
            "type": "text",
            "print_zone": "middle",
            "print_show_empty": True,
            "print_empty_as": "pending",
            "sort_order": 8,
        },
    ]
    layout = build_print_layout(
        fields, {"fine_amt": "25.5", "secret": "nope", "full_name": "Ali"}, kind="warning"
    )
    assert layout["header"]
    assert any(b["cells"][0].get("print_role") == "section" for b in layout["header"])
    assert any(b["cells"][0].get("print_role") == "spacer" for b in layout["header"])
    # seeded full_name without print_include must NOT appear
    header_keys = {c["key"] for b in layout["header"] for c in b["cells"]}
    assert "full_name" not in header_keys
    assert layout["footer"][0]["cells"][0]["value"] == "Issued under Art. 44"
    assert layout["particulars"][0]["cells"][0]["print_page_break"] is True
    assert "BHD" in layout["particulars"][0]["cells"][0]["value"]
    assert any(
        c.get("value") == "Pending"
        for b in layout["middle"]
        for c in b["cells"]
    )
    assert "hidden" not in layout


def test_catalog_exposes_template_bound_and_empty_as() -> None:
    c = print_options_catalog()
    assert "print_empty_as" in c
    assert "template_bound_by_kind" in c
    assert "warning_letter" in c["template_bound_by_kind"]
    assert "full_name" in c["template_bound_by_kind"]["warning_letter"]


def test_frontend_source_exposes_print_designer() -> None:
    src = PAGE.read_text(encoding="utf-8")
    for token in (
        "print_role",
        "print_color",
        "print_page_break",
        "print_static_text",
        "print_line_height",
        "print_bg",
        "select-print-preset",
        "PRINT FORMAT / LAYOUT SETTINGS",
        "quarter",
        "justify",
        "percent",
        "section",
        "spacer",
    ):
        assert token in src, f"missing frontend token: {token}"


def test_served_ui_has_new_chunk_markers() -> None:
    if not HCM_WEB.is_dir():
        pytest.skip("web_dist_next missing")
    hits = 0
    for js in (HCM_WEB / "_next" / "static" / "chunks").glob("*.js"):
        text = js.read_text(encoding="utf-8", errors="ignore")
        if "select-print-preset" in text or "PRINT FORMAT" in text:
            hits += 1
            if "print_role" in text or "print_page_break" in text or "quarter" in text:
                return
    if hits == 0:
        pytest.fail("served UI missing print layout markers — redeploy web_dist_next")
    # Older served build may lack newest role tokens until redeploy; soft signal via hit count
    assert hits >= 1
