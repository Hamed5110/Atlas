"""Safe Excel interchange and PDF reporting services."""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_PRINT_ASSETS = Path(__file__).resolve().parent / "print_assets"
_ATLAS_LOGO = _PRINT_ASSETS / "atlas_logo.png"
_ATLAS_FOOTER = _PRINT_ASSETS / "atlas_footer.png"
_ATLAS_WATERMARK = _PRINT_ASSETS / "atlas_watermark.png"

EMPLOYEE_COLUMNS = ("code", "full_name", "company_id", "join_date", "department", "branch", "email")

OPENING_BALANCE_ALIASES: dict[str, tuple[str, ...]] = {
    "employee_code": ("employee_code", "code", "employeecode", "employee"),
    "balance_year": ("balance_year", "year", "balanceyear"),
    "opening_days": ("opening_days", "openingdays", "days"),
    "paid_days": ("paid_days", "paiddays"),
    "opening_amount": ("opening_amount", "openingamount", "opening_bhd", "openingbhd", "amount"),
    "maximum_payout": ("maximum_payout", "maximumpayout", "max_payout", "maxpayout"),
}


def _normalize_headers(headers: tuple[str, ...]) -> dict[str, str]:
    """Map workbook headers to canonical field names."""
    mapping: dict[str, str] = {}
    for header in headers:
        normalized = header.strip().lower().replace(" ", "_")
        for canonical, aliases in OPENING_BALANCE_ALIASES.items():
            if normalized in aliases:
                mapping[canonical] = header
                break
        else:
            mapping.setdefault(normalized, header)
    return mapping


def _canonicalize_record(headers: tuple[str, ...], values: tuple[Any, ...]) -> dict[str, Any]:
    """Normalize a workbook row to canonical opening-balance field names."""
    header_map = _normalize_headers(headers)
    raw = dict(zip(headers, values, strict=False))
    record: dict[str, Any] = {}
    for canonical in OPENING_BALANCE_ALIASES:
        source_header = header_map.get(canonical)
        if source_header is not None and source_header in raw:
            record[canonical] = raw[source_header]
    for key, value in raw.items():
        normalized = key.strip().lower().replace(" ", "_")
        if normalized not in record and normalized in OPENING_BALANCE_ALIASES:
            record[normalized] = value
    return record


def export_workbook(title: str, columns: Sequence[str], rows: Iterable[Mapping[str, Any]]) -> bytes:
    """Build a styled XLSX workbook entirely in memory."""
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.title = title[:31]
    sheet.append(list(columns))
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1F4E78")
    for row in rows:
        values: list[Any] = []
        for column in columns:
            value = row.get(column, "")
            if isinstance(value, str) and value[:1] in {"=", "+", "-", "@"}:
                value = f"'{value}"
            values.append(value)
        sheet.append(values)
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    for column_number, column_cells in enumerate(sheet.columns, start=1):
        width = min(50, max(12, *(len(str(cell.value or "")) + 2 for cell in column_cells)))
        sheet.column_dimensions[get_column_letter(column_number)].width = width
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def parse_employee_workbook(content: bytes, max_rows: int = 10_000) -> list[dict[str, Any]]:
    """Parse and validate an employee XLSX file without formulas."""
    workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    sheet = workbook.active
    assert sheet is not None
    rows = sheet.iter_rows(values_only=True)
    try:
        headers = tuple(str(value or "").strip().lower() for value in next(rows))
    except StopIteration as exc:
        raise ValueError("The workbook is empty.") from exc
    missing = set(EMPLOYEE_COLUMNS[:4]) - set(headers)
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}.")
    result: list[dict[str, Any]] = []
    for row_number, values in enumerate(rows, start=2):
        if row_number > max_rows + 1:
            raise ValueError(f"Import exceeds the {max_rows} row limit.")
        record = dict(zip(headers, values, strict=False))
        if not any(value is not None for value in values):
            continue
        record["_row"] = row_number
        result.append(record)
    return result


def parse_opening_balance_workbook(content: bytes, max_rows: int = 10_000) -> list[dict[str, Any]]:
    """Parse and validate an opening-balance XLSX file without formulas."""
    workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    sheet = workbook.active
    assert sheet is not None
    rows = sheet.iter_rows(values_only=True)
    try:
        headers = tuple(str(value or "").strip().lower() for value in next(rows))
    except StopIteration as exc:
        raise ValueError("The workbook is empty.") from exc
    header_map = _normalize_headers(headers)
    required = ("employee_code", "balance_year", "opening_days")
    missing = [field for field in required if field not in header_map]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}.")
    result: list[dict[str, Any]] = []
    for row_number, values in enumerate(rows, start=2):
        if row_number > max_rows + 1:
            raise ValueError(f"Import exceeds the {max_rows} row limit.")
        if not any(value is not None for value in values):
            continue
        record = _canonicalize_record(headers, values)
        record["_row"] = row_number
        result.append(record)
    return result


DEFAULT_TEMPLATE_COMPANY_ID = "11111111-1111-1111-1111-111111111111"


@dataclass(frozen=True, slots=True)
class ImportTemplateSpec:
    """Workbook template metadata for a screen or report."""

    title: str
    sheet_name: str
    columns: tuple[str, ...]
    sample_rows: tuple[tuple[Any, ...], ...]
    instructions: tuple[str, ...]


def _template_specs(company_id: str) -> dict[str, ImportTemplateSpec]:
    """Return screen templates with contextual sample values."""
    today = date.today().isoformat()
    year = date.today().year
    return {
        "employees": ImportTemplateSpec(
            title="Employee Master Import",
            sheet_name="Employees",
            columns=(
                "code",
                "full_name",
                "company_id",
                "join_date",
                "department",
                "branch",
                "pay_group",
                "email",
            ),
            sample_rows=(
                (
                    "EMP001",
                    "Jane Doe",
                    company_id,
                    "2024-01-15",
                    "Finance",
                    "HQ",
                    "PG1",
                    "jane.doe@example.com",
                ),
                (
                    "EMP002",
                    "John Smith",
                    company_id,
                    "2025-06-01",
                    "Operations",
                    "Branch A",
                    "PG2",
                    "john.smith@example.com",
                ),
            ),
            instructions=(
                "Required columns: code, full_name, company_id, join_date.",
                "Import using Employees → Import Excel → verify → select rows → import.",
                "Employee codes must be unique per company.",
                "Use the bootstrap company_id unless importing for another company.",
            ),
        ),
        "opening-balances": ImportTemplateSpec(
            title="Opening Balance Import",
            sheet_name="Opening Balances",
            columns=(
                "employee_code",
                "balance_year",
                "opening_days",
                "paid_days",
                "opening_amount",
                "maximum_payout",
            ),
            sample_rows=(
                ("EMP001", year, 20, 0, 8.22, 150),
                ("EMP002", year, 15, 5, 6.16, 150),
            ),
            instructions=(
                "Required columns: employee_code, balance_year, opening_days.",
                "Employee codes must already exist in Employee Master.",
                "Leave opening_amount blank to calculate from global rate/days preferences.",
                "Import using Opening Balances → Import Excel → verify → select → import.",
            ),
        ),
        "tickets": ImportTemplateSpec(
            title="Ticket Register Template",
            sheet_name="Tickets",
            columns=(
                "employee_code",
                "travel_date",
                "origin_code",
                "destination_code",
                "ticket_cost",
                "entitlement",
                "company_paid",
                "excess_handling",
                "notes",
            ),
            sample_rows=(
                ("EMP001", today, "BAH", "DXB", 120, 100, 120, "SELF_PAID", "Sample ticket"),
                ("EMP002", today, "BAH", "LHR", 450, 150, 300, "CONVERT_TO_LOAN", "Excess sample"),
            ),
            instructions=(
                "Use this template as a bulk-entry reference for ticket records.",
                "excess_handling must be SELF_PAID, COMPANY_PAID, CONVERT_TO_LOAN, or ENTITLEMENT_AMOUNT.",
                "Create tickets individually in the Tickets screen or via API.",
            ),
        ),
        "loans": ImportTemplateSpec(
            title="Loan Register Template",
            sheet_name="Loans",
            columns=(
                "employee_code",
                "principal",
                "annual_rate",
                "installments",
                "first_due_date",
                "notes",
            ),
            sample_rows=(
                ("EMP002", 250, 0.05, 12, today, "Airfare excess recovery"),
            ),
            instructions=(
                "Use employee_code values from Employee Master.",
                "annual_rate is decimal (0.05 = 5%).",
                "Loans are normally created from ticket excess conversion.",
            ),
        ),
        "ess-requests": ImportTemplateSpec(
            title="ESS Request Template",
            sheet_name="ESS Requests",
            columns=(
                "employee_code",
                "request_type",
                "travel_date",
                "origin_code",
                "destination_code",
                "notes",
            ),
            sample_rows=(
                ("EMP001", "airfare", today, "BAH", "DXB", "Annual leave travel"),
                ("EMP001", "ticket", today, "BAH", "CAI", "Family visit"),
            ),
            instructions=(
                "request_type must be airfare, ticket, or loan.",
                "Submit requests individually in Employee Self Service.",
            ),
        ),
        "lookups": ImportTemplateSpec(
            title="Lookup Values Template",
            sheet_name="Lookups",
            columns=("lookup_type", "code", "name"),
            sample_rows=(
                ("departments", "FIN", "Finance"),
                ("pay_groups", "PG1", "Pay Group 1"),
                ("repair_centers", "HQ", "Head Office"),
            ),
            instructions=(
                "lookup_type examples: departments, pay_groups, repair_centers.",
                "Add lookup values in Administration or via API.",
            ),
        ),
        "entitlement-rates": ImportTemplateSpec(
            title="Entitlement Rate Template",
            sheet_name="Entitlement Rates",
            columns=(
                "scope_type",
                "scope_id",
                "amount",
                "effective_from",
                "effective_to",
                "cap_amount",
            ),
            sample_rows=(
                ("global", "", 150, f"{year}-01-01", "", 150),
                ("company", "DEFAULT", 180, f"{year}-01-01", "", 180),
                ("pay_group", "PG1", 150, f"{year}-01-01", "", 150),
                ("employee", "EMP001", 200, f"{year}-06-01", "", 200),
            ),
            instructions=(
                "scope_type must be global, company, pay_group, or employee.",
                "Leave effective_to blank for open-ended rates.",
                "Allocation resolves employee → pay group → company → global on the ticket date.",
            ),
        ),
        "entitlement-preview": ImportTemplateSpec(
            title="Entitlement Preview Template",
            sheet_name="Entitlement Preview",
            columns=(
                "scenario",
                "target_date",
                "allocation_year",
                "opening_days",
                "paid_days",
                "maximum_payout",
                "join_date",
                "previous_allocation_date",
                "current_working_days",
                "carry_forward_cap",
            ),
            sample_rows=(
                (
                    "existing",
                    today,
                    year,
                    20,
                    0,
                    150,
                    "",
                    "",
                    360,
                    30,
                ),
            ),
            instructions=(
                "scenario: existing, new_joiner, mid_year_allocation, carry_forward.",
                "Use the Airfare Allocation screen to calculate entitlement and issue tickets.",
            ),
        ),
        "allocation-preview": ImportTemplateSpec(
            title="Allocation Engine Template",
            sheet_name="Allocation Preview",
            columns=(
                "employee_code",
                "as_of_date",
                "date_of_joining",
                "last_ticket_date",
                "opening_balance_days",
                "opening_balance_amount",
                "requested_ticket_amount",
                "excess_option",
                "tenure_months",
            ),
            sample_rows=(
                ("EMP001", today, "2024-01-15", "", 20, 40, 180, "LOAN", 6),
            ),
            instructions=(
                "ATLAS 30/360 engine: daily rate = max payout / 60.",
                "excess_option: LOAN, COMPANY_PAID, SELF_PAID, or ENTITLEMENT_AMOUNT.",
                "Use the Airfare Allocation screen for live entitlement review, preview and issue.",
            ),
        ),
        "report-employee-master": ImportTemplateSpec(
            title="Employee Master Report",
            sheet_name="Employee Master",
            columns=("Code", "Employee", "Department", "Branch", "Join date", "Email", "Status"),
            sample_rows=(("EMP001", "Jane Doe", "Finance", "HQ", "2024-01-15", "jane@example.com", "Active"),),
            instructions=("Export live data from Reports → Employee Master → Excel.",),
        ),
        "report-opening-balances": ImportTemplateSpec(
            title="Opening Balances Report",
            sheet_name="Opening Balances",
            columns=(
                "Employee",
                "Name",
                "Year",
                "Opening days",
                "Paid days",
                "Opening amount",
                "Maximum payout",
            ),
            sample_rows=(("EMP001", "Jane Doe", year, 20, 0, 8.22, 150),),
            instructions=("Export live data from Reports → Opening Balances → Excel.",),
        ),
        "report-entitlements": ImportTemplateSpec(
            title="Entitlement Rates Report",
            sheet_name="Entitlements",
            columns=("Scope", "Scope ID", "Amount", "Effective from", "Effective to", "Cap"),
            sample_rows=(("global", "", 150, f"{year}-01-01", "", 150),),
            instructions=("Export live entitlement rates from Reports → Entitlement Rates.",),
        ),
        "report-ticket-register": ImportTemplateSpec(
            title="Ticket Register Report",
            sheet_name="Ticket Register",
            columns=(
                "Travel date",
                "Employee",
                "Route",
                "Ticket cost",
                "Entitlement",
                "Company paid",
                "Excess",
                "Status",
            ),
            sample_rows=((today, "EMP001", "BAH-DXB", 120, 100, 120, 20, "approved"),),
            instructions=("Export live ticket register from Reports → Ticket Register.",),
        ),
        "report-loan-outstanding": ImportTemplateSpec(
            title="Loan Outstanding Report",
            sheet_name="Loan Outstanding",
            columns=(
                "Employee",
                "Principal",
                "Outstanding",
                "Monthly installment",
                "Installments",
                "Status",
            ),
            sample_rows=(("EMP002", 250, 180, 21.5, 12, "active"),),
            instructions=("Export live loan balances from Reports → Loan Outstanding.",),
        ),
        "report-excess-recovery": ImportTemplateSpec(
            title="Excess Recovery Report",
            sheet_name="Excess Recovery",
            columns=(
                "Travel date",
                "Employee",
                "Route",
                "Ticket cost",
                "Entitlement",
                "Excess",
                "Status",
            ),
            sample_rows=((today, "EMP002", "BAH-LHR", 450, 150, 300, "approved"),),
            instructions=("Export live excess recovery rows from Reports → Excess Recovery.",),
        ),
        "report-loan-statement": ImportTemplateSpec(
            title="Loan Statement Report",
            sheet_name="Loan Statement",
            columns=(
                "Employee",
                "Loan ID",
                "Date",
                "Description",
                "Debit",
                "Credit",
                "Installment #",
                "Due date",
                "Principal",
                "Interest",
                "Payment",
                "Outstanding",
            ),
            sample_rows=(
                (
                    "EMP002",
                    "loan-sample",
                    today,
                    "Loan opened",
                    250,
                    0,
                    "",
                    today,
                    250,
                    0,
                    0,
                    250,
                ),
                (
                    "EMP002",
                    "loan-sample",
                    today,
                    "EMI 1",
                    21.5,
                    0,
                    1,
                    today,
                    20.42,
                    1.08,
                    21.5,
                    229.58,
                ),
            ),
            instructions=(
                "Export the live loan statement from Reports → Loan Statement.",
                "Debit is the installment due; Credit is a posted recovery payment.",
            ),
        ),
    }


def list_import_templates() -> tuple[str, ...]:
    """Return supported workbook template identifiers."""
    return tuple(_template_specs(DEFAULT_TEMPLATE_COMPANY_ID))


def build_import_template(template_id: str, *, company_id: str = DEFAULT_TEMPLATE_COMPANY_ID) -> bytes:
    """Build a styled import/report template workbook with sample rows and instructions."""
    specs = _template_specs(company_id)
    if template_id not in specs:
        supported = ", ".join(sorted(specs))
        raise ValueError(f"Unknown template '{template_id}'. Supported templates: {supported}.")
    spec = specs[template_id]
    workbook = Workbook()
    data_sheet = workbook.active
    assert data_sheet is not None
    data_sheet.title = spec.sheet_name[:31]
    data_sheet.append(list(spec.columns))
    for cell in data_sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1F4E78")
    for row in spec.sample_rows:
        values = [
            f"'{value}" if isinstance(value, str) and value[:1] in {"=", "+", "-", "@"} else value
            for value in row
        ]
        data_sheet.append(values)
    data_sheet.freeze_panes = "A2"
    data_sheet.auto_filter.ref = data_sheet.dimensions
    for column_number, column_cells in enumerate(data_sheet.columns, start=1):
        width = min(50, max(12, *(len(str(cell.value or "")) + 2 for cell in column_cells)))
        data_sheet.column_dimensions[get_column_letter(column_number)].width = width

    guide = workbook.create_sheet("Instructions")
    guide.append(["HCM Airfare Template"])
    guide.append([spec.title])
    guide.append([f"Generated {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')}"])
    guide.append([])
    for line in spec.instructions:
        guide.append([line])
    guide.column_dimensions["A"].width = 100
    for row in guide.iter_rows(min_row=1, max_row=1):
        for cell in row:
            cell.font = Font(bold=True, size=14, color="1F4E78")

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def build_pdf_report(
    title: str,
    columns: Sequence[str],
    rows: Iterable[Sequence[Any]],
    *,
    company_name: str = "HCM Airfare Management",
    generated_at: datetime | None = None,
) -> bytes:
    """Render a letterheaded, paginated landscape PDF report."""
    output = BytesIO()
    timestamp = (
        (generated_at or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")
    )
    document = SimpleDocTemplate(
        output,
        pagesize=landscape(A4),
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=22 * mm,
        bottomMargin=16 * mm,
        title=title,
        author=company_name,
    )
    styles = getSampleStyleSheet()
    data = [list(columns), *[[str(value) for value in row] for row in rows]]
    if len(data) == 1:
        data.append(["No records" if index == 0 else "" for index in range(len(columns))])
    table = Table(data, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F4E78")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F6F9")]),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )

    def _letterhead(canvas: Any, doc: Any) -> None:  # noqa: ANN401
        canvas.saveState()
        width, height = landscape(A4)
        canvas.setFillColor(colors.HexColor("#1F4E78"))
        canvas.rect(0, height - 18 * mm, width, 18 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 12)
        canvas.drawString(12 * mm, height - 11 * mm, company_name)
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(width - 12 * mm, height - 11 * mm, title)
        canvas.setFillColor(colors.HexColor("#526579"))
        canvas.setFont("Helvetica", 8)
        canvas.drawString(12 * mm, 8 * mm, f"Generated {timestamp}")
        canvas.drawRightString(width - 12 * mm, 8 * mm, f"Page {doc.page}")
        canvas.restoreState()

    document.build(
        [Paragraph(title, styles["Title"]), Spacer(1, 4 * mm), table],
        onFirstPage=_letterhead,
        onLaterPages=_letterhead,
    )
    return output.getvalue()


def _fmt_money(value: Any) -> str:
    """Format a decimal-like value for print forms (ASCII-safe)."""
    if value is None or value == "":
        return "-"
    try:
        return f"{Decimal(str(value)):,.2f}"
    except Exception:
        return str(value)


def _fmt_date(value: Any) -> str:
    """Format ISO or date values as DD/MM/YYYY for print forms."""
    if value is None or value == "":
        return "-"
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.strftime("%d/%m/%Y")
    text_value = str(value)
    try:
        return date.fromisoformat(text_value[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return text_value


def _fmt_text(value: Any, *, fallback: str = "-") -> str:
    """Normalize blank print values to a dash."""
    if value is None:
        return fallback
    text_value = str(value).strip()
    return text_value if text_value else fallback


def _draw_kv(
    canvas: Any,
    y: float,
    label: str,
    value: Any,
    *,
    label_x: float,
    value_x: float,
) -> None:
    """Draw a compact HCM label/value pair."""
    canvas.setFillColor(colors.HexColor("#526579"))
    canvas.setFont("Helvetica", 8)
    canvas.drawString(label_x, y, label)
    canvas.setFillColor(colors.HexColor("#1A2332"))
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(value_x, y, _fmt_text(value)[:46])


def _section_title(canvas: Any, y: float, title: str, width: float) -> float:
    """Draw a section band and return baseline Y below it."""
    canvas.setFillColor(colors.HexColor("#E8EEF5"))
    canvas.roundRect(36, y - 4, width - 72, 18, 3, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#1F4E78"))
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(44, y + 1, title.upper())
    return y - 22


def build_allocation_print_pdf(
    data: Mapping[str, Any],
    *,
    company_name: str = "Atlas Aluminum",
    company_name_ar: str = "",
    prepared_by: str = "",
    generated_at: datetime | None = None,
    logo_path: str | Path | None = None,
) -> bytes:
    """Render a professional HCM airfare allocation print slip.

    Clean white letterhead (no watermark / employee photo). Optional company logo
    is drawn only when ``logo_path`` points to an uploaded branding file.
    """
    from reportlab.pdfgen import canvas as pdf_canvas

    output = BytesIO()
    width, height = A4
    stamp = (generated_at or datetime.now(UTC)).astimezone()
    page = pdf_canvas.Canvas(output, pagesize=A4)
    page.setTitle("Airfare Allocation")
    page.setAuthor(company_name)

    navy = colors.HexColor("#1F4E78")
    slate = colors.HexColor("#526579")
    ink = colors.HexColor("#1A2332")
    line = colors.HexColor("#D5DEE8")
    soft = colors.HexColor("#F4F7FB")
    accent = colors.HexColor("#0E7C66")

    # Clean white letterhead — logo only when the company uploaded one
    logo = Path(logo_path) if logo_path else None
    text_x = 28.0
    if logo is not None and logo.exists():
        page.drawImage(
            str(logo),
            28,
            height - 58,
            width=48,
            height=48,
            preserveAspectRatio=True,
            mask="auto",
        )
        text_x = 88.0

    display_name = (company_name or "").strip() or "Company"
    page.setFillColor(ink)
    page.setFont("Helvetica-Bold", 13)
    page.drawString(text_x, height - 28, display_name)
    page.setFillColor(slate)
    page.setFont("Helvetica", 8)
    page.drawString(text_x, height - 42, "HCM Airfare Management")
    if company_name_ar:
        page.setFont("Helvetica", 7.5)
        page.drawString(text_x, height - 54, company_name_ar)

    page.setFillColor(ink)
    page.setFont("Helvetica-Bold", 14)
    page.drawRightString(width - 28, height - 28, "Airfare Allocation")
    page.setFont("Helvetica", 8)
    page.setFillColor(slate)
    subtitle = _fmt_text(data.get("scenario") or "Ticket Settlement").replace("_", " ").title()
    page.drawRightString(width - 28, height - 42, subtitle)

    page.setStrokeColor(navy)
    page.setLineWidth(1.6)
    page.line(28, height - 64, width - 28, height - 64)

    # Meta strip
    page.setFillColor(soft)
    page.rect(0, height - 96, width, 32, fill=1, stroke=0)
    page.setStrokeColor(line)
    page.setLineWidth(0.6)
    page.line(0, height - 96, width, height - 96)

    doc_no = _fmt_text(data.get("ticket_code") or data.get("document_number"))
    as_of = _fmt_date(data.get("as_of_date") or stamp.date())
    status = _fmt_text(data.get("status") or "APPROVED").upper()
    page.setFillColor(slate)
    page.setFont("Helvetica", 7.5)
    page.drawString(28, height - 80, "Document No.")
    page.drawString(160, height - 80, "As of Date")
    page.drawString(280, height - 80, "Status")
    page.drawString(400, height - 80, "Generated")
    page.setFillColor(ink)
    page.setFont("Helvetica-Bold", 9)
    page.drawString(28, height - 92, doc_no)
    page.drawString(160, height - 92, as_of)
    page.setFillColor(accent if status == "APPROVED" else navy)
    page.drawString(280, height - 92, status)
    page.setFillColor(ink)
    page.drawString(400, height - 92, stamp.strftime("%d/%m/%Y %H:%M"))

    entitlement_amount = (
        data.get("entitlement_amount")
        or data.get("final_entitlement_amount")
        or data.get("airfare_entitlement_amount")
    )
    ticket_amount = data.get("ticket_cost") or data.get("requested_ticket_amount")
    origin = _fmt_text(data.get("origin_code")).upper()
    destination = _fmt_text(data.get("destination_code")).upper()
    route = f"{origin} to {destination}" if origin != "-" and destination != "-" else "-"

    y = height - 118
    y = _section_title(page, y, "1. Employee Information", width)

    employee_left = [
        ("Employee ID", data.get("employee_code")),
        ("Employee Name", data.get("employee_name") or data.get("full_name")),
        ("Date of Joining", _fmt_date(data.get("join_date") or data.get("date_of_joining"))),
        ("Department", data.get("department")),
        ("Designation", data.get("designation")),
    ]
    employee_right = [
        ("Nationality", data.get("nationality")),
        ("Location", data.get("branch") or data.get("location")),
        ("Pay Group", data.get("pay_group")),
        ("Reporting To", data.get("reporting_officer") or data.get("reporting_to")),
        ("Email", data.get("email")),
    ]
    for index in range(max(len(employee_left), len(employee_right))):
        row_y = y - index * 14
        if index < len(employee_left):
            _draw_kv(
                page,
                row_y,
                employee_left[index][0],
                employee_left[index][1],
                label_x=44,
                value_x=140,
            )
        if index < len(employee_right):
            _draw_kv(
                page,
                row_y,
                employee_right[index][0],
                employee_right[index][1],
                label_x=310,
                value_x=400,
            )
    y = y - max(len(employee_left), len(employee_right)) * 14 - 16

    y = _section_title(page, y, "2. Ticket & Entitlement", width)

    page.setFillColor(colors.HexColor("#E8F6F1"))
    page.roundRect(36, y - 28, width - 72, 36, 4, fill=1, stroke=0)
    page.setStrokeColor(accent)
    page.setLineWidth(1.2)
    page.roundRect(36, y - 28, width - 72, 36, 4, fill=0, stroke=1)
    page.setFillColor(slate)
    page.setFont("Helvetica", 7.5)
    page.drawString(48, y - 6, "ENTITLEMENT AMOUNT")
    page.setFillColor(accent)
    page.setFont("Helvetica-Bold", 16)
    page.drawString(48, y - 22, _fmt_money(entitlement_amount))
    page.setFillColor(slate)
    page.setFont("Helvetica", 7.5)
    page.drawString(220, y - 6, "TICKET AMOUNT")
    page.setFillColor(ink)
    page.setFont("Helvetica-Bold", 12)
    page.drawString(220, y - 22, _fmt_money(ticket_amount))
    page.setFillColor(slate)
    page.setFont("Helvetica", 7.5)
    page.drawString(380, y - 6, "ROUTE")
    page.setFillColor(ink)
    page.setFont("Helvetica-Bold", 11)
    page.drawString(380, y - 22, route)
    y -= 48

    ticket_left = [
        ("Origin", origin),
        ("Destination", destination),
        ("Rate Source", data.get("rate_source")),
        ("Per-day Rate", _fmt_money(data.get("per_day_rate") or data.get("daily_rate"))),
        (
            "Maximum Payout",
            _fmt_money(
                data.get("maximum_payout")
                or data.get("max_payout")
                or data.get("airfare_rate")
            ),
        ),
    ]
    ticket_right = [
        ("Company Payout", _fmt_money(data.get("company_payout") or data.get("company_paid"))),
        ("Employee Payable", _fmt_money(data.get("employee_payable"))),
        ("Excess", _fmt_money(data.get("excess_cost"))),
        ("Excess Option", data.get("excess_option") or data.get("excess_handling")),
        ("EMI / Loan", data.get("loan_code") or _fmt_money(data.get("emi"))),
    ]
    for index in range(max(len(ticket_left), len(ticket_right))):
        row_y = y - index * 14
        if index < len(ticket_left):
            _draw_kv(
                page,
                row_y,
                ticket_left[index][0],
                ticket_left[index][1],
                label_x=44,
                value_x=150,
            )
        if index < len(ticket_right):
            _draw_kv(
                page,
                row_y,
                ticket_right[index][0],
                ticket_right[index][1],
                label_x=310,
                value_x=420,
            )
    y = y - max(len(ticket_left), len(ticket_right)) * 14 - 12

    notes = _fmt_text(data.get("notes"), fallback="")
    if notes:
        page.setFillColor(slate)
        page.setFont("Helvetica", 8)
        page.drawString(44, y, "Notes")
        page.setFillColor(ink)
        page.setFont("Helvetica", 8)
        page.drawString(150, y, notes[:90])
        y -= 16

    y = _section_title(page, y - 4, "3. Entitlement Balance Summary", width)

    headers = ("Metric", "Opening", "Earned", "Already Paid", "Entitlement", "Ticket")
    values = (
        "Airfare",
        _fmt_money(data.get("opening_balance_amount")),
        _fmt_money(data.get("current_year_earned_amount") or data.get("current_year_amount")),
        _fmt_money(data.get("already_paid_amount")),
        _fmt_money(entitlement_amount),
        _fmt_money(ticket_amount),
    )
    table_width = width - 72
    col_w = table_width / len(headers)
    page.setFillColor(navy)
    page.roundRect(36, y - 4, table_width, 18, 2, fill=1, stroke=0)
    page.setFillColor(colors.white)
    page.setFont("Helvetica-Bold", 7.5)
    for index, header in enumerate(headers):
        page.drawString(42 + index * col_w, y + 1, header)
    y -= 18
    page.setFillColor(soft)
    page.rect(36, y - 4, table_width, 18, fill=1, stroke=0)
    page.setStrokeColor(line)
    page.setLineWidth(0.5)
    page.rect(36, y - 4, table_width, 18, fill=0, stroke=1)
    page.setFillColor(ink)
    page.setFont("Helvetica", 8)
    for index, value in enumerate(values):
        page.drawString(42 + index * col_w, y + 1, str(value)[:16])
    y -= 36

    y = _section_title(page, y, "4. Approvals Remarks", width)
    page.setStrokeColor(line)
    page.setLineWidth(0.7)
    for _ in range(3):
        page.line(44, y, width - 44, y)
        y -= 16

    page.setFillColor(slate)
    page.setFont("Helvetica-Oblique", 8)
    page.drawCentredString(
        width / 2,
        78,
        "*** This is a computer-generated document. No signature is required. ***",
    )
    page.setFont("Helvetica", 7.5)
    page.setFillColor(ink)
    page.drawString(44, 58, "Prepared by")
    page.setFont("Helvetica-Bold", 8)
    page.drawString(
        44,
        46,
        prepared_by or _fmt_text(data.get("prepared_by") or data.get("username")),
    )

    page.setStrokeColor(navy)
    page.setLineWidth(1.2)
    page.line(28, 34, width - 28, 34)
    page.setFillColor(slate)
    page.setFont("Helvetica", 6.5)
    page.drawCentredString(
        width / 2,
        18,
        f"{display_name}  |  HCM Airfare Management  |  Computer-generated print",
    )

    page.showPage()
    page.save()
    return output.getvalue()
