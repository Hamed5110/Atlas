"""Arabic PDF shaping for xhtml2pdf (visual order + mixed EN/AR)."""

from airfare_management.application.documents import (
    _flatten_ltr_islands,
    _reshape_arabic_in_html,
    _shape_arabic,
)


def test_shape_arabic_title_uses_presentation_forms() -> None:
    shaped = _shape_arabic("خطاب العرض")
    assert shaped != "خطاب العرض"
    # Presentation-form letters live in the Arabic Presentation Forms-B block.
    assert any("\uFE70" <= ch <= "\uFEFF" for ch in shaped)


def test_shape_arabic_keeps_latin_islands_in_visual_order() -> None:
    shaped = _shape_arabic(
        "نيابةً عن شركة Atlas Aluminum ذ.م.م، يسعدني أن أقدم لكم عرض عمل لوظيفة "
        "Customer Account Controller."
    )
    assert "Atlas Aluminum" in shaped
    assert "Customer Account Controller" in shaped
    # Visual order: Latin job title appears before the Arabic company clause.
    assert shaped.index("Customer Account Controller") < shaped.index("Atlas Aluminum")


def test_flatten_ltr_islands_inlines_latin_for_whole_run_reshape() -> None:
    html = (
        '<p class="ar">رقم الوثيقة <span dir="ltr" class="ltr-iso">OFL-0001</span></p>'
    )
    flat = _flatten_ltr_islands(html)
    assert "OFL-0001" in flat
    assert "span" not in flat.lower()
    shaped_html = _reshape_arabic_in_html(html)
    assert "OFL-0001" in shaped_html


def test_reshape_preserves_english_date_order() -> None:
    html = (
        '<td class="ar-side">التاريخ '
        '<span dir="ltr" class="ltr-iso">05 September 2026</span></td>'
    )
    shaped = _reshape_arabic_in_html(html)
    assert "05 September 2026" in shaped
    assert "September 2026 05" not in shaped


def test_chromium_offer_pdf_keeps_logical_arabic_when_available() -> None:
    from airfare_management.application.documents import (
        _find_chromium_executable,
        _render_pdf_chromium,
    )

    if _find_chromium_executable() is None:
        return
    html = """<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <style>
    @page { size: A4; margin: 12mm; }
    .ar { font-family: DocArabic, sans-serif; direction: rtl; text-align: right; font-size: 14pt; }
    .ltr-iso { direction: ltr; unicode-bidi: isolate; }
    </style></head><body>
    <p class="ar">خطاب العرض</p>
    <p class="ar">رقم الوثيقة <span dir="ltr" class="ltr-iso">OFL-0001</span></p>
    </body></html>"""
    pdf = _render_pdf_chromium(html)
    assert pdf.startswith(b"%PDF")
    import pymupdf

    text = pymupdf.open(stream=pdf, filetype="pdf")[0].get_text()
    assert "خطاب العرض" in text
    assert "OFL-0001" in text
