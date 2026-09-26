"""HR Document Lifecycle — dynamic letters, merge engine, form schema builder.

Design (research-backed, ATLAS-native on :3389 — NOT a Frappe/Odoo install):
  * Frappe Print Format: Jinja merge ``{{ employee.* }}`` / ``{{ params.* }}`` → HTML → PDF
  * OrangeHRM Document Templates: token substitution + custom field tokens + soft e-sign flag
  * Soft-delete fields: mark inactive; never DROP; orphan tokens render empty (legacy PDFs intact)

Port rule: this module is served by the existing FastAPI process on :3389 only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

from jinja2 import BaseLoader, Environment, FileSystemLoader, select_autoescape, Undefined
from sqlalchemy import select
from sqlalchemy.orm import Session

from airfare_management.application.documents import (
    DocumentParamsError,
    FONTS_DIR,  # noqa: F401 — kept for PDF font path parity
    TEMPLATES_ROOT,
    _company_profile,
    _load_employee,
    _resolve_company_id,
    allocate_voucher_no,
    employee_defaults as offer_employee_defaults,
    get_document,
    letterhead_footer_context,
    render_pdf,
    resolve_company_logo_path,
)
from airfare_management.domain.models import DomainError
from airfare_management.domain.services import (
    build_amortization_schedule,
    calculate_emi,
    quantize_money,
)
from airfare_management.infrastructure.database import EmployeeRow
from airfare_management.infrastructure.repositories import LoanRepository
from airfare_management.infrastructure.schema import (
    DocumentRow,
    HrDocTemplateRow,
    HrFormDefinitionRow,
    LoanRow,
    new_id,
    utc_now,
)

# ---------------------------------------------------------------------------
# Kinds & seeded file-backed templates
# ---------------------------------------------------------------------------

KIND_WARNING = "warning_letter"
KIND_INCREMENT = "salary_increment"
KIND_EXPERIENCE = "experience_certificate"
KIND_RELIEVING = "relieving_certificate"
KIND_DISCIPLINARY = "disciplinary_notice"
KIND_PROMOTION = "promotion_notice"
KIND_MISTAKE_FINE = "mistake_with_fine"

LIFECYCLE_KINDS = (
    KIND_WARNING,
    KIND_INCREMENT,
    KIND_EXPERIENCE,
    KIND_RELIEVING,
    KIND_DISCIPLINARY,
    KIND_PROMOTION,
    KIND_MISTAKE_FINE,
)

VOUCHER_PREFIX = {
    KIND_WARNING: "WRN",
    KIND_INCREMENT: "INC",
    KIND_EXPERIENCE: "EXP",
    KIND_RELIEVING: "REL",
    KIND_DISCIPLINARY: "DIS",
    KIND_PROMOTION: "PRM",
    KIND_MISTAKE_FINE: "MIF",
}

KIND_TITLES = {
    KIND_WARNING: "Official Warning Letter",
    KIND_INCREMENT: "Salary Revision Letter",
    KIND_EXPERIENCE: "Experience Certificate",
    KIND_RELIEVING: "Relieving Certificate",
    KIND_DISCIPLINARY: "Disciplinary Notice",
    KIND_PROMOTION: "Promotion Notice",
    KIND_MISTAKE_FINE: "Mistake with Fine Notice",
}

# Recovery options for Mistake with Fine (research: Bahrain Labour Law Art. 44 —
# employer loans are interest-free; payroll loan deductions ≤ 10% of wage).
RECOVERY_LUMP_SUM = "lump_sum_payroll"
RECOVERY_CASH = "cash"
RECOVERY_CONVERT_LOAN = "convert_to_loan"
RECOVERY_METHODS = (RECOVERY_LUMP_SUM, RECOVERY_CASH, RECOVERY_CONVERT_LOAN)
LOAN_SALARY_CAP_RATIO = Decimal("0.10")
MAX_FINE_LOAN_TENURE = 60

FIELD_TYPES = (
    "text",
    "textarea",
    "number",
    "date",
    "dropdown",
    "file",
    "signature",
)

# Frappe / PDF-designer–style print placement + field adjustments on A4 letter.
PRINT_ZONES = (
    "header",       # after party block, before intro
    "particulars",  # main details grid (default)
    "middle",       # after particulars / before acknowledgment
    "footer",       # before signatures
    "signatures",   # beside / under signature block notes
    "hidden",       # form-only — not printed
)
PRINT_ZONE_LABELS = {
    "header": "Header (after To / before intro)",
    "particulars": "Particulars (main details table)",
    "middle": "Middle (after particulars)",
    "footer": "Footer (before signatures)",
    "signatures": "Signatures (near signature lines)",
    "hidden": "Hidden (form only — not on PDF)",
}

PRINT_ALIGNS = ("left", "center", "right", "justify")
PRINT_ALIGN_LABELS = {
    "left": "Align left",
    "center": "Align center",
    "right": "Align right (amounts)",
    "justify": "Justify (paragraphs)",
}

PRINT_WIDTHS = ("full", "half", "third", "quarter")
PRINT_WIDTH_LABELS = {
    "full": "Full row (100%)",
    "half": "Half row (50% — pair with next)",
    "third": "Third row (33% — trio)",
    "quarter": "Quarter row (25% — four across)",
}

PRINT_LABEL_POS = ("beside", "above", "value_only", "label_only")
PRINT_LABEL_POS_LABELS = {
    "beside": "Label beside value (table)",
    "above": "Label above value",
    "value_only": "Value only (no label)",
    "label_only": "Label only (section heading)",
}

PRINT_FORMATS = (
    "plain",
    "currency",
    "percent",
    "date_long",
    "date_short",
    "uppercase",
    "lowercase",
    "title",
    "yes_no",
    "multiline",
)
PRINT_FORMAT_LABELS = {
    "plain": "Plain text",
    "currency": "Currency (BHD …)",
    "percent": "Percent (n%)",
    "date_long": "Long date",
    "date_short": "Short date (YYYY-MM-DD)",
    "uppercase": "UPPERCASE",
    "lowercase": "lowercase",
    "title": "Title Case",
    "yes_no": "Yes / No",
    "multiline": "Keep line breaks",
}

PRINT_SIZES = ("small", "normal", "large", "xlarge")
PRINT_SIZE_LABELS = {
    "small": "Small type",
    "normal": "Normal type",
    "large": "Large type (emphasis)",
    "xlarge": "Extra large (title)",
}

PRINT_VSPACES = ("tight", "normal", "loose", "section")
PRINT_VSPACE_LABELS = {
    "tight": "Tight spacing",
    "normal": "Normal spacing",
    "loose": "Loose spacing",
    "section": "Section gap",
}

PRINT_BORDERS = ("none", "underline", "box", "top", "bottom")
PRINT_BORDER_LABELS = {
    "none": "No border",
    "underline": "Underline value",
    "box": "Boxed value",
    "top": "Top rule only",
    "bottom": "Bottom rule only",
}

PRINT_INDENTS = ("none", "indent", "double")
PRINT_INDENT_LABELS = {
    "none": "No indent",
    "indent": "Indent once",
    "double": "Indent twice",
}

PRINT_LABEL_WIDTHS = ("narrow", "normal", "wide")
PRINT_LABEL_WIDTH_LABELS = {
    "narrow": "Narrow label col",
    "normal": "Normal label col",
    "wide": "Wide label col",
}

# Frappe-like meta roles: section break / spacer / static HTML text on PDF.
PRINT_ROLES = ("field", "section", "spacer", "static")
PRINT_ROLE_LABELS = {
    "field": "Data field (normal)",
    "section": "Section break (heading)",
    "spacer": "Vertical spacer",
    "static": "Static text (no form value)",
}

PRINT_COLORS = ("default", "muted", "emphasis", "danger")
PRINT_COLOR_LABELS = {
    "default": "Default ink",
    "muted": "Muted gray",
    "emphasis": "Emphasis dark",
    "danger": "Alert / fine red",
}

PRINT_LINE_HEIGHTS = ("compact", "normal", "relaxed")
PRINT_LINE_HEIGHT_LABELS = {
    "compact": "Compact line height",
    "normal": "Normal line height",
    "relaxed": "Relaxed line height",
}

PRINT_BGS = ("none", "tint", "shade")
PRINT_BG_LABELS = {
    "none": "No background",
    "tint": "Light tint band",
    "shade": "Shaded band",
}

PRINT_EMPTY_AS = ("dash", "blank", "na", "pending")
PRINT_EMPTY_AS_LABELS = {
    "dash": "Empty → —",
    "blank": "Empty → (blank)",
    "na": "Empty → N/A",
    "pending": "Empty → Pending",
}

# Named presets users can apply in Form Builder (self-serve layouts).
PRINT_PRESETS: tuple[dict[str, Any], ...] = (
    {
        "key": "detail_row",
        "label": "Detail row (label | value)",
        "patch": {
            "print_zone": "particulars",
            "print_width": "full",
            "print_align": "left",
            "print_label_pos": "beside",
            "print_format": "plain",
            "print_size": "normal",
            "print_vspace": "normal",
            "print_border": "none",
            "print_indent": "none",
            "print_label_width": "normal",
            "print_bold": False,
            "print_italic": False,
        },
    },
    {
        "key": "amount_right",
        "label": "Amount (right · currency · half)",
        "patch": {
            "print_zone": "particulars",
            "print_width": "half",
            "print_align": "right",
            "print_label_pos": "beside",
            "print_format": "currency",
            "print_size": "normal",
            "print_vspace": "normal",
            "print_border": "none",
            "print_indent": "none",
            "print_label_width": "narrow",
            "print_bold": True,
            "print_italic": False,
            "print_prefix": "BHD ",
        },
    },
    {
        "key": "section_heading",
        "label": "Section heading",
        "patch": {
            "print_role": "section",
            "print_zone": "particulars",
            "print_width": "full",
            "print_align": "left",
            "print_label_pos": "label_only",
            "print_format": "uppercase",
            "print_size": "large",
            "print_vspace": "section",
            "print_border": "bottom",
            "print_indent": "none",
            "print_bold": True,
            "print_italic": False,
            "print_show_empty": True,
            "print_hline": True,
            "print_page_break": False,
            "print_color": "emphasis",
            "print_bg": "none",
        },
    },
    {
        "key": "spacer_block",
        "label": "Vertical spacer",
        "patch": {
            "print_role": "spacer",
            "print_zone": "particulars",
            "print_width": "full",
            "print_vspace": "section",
            "print_show_empty": True,
        },
    },
    {
        "key": "static_legal",
        "label": "Static legal line",
        "patch": {
            "print_role": "static",
            "print_zone": "footer",
            "print_width": "full",
            "print_align": "justify",
            "print_label_pos": "value_only",
            "print_size": "small",
            "print_italic": True,
            "print_color": "muted",
            "print_static_text": "This notice is issued under company policy and applicable labour law.",
            "print_show_empty": True,
        },
    },
    {
        "key": "body_paragraph",
        "label": "Body paragraph (value only)",
        "patch": {
            "print_zone": "middle",
            "print_width": "full",
            "print_align": "justify",
            "print_label_pos": "value_only",
            "print_format": "multiline",
            "print_vspace": "loose",
            "print_line_height": "relaxed",
        },
    },
    {
        "key": "page_break_before",
        "label": "Start on new page",
        "patch": {
            "print_role": "section",
            "print_zone": "middle",
            "print_page_break": True,
            "print_label_pos": "label_only",
            "print_show_empty": True,
            "print_size": "large",
            "print_format": "uppercase",
        },
    },
    {
        "key": "footer_note",
        "label": "Footer note (small · italic)",
        "patch": {
            "print_zone": "footer",
            "print_width": "full",
            "print_align": "left",
            "print_label_pos": "value_only",
            "print_format": "plain",
            "print_size": "small",
            "print_vspace": "tight",
            "print_border": "none",
            "print_indent": "indent",
            "print_bold": False,
            "print_italic": True,
            "print_color": "muted",
        },
    },
    {
        "key": "signature_note",
        "label": "Signature note",
        "patch": {
            "print_zone": "signatures",
            "print_width": "half",
            "print_align": "center",
            "print_label_pos": "above",
            "print_format": "plain",
            "print_size": "small",
            "print_vspace": "normal",
            "print_border": "underline",
            "print_indent": "none",
            "print_bold": False,
            "print_italic": False,
        },
    },
    {
        "key": "hidden_form_only",
        "label": "Hidden (form only)",
        "patch": {"print_zone": "hidden"},
    },
)

SIGNATURE_STATUSES = ("draft", "pending_signature", "signed", "issued")


def print_options_catalog() -> dict[str, Any]:
    """UI catalog for HR Form Builder print-format controls."""
    return {
        "print_zones": [{"key": z, "label": PRINT_ZONE_LABELS[z]} for z in PRINT_ZONES],
        "print_aligns": [{"key": a, "label": PRINT_ALIGN_LABELS[a]} for a in PRINT_ALIGNS],
        "print_widths": [{"key": w, "label": PRINT_WIDTH_LABELS[w]} for w in PRINT_WIDTHS],
        "print_label_positions": [
            {"key": p, "label": PRINT_LABEL_POS_LABELS[p]} for p in PRINT_LABEL_POS
        ],
        "print_formats": [{"key": f, "label": PRINT_FORMAT_LABELS[f]} for f in PRINT_FORMATS],
        "print_sizes": [{"key": s, "label": PRINT_SIZE_LABELS[s]} for s in PRINT_SIZES],
        "print_vspaces": [{"key": v, "label": PRINT_VSPACE_LABELS[v]} for v in PRINT_VSPACES],
        "print_borders": [{"key": b, "label": PRINT_BORDER_LABELS[b]} for b in PRINT_BORDERS],
        "print_indents": [{"key": i, "label": PRINT_INDENT_LABELS[i]} for i in PRINT_INDENTS],
        "print_label_widths": [
            {"key": w, "label": PRINT_LABEL_WIDTH_LABELS[w]} for w in PRINT_LABEL_WIDTHS
        ],
        "print_roles": [{"key": r, "label": PRINT_ROLE_LABELS[r]} for r in PRINT_ROLES],
        "print_colors": [{"key": c, "label": PRINT_COLOR_LABELS[c]} for c in PRINT_COLORS],
        "print_line_heights": [
            {"key": h, "label": PRINT_LINE_HEIGHT_LABELS[h]} for h in PRINT_LINE_HEIGHTS
        ],
        "print_bgs": [{"key": b, "label": PRINT_BG_LABELS[b]} for b in PRINT_BGS],
        "print_empty_as": [
            {"key": e, "label": PRINT_EMPTY_AS_LABELS[e]} for e in PRINT_EMPTY_AS
        ],
        "print_presets": [
            {"key": p["key"], "label": p["label"], "patch": p["patch"]} for p in PRINT_PRESETS
        ],
        "template_bound_by_kind": {
            kind: sorted(_seeded_param_keys(kind)) for kind in LIFECYCLE_KINDS
        },
    }


class _EmptyUndefined(Undefined):
    """Orphan merge tokens → empty string (safe after field soft-delete)."""

    def _fail_with_undefined_error(self, *args: object, **kwargs: object) -> str:  # noqa: ARG002
        return ""

    def __str__(self) -> str:
        return ""

    def __iter__(self):  # type: ignore[no-untyped-def]
        return iter(())

    def __bool__(self) -> bool:
        return False


@dataclass(frozen=True, slots=True)
class LifecycleTemplate:
    key: str
    kind: str
    label: str
    description: str
    template_file: str
    required_params: tuple[str, ...]
    optional_params: tuple[str, ...]
    default_body_html: str = ""


_COMMON_REQ = ("full_name", "document_date", "designation", "department")
_COMMON_OPT = (
    "employee_code",
    "employee_name_arabic",
    "cpr_no",
    "nationality",
    "joining_date",
    "signatory_name",
    "signatory_title",
    "narration",
    "request_signature",
)

SEEDED: tuple[LifecycleTemplate, ...] = (
    LifecycleTemplate(
        key="warning_first",
        kind=KIND_WARNING,
        label="Warning — 1st Notice",
        description="First official warning with incident date and expected corrective action.",
        template_file="documents/lifecycle/warning.html",
        required_params=_COMMON_REQ + ("warning_level", "incident_date", "incident_summary"),
        optional_params=_COMMON_OPT + ("corrective_action", "pip_reference", "final_notice"),
    ),
    LifecycleTemplate(
        key="warning_final",
        kind=KIND_WARNING,
        label="Warning — Final Notice",
        description="Final warning; optionally links a PIP reference.",
        template_file="documents/lifecycle/warning.html",
        required_params=_COMMON_REQ + ("warning_level", "incident_date", "incident_summary"),
        optional_params=_COMMON_OPT + ("corrective_action", "pip_reference", "final_notice"),
    ),
    LifecycleTemplate(
        key="increment_default",
        kind=KIND_INCREMENT,
        label="Salary Incremental / Revision",
        description="Before/after component breakdown with effective date and percentage.",
        template_file="documents/lifecycle/salary_increment.html",
        required_params=_COMMON_REQ
        + ("effective_date", "basic_before", "basic_after", "increment_percentage"),
        optional_params=_COMMON_OPT
        + ("hra_before", "hra_after", "allowance_before", "allowance_after", "reason"),
    ),
    LifecycleTemplate(
        key="experience_default",
        kind=KIND_EXPERIENCE,
        label="Experience Certificate",
        description="Service period and last designation for departing / alumni staff.",
        template_file="documents/lifecycle/experience.html",
        required_params=_COMMON_REQ + ("joining_date", "last_working_date"),
        optional_params=_COMMON_OPT + ("conduct_remark", "reason_for_leaving"),
    ),
    LifecycleTemplate(
        key="relieving_default",
        kind=KIND_RELIEVING,
        label="Relieving Certificate",
        description="Confirms clearance and last working day.",
        template_file="documents/lifecycle/relieving.html",
        required_params=_COMMON_REQ + ("joining_date", "last_working_date"),
        optional_params=_COMMON_OPT + ("clearance_complete", "handover_to"),
    ),
    LifecycleTemplate(
        key="disciplinary_default",
        kind=KIND_DISCIPLINARY,
        label="Disciplinary Notice",
        description="Ad-hoc disciplinary communication with policy reference.",
        template_file="documents/lifecycle/disciplinary.html",
        required_params=_COMMON_REQ + ("incident_date", "incident_summary", "policy_reference"),
        optional_params=_COMMON_OPT + ("sanction", "hearing_date"),
    ),
    LifecycleTemplate(
        key="promotion_default",
        kind=KIND_PROMOTION,
        label="Promotion Notice",
        description="New designation / grade with effective date.",
        template_file="documents/lifecycle/promotion.html",
        required_params=_COMMON_REQ + ("new_designation", "effective_date"),
        optional_params=_COMMON_OPT + ("previous_designation", "new_grade", "salary_note"),
    ),
    LifecycleTemplate(
        key="mistake_fine_default",
        kind=KIND_MISTAKE_FINE,
        label="Mistake with Fine",
        description=(
            "Documents an employee mistake, monetary fine, and recovery method "
            "(lump-sum payroll, cash, or convert to interest-free loan)."
        ),
        template_file="documents/lifecycle/mistake_with_fine.html",
        required_params=_COMMON_REQ
        + (
            "incident_date",
            "mistake_summary",
            "fine_amount",
            "policy_reference",
            "recovery_method",
        ),
        optional_params=_COMMON_OPT
        + (
            "tenure_months",
            "consent_acknowledged",
            "hearing_date",
            "corrective_action",
            "monthly_salary_reference",
        ),
    ),
)

_SEEDED_INDEX = {t.key: t for t in SEEDED}

_file_jinja = Environment(
    loader=FileSystemLoader(str(TEMPLATES_ROOT)),
    autoescape=select_autoescape(("html", "xml")),
    undefined=_EmptyUndefined,
)

_string_jinja = Environment(
    loader=BaseLoader(),
    autoescape=select_autoescape(("html", "xml")),
    undefined=_EmptyUndefined,
)


# ---------------------------------------------------------------------------
# Form schema (dynamic CRUD) — soft-delete algorithm
# ---------------------------------------------------------------------------


def _field_key(raw: str) -> str:
    key = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in (raw or "").strip().lower())
    key = "_".join(part for part in key.split("_") if part)
    if not key or key[0].isdigit():
        key = f"f_{key}" if key else "field"
    return key[:64]


def seed_default_form_definitions(session: Session) -> int:
    """Idempotent seed of one form definition per lifecycle kind."""
    created = 0
    for kind in LIFECYCLE_KINDS:
        existing = session.scalar(
            select(HrFormDefinitionRow).where(
                HrFormDefinitionRow.kind == kind,
                HrFormDefinitionRow.deleted_at.is_(None),
            )
        )
        if existing is not None:
            continue
        tpl = next(t for t in SEEDED if t.kind == kind)
        fields: list[dict[str, Any]] = []
        order = 0
        for name in tpl.required_params:
            fields.append(_make_field(name, required=True, sort_order=order))
            order += 1
        for name in tpl.optional_params:
            fields.append(_make_field(name, required=False, sort_order=order))
            order += 1
        session.add(
            HrFormDefinitionRow(
                id=new_id(),
                kind=kind,
                name=KIND_TITLES[kind],
                description=f"Runtime schema for {KIND_TITLES[kind]}",
                fields=fields,
                version=1,
            )
        )
        created += 1
    if created:
        session.flush()
    return created


def _make_field(key: str, *, required: bool, sort_order: int) -> dict[str, Any]:
    ftype = "date" if key.endswith("_date") or key in {"effective_date", "incident_date", "hearing_date", "joining_date", "last_working_date"} else "text"
    if key in {
        "incident_summary",
        "mistake_summary",
        "narration",
        "corrective_action",
        "reason",
        "conduct_remark",
        "special_terms",
    }:
        ftype = "textarea"
    if key in {
        "basic_before",
        "basic_after",
        "hra_before",
        "hra_after",
        "allowance_before",
        "allowance_after",
        "increment_percentage",
        "fine_amount",
        "tenure_months",
        "monthly_salary_reference",
    }:
        ftype = "number"
    if key in {"warning_level", "recovery_method"}:
        ftype = "dropdown"
    if key in {"request_signature", "final_notice", "clearance_complete", "consent_acknowledged"}:
        ftype = "dropdown"
    label = key.replace("_", " ").title()
    options: list[str] = []
    if key == "warning_level":
        options = ["1st Notice", "Final Notice"]
    if key == "recovery_method":
        options = list(RECOVERY_METHODS)
    if key in {"request_signature", "final_notice", "clearance_complete", "consent_acknowledged"}:
        options = ["true", "false"]
    return {
        "key": key,
        "label": label,
        "type": ftype,
        "required": required,
        "active": True,
        "sort_order": sort_order,
        "options": options,
        "deleted_at": None,
        "print_zone": "particulars",
        "print_after": None,
        "print_align": "left",
        "print_width": "full",
        "print_label_pos": "beside",
        "print_bold": False,
        "print_show_label": True,
        "print_format": "plain",
        "print_prefix": "",
        "print_suffix": "",
        "print_size": "normal",
        "print_vspace": "normal",
        "print_border": "none",
        "print_italic": False,
        "print_show_empty": False,
        "print_indent": "none",
        "print_label_width": "normal",
        "print_hline": False,
        "print_role": "field",
        "print_color": "default",
        "print_line_height": "normal",
        "print_bg": "none",
        "print_page_break": False,
        "print_static_text": "",
        "print_include": False,
        "print_label_bold": False,
        "print_keep_together": True,
        "print_empty_as": "dash",
    }


def list_form_definitions(session: Session, *, kind: str | None = None) -> list[dict[str, Any]]:
    seed_default_form_definitions(session)
    q = select(HrFormDefinitionRow).where(HrFormDefinitionRow.deleted_at.is_(None))
    if kind:
        q = q.where(HrFormDefinitionRow.kind == kind)
    rows = session.scalars(q.order_by(HrFormDefinitionRow.kind)).all()
    return [_serialize_form(r, include_deleted=False) for r in rows]


def get_form_definition(session: Session, form_id: str, *, include_deleted: bool = False) -> dict[str, Any]:
    row = session.scalar(
        select(HrFormDefinitionRow).where(
            HrFormDefinitionRow.id == form_id,
            HrFormDefinitionRow.deleted_at.is_(None),
        )
    )
    if row is None:
        raise DomainError("not_found", "Form definition not found.")
    return _serialize_form(row, include_deleted=include_deleted)


def create_form_definition(
    session: Session,
    *,
    kind: str,
    name: str,
    description: str = "",
    fields: list[dict[str, Any]] | None = None,
    actor: str | None = None,
) -> dict[str, Any]:
    if kind not in LIFECYCLE_KINDS:
        raise DomainError("invalid_kind", f"Unsupported kind '{kind}'.")
    cleaned = [_normalize_field(f, idx) for idx, f in enumerate(fields or [])]
    _assert_unique_keys(cleaned)
    row = HrFormDefinitionRow(
        id=new_id(),
        kind=kind,
        name=(name or KIND_TITLES[kind])[:200],
        description=(description or "")[:1000],
        fields=cleaned,
        version=1,
        created_by=actor,
        updated_by=actor,
    )
    session.add(row)
    session.flush()
    return _serialize_form(row, include_deleted=True)


def update_form_definition(
    session: Session,
    form_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    fields: list[dict[str, Any]] | None = None,
    actor: str | None = None,
) -> dict[str, Any]:
    row = session.scalar(
        select(HrFormDefinitionRow).where(
            HrFormDefinitionRow.id == form_id,
            HrFormDefinitionRow.deleted_at.is_(None),
        )
    )
    if row is None:
        raise DomainError("not_found", "Form definition not found.")
    if name is not None:
        row.name = name[:200]
    if description is not None:
        row.description = description[:1000]
    if fields is not None:
        # Soft-delete algorithm: preserve previously deleted keys; merge active set.
        previous = list(row.fields or [])
        deleted_map = {
            f["key"]: f
            for f in previous
            if isinstance(f, dict) and f.get("deleted_at")
        }
        cleaned = [_normalize_field(f, idx) for idx, f in enumerate(fields)]
        _assert_unique_keys(cleaned)
        for f in cleaned:
            if f["key"] in deleted_map and f.get("active") is False:
                f["deleted_at"] = deleted_map[f["key"]].get("deleted_at") or utc_now().isoformat()
        # Re-attach soft-deleted keys not present in payload (never hard-drop)
        present = {f["key"] for f in cleaned}
        for key, old in deleted_map.items():
            if key not in present:
                cleaned.append(old)
        row.fields = cleaned
        row.version = int(row.version or 1) + 1
    row.updated_by = actor
    row.updated_at = utc_now()
    session.flush()
    return _serialize_form(row, include_deleted=True)


def soft_delete_form_field(session: Session, form_id: str, field_key: str, *, actor: str | None = None) -> dict[str, Any]:
    """Mark a field inactive. Never removes JSON history; orphan tokens render empty."""
    row = session.scalar(
        select(HrFormDefinitionRow).where(
            HrFormDefinitionRow.id == form_id,
            HrFormDefinitionRow.deleted_at.is_(None),
        )
    )
    if row is None:
        raise DomainError("not_found", "Form definition not found.")
    fields = list(row.fields or [])
    found = False
    now = utc_now().isoformat()
    for f in fields:
        if isinstance(f, dict) and f.get("key") == field_key:
            f["active"] = False
            f["required"] = False
            f["deleted_at"] = now
            found = True
            break
    if not found:
        raise DomainError("not_found", f"Field '{field_key}' not found.")
    row.fields = fields
    row.version = int(row.version or 1) + 1
    row.updated_by = actor
    row.updated_at = utc_now()
    session.flush()
    return _serialize_form(row, include_deleted=True)


def soft_delete_form_definition(session: Session, form_id: str, *, actor: str | None = None) -> None:
    row = session.scalar(
        select(HrFormDefinitionRow).where(
            HrFormDefinitionRow.id == form_id,
            HrFormDefinitionRow.deleted_at.is_(None),
        )
    )
    if row is None:
        raise DomainError("not_found", "Form definition not found.")
    row.deleted_at = utc_now()
    row.updated_by = actor
    session.flush()


def _coerce_choice(raw: object, allowed: tuple[str, ...], default: str) -> str:
    val = str(raw or default).strip().lower()
    return val if val in allowed else default


def _format_print_value(
    raw: object,
    *,
    ftype: str,
    print_format: str,
    prefix: str,
    suffix: str,
    params: dict[str, Any],
    key: str,
) -> str:
    """Algorithmic display formatter for PDF print rows."""
    long_key = f"{key}_long"
    text = str(params.get(long_key) or raw or "").strip()
    if print_format == "date_long" and params.get(long_key):
        text = str(params[long_key])
    elif print_format == "date_short":
        text = str(raw or "").strip()[:10]
    elif print_format == "currency":
        try:
            text = f"{Decimal(str(raw)):.3f}"
        except Exception:  # noqa: BLE001
            text = str(raw or "")
        if not prefix:
            prefix = "BHD "
    elif print_format == "percent":
        try:
            text = f"{Decimal(str(raw)):.2f}"
        except Exception:  # noqa: BLE001
            text = str(raw or "")
        if not suffix:
            suffix = "%"
    elif print_format == "yes_no":
        low = text.lower()
        if low in {"1", "true", "yes", "y", "on"}:
            text = "Yes"
        elif low in {"0", "false", "no", "n", "off", ""}:
            text = "No"
        else:
            text = text or "No"
    elif print_format == "multiline":
        text = str(raw or "").replace("\r\n", "\n").strip()
    elif print_format == "uppercase":
        text = text.upper()
    elif print_format == "lowercase":
        text = text.lower()
    elif print_format == "title":
        text = text.title()
    elif ftype == "number" and text:
        try:
            text = str(Decimal(str(raw)))
        except Exception:  # noqa: BLE001
            pass
    return f"{prefix}{text}{suffix}"


def _normalize_field(raw: dict[str, Any], sort_order: int) -> dict[str, Any]:
    key = _field_key(str(raw.get("key") or raw.get("label") or f"field_{sort_order}"))
    ftype = str(raw.get("type") or "text").lower()
    if ftype not in FIELD_TYPES:
        raise DomainError("invalid_field_type", f"Unsupported field type '{ftype}'.")
    options = raw.get("options") or []
    if not isinstance(options, list):
        options = [str(options)]
    zone = _coerce_choice(raw.get("print_zone"), PRINT_ZONES, "particulars")
    after_raw = raw.get("print_after")
    print_after = None
    if after_raw not in (None, ""):
        print_after = _field_key(str(after_raw))
        if print_after == key:
            print_after = None
    align = _coerce_choice(raw.get("print_align"), PRINT_ALIGNS, "left")
    # Numbers default right unless explicitly set
    if raw.get("print_align") in (None, "") and ftype == "number":
        align = "right"
    width = _coerce_choice(raw.get("print_width"), PRINT_WIDTHS, "full")
    label_pos = _coerce_choice(raw.get("print_label_pos"), PRINT_LABEL_POS, "beside")
    fmt = _coerce_choice(raw.get("print_format"), PRINT_FORMATS, "plain")
    size = _coerce_choice(raw.get("print_size"), PRINT_SIZES, "normal")
    vspace = _coerce_choice(raw.get("print_vspace"), PRINT_VSPACES, "normal")
    border = _coerce_choice(raw.get("print_border"), PRINT_BORDERS, "none")
    indent = _coerce_choice(raw.get("print_indent"), PRINT_INDENTS, "none")
    label_width = _coerce_choice(raw.get("print_label_width"), PRINT_LABEL_WIDTHS, "normal")
    role = _coerce_choice(raw.get("print_role"), PRINT_ROLES, "field")
    color = _coerce_choice(raw.get("print_color"), PRINT_COLORS, "default")
    line_height = _coerce_choice(raw.get("print_line_height"), PRINT_LINE_HEIGHTS, "normal")
    bg = _coerce_choice(raw.get("print_bg"), PRINT_BGS, "none")
    if role == "section":
        label_pos = "label_only"
    if role == "spacer":
        label_pos = "value_only"
    show_label = raw.get("print_show_label")
    if show_label is None:
        show_label = label_pos != "value_only"
    return {
        "key": key,
        "label": str(raw.get("label") or key.replace("_", " ").title())[:120],
        "type": ftype,
        "required": bool(raw.get("required")),
        "active": bool(raw.get("active", True)),
        "sort_order": int(raw.get("sort_order", sort_order)),
        "options": [str(o)[:80] for o in options][:40],
        "deleted_at": raw.get("deleted_at"),
        "print_zone": zone,
        "print_after": print_after,
        "print_align": align,
        "print_width": width,
        "print_label_pos": label_pos,
        "print_bold": bool(raw.get("print_bold")),
        "print_italic": bool(raw.get("print_italic")),
        "print_show_label": bool(show_label),
        "print_show_empty": bool(raw.get("print_show_empty")),
        "print_format": fmt,
        "print_prefix": str(raw.get("print_prefix") or "")[:40],
        "print_suffix": str(raw.get("print_suffix") or "")[:40],
        "print_size": size,
        "print_vspace": vspace,
        "print_border": border,
        "print_indent": indent,
        "print_label_width": label_width,
        "print_hline": bool(raw.get("print_hline")),
        "print_role": role,
        "print_color": color,
        "print_line_height": line_height,
        "print_bg": bg,
        "print_page_break": bool(raw.get("print_page_break")),
        "print_static_text": str(raw.get("print_static_text") or "")[:500],
        "print_include": bool(raw.get("print_include")),
        "print_label_bold": bool(raw.get("print_label_bold")),
        "print_keep_together": bool(raw.get("print_keep_together", True)),
        "print_empty_as": _coerce_choice(raw.get("print_empty_as"), PRINT_EMPTY_AS, "dash"),
    }


def _seeded_param_keys(kind: str) -> set[str]:
    """Keys owned by the static Jinja template for this kind (not dynamic extras)."""
    keys: set[str] = set()
    for t in SEEDED:
        if t.kind == kind:
            keys.update(t.required_params)
            keys.update(t.optional_params)
    # Always template-bound chrome / party keys
    keys.update(
        {
            "full_name",
            "document_date",
            "designation",
            "department",
            "employee_code",
            "signatory_name",
            "signatory_title",
            "request_signature",
        }
    )
    return keys


def _order_print_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Honor print_after then sort_order (Frappe-like relative placement)."""
    if not rows:
        return []
    pending = sorted(rows, key=lambda r: int(r.get("sort_order") or 0))
    ordered: list[dict[str, Any]] = []
    placed: set[str] = set()
    guard = 0
    while pending and guard < len(rows) * 3:
        guard += 1
        progress = False
        next_pending: list[dict[str, Any]] = []
        for row in pending:
            after = row.get("print_after")
            if after and after not in placed and any(r.get("key") == after for r in pending):
                next_pending.append(row)
                continue
            if after and after in placed:
                idx = next(i for i, r in enumerate(ordered) if r.get("key") == after)
                ordered.insert(idx + 1, row)
            else:
                ordered.append(row)
            placed.add(str(row.get("key")))
            progress = True
        if not progress:
            ordered.extend(next_pending)
            break
        pending = next_pending
    return ordered


def _pack_print_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pack consecutive half/third/quarter fields into multi-column bands."""
    bands: list[dict[str, Any]] = []
    i = 0
    while i < len(rows):
        row = rows[i]
        width = str(row.get("print_width") or "full")
        if width == "half":
            pair = [row]
            if i + 1 < len(rows) and str(rows[i + 1].get("print_width") or "full") == "half":
                pair.append(rows[i + 1])
                i += 2
            else:
                i += 1
            bands.append({"kind": "band", "cols": 2, "cells": pair})
        elif width == "third":
            trio = [row]
            j = i + 1
            while j < len(rows) and len(trio) < 3 and str(rows[j].get("print_width") or "full") == "third":
                trio.append(rows[j])
                j += 1
            i = j
            bands.append({"kind": "band", "cols": 3, "cells": trio})
        elif width == "quarter":
            quad = [row]
            j = i + 1
            while j < len(rows) and len(quad) < 4 and str(rows[j].get("print_width") or "full") == "quarter":
                quad.append(rows[j])
                j += 1
            i = j
            bands.append({"kind": "band", "cols": 4, "cells": quad})
        else:
            bands.append({"kind": "row", "cols": 1, "cells": [row]})
            i += 1
    return bands


def build_print_layout(
    form_fields: list[dict[str, Any]] | None,
    params: dict[str, Any],
    *,
    kind: str,
) -> dict[str, list[dict[str, Any]]]:
    """Group custom fields into print zones with alignment / width packing."""
    layout: dict[str, list[dict[str, Any]]] = {z: [] for z in PRINT_ZONES if z != "hidden"}
    if not form_fields:
        return layout
    seeded = _seeded_param_keys(kind)
    candidates: list[dict[str, Any]] = []
    for raw in form_fields:
        if not isinstance(raw, dict):
            continue
        if raw.get("deleted_at") or raw.get("active") is False:
            continue
        key = str(raw.get("key") or "")
        if not key or key.endswith("_long"):
            continue
        role = _coerce_choice(raw.get("print_role"), PRINT_ROLES, "field")
        # Template-bound (seeded) keys skip dynamic zones unless user opts in
        # via print_include, or field is a meta role (section/spacer/static).
        is_seeded = key in seeded
        print_include = bool(raw.get("print_include"))
        if is_seeded and not print_include and role not in {"section", "spacer", "static"}:
            continue
        zone = _coerce_choice(raw.get("print_zone"), PRINT_ZONES, "particulars")
        if zone == "hidden":
            continue
        val = params.get(key)
        show_empty = bool(raw.get("print_show_empty"))
        static_text = str(raw.get("print_static_text") or "").strip()
        # Meta roles always print (Frappe section/spacer pattern).
        if role in {"section", "spacer", "static"}:
            show_empty = True
        if (
            role == "field"
            and val in (None, "")
            and str(raw.get("print_label_pos") or "") != "label_only"
            and not show_empty
        ):
            continue
        ftype = str(raw.get("type") or "text")
        fmt = _coerce_choice(raw.get("print_format"), PRINT_FORMATS, "plain")
        align = _coerce_choice(raw.get("print_align"), PRINT_ALIGNS, "left")
        if raw.get("print_align") in (None, "") and (ftype == "number" or fmt in {"currency", "percent"}):
            align = "right"
        empty_as = _coerce_choice(raw.get("print_empty_as"), PRINT_EMPTY_AS, "dash")
        empty_token = {"dash": "—", "blank": "", "na": "N/A", "pending": "Pending"}.get(
            empty_as, "—"
        )
        if role == "static":
            display = static_text or str(raw.get("label") or "")
        elif role == "spacer":
            display = ""
        elif role == "section":
            display = ""
        else:
            display = _format_print_value(
                val,
                ftype=ftype,
                print_format=fmt,
                prefix=str(raw.get("print_prefix") or ""),
                suffix=str(raw.get("print_suffix") or ""),
                params=params,
                key=key,
            )
            if not display and show_empty:
                display = empty_token
        label_pos = _coerce_choice(raw.get("print_label_pos"), PRINT_LABEL_POS, "beside")
        if role == "section":
            label_pos = "label_only"
        if role in {"spacer", "static"}:
            label_pos = "value_only"
        show_label = raw.get("print_show_label")
        if show_label is None:
            show_label = label_pos != "value_only"
        width = _coerce_choice(raw.get("print_width"), PRINT_WIDTHS, "full")
        if role in {"section", "spacer"}:
            width = "full"
        candidates.append(
            {
                "key": key,
                "label": str(raw.get("label") or key.replace("_", " ").title()),
                "value": display,
                "type": ftype,
                "sort_order": int(raw.get("sort_order") or 0),
                "print_after": raw.get("print_after"),
                "print_zone": zone,
                "print_align": align,
                "print_width": width,
                "print_label_pos": label_pos,
                "print_bold": bool(raw.get("print_bold")),
                "print_italic": bool(raw.get("print_italic")),
                "print_show_label": bool(show_label),
                "print_format": fmt,
                "print_size": _coerce_choice(raw.get("print_size"), PRINT_SIZES, "normal"),
                "print_vspace": _coerce_choice(raw.get("print_vspace"), PRINT_VSPACES, "normal"),
                "print_border": _coerce_choice(raw.get("print_border"), PRINT_BORDERS, "none"),
                "print_indent": _coerce_choice(raw.get("print_indent"), PRINT_INDENTS, "none"),
                "print_label_width": _coerce_choice(
                    raw.get("print_label_width"), PRINT_LABEL_WIDTHS, "normal"
                ),
                "print_hline": bool(raw.get("print_hline")),
                "print_role": role,
                "print_color": _coerce_choice(raw.get("print_color"), PRINT_COLORS, "default"),
                "print_line_height": _coerce_choice(
                    raw.get("print_line_height"), PRINT_LINE_HEIGHTS, "normal"
                ),
                "print_bg": _coerce_choice(raw.get("print_bg"), PRINT_BGS, "none"),
                "print_page_break": bool(raw.get("print_page_break")),
                "print_include": print_include,
                "print_label_bold": bool(raw.get("print_label_bold")),
                "print_keep_together": bool(raw.get("print_keep_together", True)),
                "print_empty_as": empty_as,
            }
        )
    by_zone: dict[str, list[dict[str, Any]]] = {z: [] for z in layout}
    for row in candidates:
        by_zone[str(row["print_zone"])].append(row)
    for zone, rows in by_zone.items():
        ordered = _order_print_rows(rows)
        layout[zone] = _pack_print_rows(ordered)
    return layout


def _assert_unique_keys(fields: list[dict[str, Any]]) -> None:
    seen: set[str] = set()
    for f in fields:
        if f.get("deleted_at"):
            continue
        k = f["key"]
        if k in seen:
            raise DomainError("duplicate_field_key", f"Duplicate field key '{k}'.")
        seen.add(k)


def _serialize_form(row: HrFormDefinitionRow, *, include_deleted: bool) -> dict[str, Any]:
    fields = list(row.fields or [])
    if not include_deleted:
        fields = [f for f in fields if isinstance(f, dict) and f.get("active", True) and not f.get("deleted_at")]
    # Hydrate print defaults on read so resave / UI always see full print schema.
    hydrated: list[dict[str, Any]] = []
    for idx, f in enumerate(fields):
        if not isinstance(f, dict):
            continue
        if f.get("deleted_at"):
            hydrated.append(f)
            continue
        try:
            hydrated.append(_normalize_field(f, int(f.get("sort_order", idx))))
        except DomainError:
            hydrated.append(f)
    hydrated = sorted(hydrated, key=lambda f: int(f.get("sort_order", 0)))
    bound = sorted(_seeded_param_keys(str(row.kind)))
    return {
        "id": row.id,
        "kind": row.kind,
        "name": row.name,
        "description": row.description or "",
        "fields": hydrated,
        "version": row.version,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "template_bound_keys": bound,
    }


# ---------------------------------------------------------------------------
# DB-backed WYSIWYG templates (optional override of file templates)
# ---------------------------------------------------------------------------


def list_lifecycle_templates(session: Session | None = None) -> list[dict[str, Any]]:
    """File-seeded templates + any DB overrides (WYSIWYG bodies)."""
    out: list[dict[str, Any]] = []
    for t in SEEDED:
        out.append(
            {
                "key": t.key,
                "kind": t.kind,
                "label": t.label,
                "description": t.description,
                "required_params": list(t.required_params),
                "optional_params": list(t.optional_params),
                "source": "file",
                "merge_tokens": _merge_token_catalog(t),
            }
        )
    if session is not None:
        rows = session.scalars(
            select(HrDocTemplateRow).where(HrDocTemplateRow.deleted_at.is_(None))
        ).all()
        for r in rows:
            out.append(
                {
                    "id": r.id,
                    "key": r.key,
                    "kind": r.kind,
                    "label": r.label,
                    "description": r.description or "",
                    "required_params": list(r.required_params or []),
                    "optional_params": list(r.optional_params or []),
                    "source": "database",
                    "body_html": r.body_html,
                    "request_signature": bool(r.request_signature),
                    "merge_tokens": list(r.merge_tokens or []),
                }
            )
    return out


def _merge_token_catalog(t: LifecycleTemplate) -> list[str]:
    return [
        "{{ employee.full_name }}",
        "{{ employee.code }}",
        "{{ employee.designation }}",
        "{{ employee.department }}",
        "{{ company.name }}",
        "{{ doc.ref }}",
        "{{ doc.title }}",
        "{{ doc.issue_date }}",
        *[f"{{{{ params.{k} }}}}" for k in (*t.required_params, *t.optional_params)],
    ]


def upsert_db_template(
    session: Session,
    *,
    key: str,
    kind: str,
    label: str,
    body_html: str,
    description: str = "",
    required_params: list[str] | None = None,
    optional_params: list[str] | None = None,
    request_signature: bool = False,
    actor: str | None = None,
) -> dict[str, Any]:
    if kind not in LIFECYCLE_KINDS:
        raise DomainError("invalid_kind", f"Unsupported kind '{kind}'.")
    key = _field_key(key)[:40]
    if not body_html.strip():
        raise DomainError("invalid_template", "Template body cannot be empty.")
    # Dry-run compile — catch Jinja syntax before save
    try:
        _string_jinja.from_string(body_html).render(
            employee={},
            company={},
            doc={},
            params={},
        )
    except Exception as exc:  # noqa: BLE001
        raise DomainError("invalid_template", f"Jinja compile error: {exc}") from exc

    row = session.scalar(
        select(HrDocTemplateRow).where(
            HrDocTemplateRow.key == key,
            HrDocTemplateRow.deleted_at.is_(None),
        )
    )
    tokens = _extract_tokens(body_html)
    if row is None:
        row = HrDocTemplateRow(
            id=new_id(),
            key=key,
            kind=kind,
            label=label[:200],
            description=description[:1000],
            body_html=body_html,
            required_params=required_params or ["full_name", "document_date"],
            optional_params=optional_params or [],
            merge_tokens=tokens,
            request_signature=request_signature,
            created_by=actor,
            updated_by=actor,
        )
        session.add(row)
    else:
        row.kind = kind
        row.label = label[:200]
        row.description = description[:1000]
        row.body_html = body_html
        row.required_params = required_params or row.required_params
        row.optional_params = optional_params or row.optional_params
        row.merge_tokens = tokens
        row.request_signature = request_signature
        row.updated_by = actor
        row.updated_at = utc_now()
        row.version = int(row.version or 1) + 1
    session.flush()
    return {
        "id": row.id,
        "key": row.key,
        "kind": row.kind,
        "label": row.label,
        "version": row.version,
    }


def _extract_tokens(body: str) -> list[str]:
    import re

    return sorted(set(re.findall(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}", body)))


# ---------------------------------------------------------------------------
# Validate / render / create
# ---------------------------------------------------------------------------


def _resolve_template(session: Session, template_key: str, kind: str) -> tuple[str, Any, list[str], list[str]]:
    """Return (source, template_obj_or_row, required, optional)."""
    db = session.scalar(
        select(HrDocTemplateRow).where(
            HrDocTemplateRow.key == template_key,
            HrDocTemplateRow.deleted_at.is_(None),
        )
    )
    if db is not None:
        if db.kind != kind:
            raise DomainError("invalid_template", "Template kind mismatch.")
        return "database", db, list(db.required_params or []), list(db.optional_params or [])
    seeded = _SEEDED_INDEX.get(template_key)
    if seeded is None or seeded.kind != kind:
        raise DomainError("invalid_template", "Unknown lifecycle template.")
    return "file", seeded, list(seeded.required_params), list(seeded.optional_params)


def validate_lifecycle_params(
    required: list[str],
    optional: list[str],
    raw: dict[str, Any],
    *,
    form_fields: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Validate against required keys; coerce numbers/dates; ignore inactive form fields."""
    params = dict(raw or {})
    if params.get("document_date") in (None, ""):
        params["document_date"] = date.today().isoformat()

    active_keys: set[str] | None = None
    if form_fields is not None:
        active_keys = {
            f["key"]
            for f in form_fields
            if isinstance(f, dict) and f.get("active", True) and not f.get("deleted_at")
        }
        # Dynamic required from form
        required = [
            f["key"]
            for f in form_fields
            if isinstance(f, dict)
            and f.get("active", True)
            and not f.get("deleted_at")
            and f.get("required")
        ]

    missing = [k for k in required if params.get(k) in (None, "")]
    if missing:
        raise DocumentParamsError(f"Missing required field(s): {', '.join(missing)}.")

    cleaned: dict[str, Any] = {}
    all_keys = set(required) | set(optional) | set(params.keys())
    for key in all_keys:
        if active_keys is not None and key not in active_keys and key not in required:
            # Soft-deleted field: drop from new issues (legacy docs keep snapshot in row.params)
            continue
        val = params.get(key)
        if val in (None, ""):
            continue
        if key.endswith("_date") or key in {
            "document_date",
            "effective_date",
            "incident_date",
            "joining_date",
            "last_working_date",
            "hearing_date",
        }:
            try:
                d = date.fromisoformat(str(val)[:10])
            except Exception as exc:  # noqa: BLE001
                raise DocumentParamsError(f"'{key}' must be YYYY-MM-DD.") from exc
            cleaned[key] = d.isoformat()
            cleaned[f"{key}_long"] = d.strftime("%d %B %Y")
        elif key in {
            "basic_before",
            "basic_after",
            "hra_before",
            "hra_after",
            "allowance_before",
            "allowance_after",
            "increment_percentage",
            "fine_amount",
            "tenure_months",
            "monthly_salary_reference",
        }:
            try:
                cleaned[key] = str(Decimal(str(val)))
            except Exception as exc:  # noqa: BLE001
                raise DocumentParamsError(f"'{key}' must be a number.") from exc
        else:
            cleaned[key] = str(val).strip()[:4000]

    # Derived increment totals
    try:
        bb = Decimal(cleaned.get("basic_before") or "0")
        ba = Decimal(cleaned.get("basic_after") or "0")
        hb = Decimal(cleaned.get("hra_before") or "0")
        ha = Decimal(cleaned.get("hra_after") or "0")
        ab = Decimal(cleaned.get("allowance_before") or "0")
        aa = Decimal(cleaned.get("allowance_after") or "0")
        cleaned["total_before"] = str(bb + hb + ab)
        cleaned["total_after"] = str(ba + ha + aa)
    except Exception:  # noqa: BLE001
        pass

    # Mistake-with-fine recovery plan (algorithmic enrichment for PDF + loan convert)
    recovery = str(cleaned.get("recovery_method") or "").strip().lower()
    if recovery:
        cleaned["recovery_method"] = recovery
        if recovery not in RECOVERY_METHODS:
            raise DocumentParamsError(
                f"recovery_method must be one of: {', '.join(RECOVERY_METHODS)}."
            )
        if cleaned.get("fine_amount"):
            salary_ref = cleaned.get("monthly_salary_reference")
            tenure_raw = cleaned.get("tenure_months")
            tenure_i = int(Decimal(tenure_raw)) if tenure_raw not in (None, "") else None
            plan = plan_mistake_fine_recovery(
                fine_amount=Decimal(str(cleaned["fine_amount"])),
                recovery_method=recovery,
                tenure_months=tenure_i,
                monthly_salary=Decimal(str(salary_ref)) if salary_ref not in (None, "") else None,
            )
            cleaned["planned_monthly_installment"] = plan.get("monthly_installment") or ""
            cleaned["recovery_creates_loan"] = "true" if plan["creates_loan"] else "false"
            cleaned["recovery_method_label"] = {
                RECOVERY_LUMP_SUM: "Lump-sum payroll deduction",
                RECOVERY_CASH: "Cash settlement",
                RECOVERY_CONVERT_LOAN: "Convert to interest-free payroll loan",
            }.get(recovery, recovery.replace("_", " ").title())
            if plan.get("warnings"):
                cleaned["recovery_warnings"] = " | ".join(plan["warnings"])
            if plan["creates_loan"]:
                consent_raw = cleaned.get("consent_acknowledged")
                consent = str(consent_raw or "").lower()
                if consent in {"", "none"}:
                    # Blank form on Preview — default acknowledge; HR can still set false.
                    cleaned["consent_acknowledged"] = "true"
                    consent = "true"
                elif consent not in {"1", "true", "yes"}:
                    raise DocumentParamsError(
                        "consent_acknowledged must be true when recovery_method is convert_to_loan "
                        "(written consent required for payroll loan deductions)."
                    )
                cleaned["tenure_months"] = str(plan["tenure_months"])
                cleaned["consent_label"] = "Yes — employee consent recorded"
            else:
                consent = str(cleaned.get("consent_acknowledged") or "").lower()
                cleaned["consent_label"] = (
                    "Yes" if consent in {"1", "true", "yes"} else "Not required"
                )

    if "signatory_name" not in cleaned:
        cleaned["signatory_name"] = "Authorized Signatory"
    if "signatory_title" not in cleaned:
        cleaned["signatory_title"] = "Human Resources"
    return cleaned


def _first_of_next_month(anchor: date) -> date:
    if anchor.month == 12:
        return date(anchor.year + 1, 1, 1)
    return date(anchor.year, anchor.month + 1, 1)


def plan_mistake_fine_recovery(
    *,
    fine_amount: Decimal,
    recovery_method: str,
    tenure_months: int | None = None,
    monthly_salary: Decimal | None = None,
    annual_rate: Decimal = Decimal("0"),
) -> dict[str, Any]:
    """Pure recovery planner for Mistake with Fine (V&V-friendly, no DB).

    Algorithm
    ---------
    1. Quantize principal; reject non-positive fines.
    2. Normalize recovery_method ∈ {lump_sum_payroll, cash, convert_to_loan}.
    3. If convert_to_loan:
         a. Require tenure ∈ [1, MAX_FINE_LOAN_TENURE].
         b. Force annual_rate = 0 by default (Bahrain Art. 44 — no interest on employer loans).
         c. EMI = calculate_emi(principal, rate, tenure).
         d. Soft-warn when EMI / monthly_salary > 10% (Art. 44 loan deduction cap).
    4. Return structured plan for letter merge + loan creation.
    """
    method = (recovery_method or "").strip().lower()
    if method not in RECOVERY_METHODS:
        raise DocumentParamsError(
            f"recovery_method must be one of: {', '.join(RECOVERY_METHODS)}."
        )
    principal = quantize_money(Decimal(fine_amount))
    if principal <= 0:
        raise DocumentParamsError("fine_amount must be greater than zero.")

    rate = quantize_money(Decimal(annual_rate or 0))
    if rate < 0:
        raise DocumentParamsError("annual_rate cannot be negative.")

    plan: dict[str, Any] = {
        "principal": str(principal),
        "recovery_method": method,
        "annual_rate": str(rate),
        "creates_loan": method == RECOVERY_CONVERT_LOAN,
        "tenure_months": None,
        "monthly_installment": None,
        "salary_cap_ratio": None,
        "within_salary_cap": None,
        "warnings": [],
    }

    if method != RECOVERY_CONVERT_LOAN:
        return plan

    # Default tenure when HR selects convert-to-loan but leaves the field blank
    # (common on Preview before filling optional number fields).
    if tenure_months is None or int(tenure_months) < 1:
        tenure_months = 3
    if int(tenure_months) > MAX_FINE_LOAN_TENURE:
        raise DocumentParamsError(
            f"tenure_months must be between 1 and {MAX_FINE_LOAN_TENURE}."
        )
    tenure = int(tenure_months)
    emi = calculate_emi(principal, rate, tenure)
    plan["tenure_months"] = tenure
    plan["monthly_installment"] = str(emi)

    if monthly_salary is not None and Decimal(monthly_salary) > 0:
        salary = Decimal(monthly_salary)
        ratio = (emi / salary).quantize(Decimal("0.0001"))
        plan["salary_cap_ratio"] = str(ratio)
        within = ratio <= LOAN_SALARY_CAP_RATIO
        plan["within_salary_cap"] = within
        if not within:
            plan["warnings"].append(
                "Monthly installment exceeds 10% of monthly salary "
                "(Bahrain Labour Law Art. 44 loan-deduction guideline)."
            )
    return plan


def convert_mistake_fine_to_loan(
    session: Session,
    *,
    document_id: str,
    document_root: str | Path,
    branding_root: str | Path,
    actor: str | None = None,
    tenure_months: int | None = None,
    annual_rate: Decimal = Decimal("0"),
    consent_acknowledged: bool = True,
) -> tuple[DocumentRow, LoanRow, list[str]]:
    """Create an interest-free recovery loan from an issued Mistake with Fine letter.

    Idempotent: if params.loan_id already points at an active loan, returns it.
    Links loan → document via params (loan_id / loan_code); LoanRow.source_ticket_id stays null.
    """
    row = get_document(session, document_id)
    if row.kind != KIND_MISTAKE_FINE:
        raise DomainError("invalid_kind", "Convert to loan applies only to Mistake with Fine documents.")
    if not row.employee_id:
        raise DomainError(
            "employee_required",
            "Link an employee before converting the fine to a loan.",
        )
    params = dict(row.params or {})
    existing_loan_id = str(params.get("loan_id") or "").strip()
    if existing_loan_id:
        existing = session.get(LoanRow, existing_loan_id)
        if existing is not None and existing.deleted_at is None:
            return row, existing, ["Loan already linked; skipped re-create."]

    if not consent_acknowledged and str(params.get("consent_acknowledged") or "").lower() not in {
        "1",
        "true",
        "yes",
    }:
        raise DomainError(
            "consent_required",
            "Employee written consent is required before converting a fine to a payroll loan.",
        )

    fine_raw = params.get("fine_amount")
    if fine_raw in (None, ""):
        raise DomainError("fine_required", "Document is missing fine_amount.")
    tenure = tenure_months
    if tenure is None and params.get("tenure_months") not in (None, ""):
        tenure = int(Decimal(str(params["tenure_months"])))
    salary_ref = params.get("monthly_salary_reference")
    if salary_ref in (None, ""):
        emp = _load_employee(session, row.employee_id)
        if emp is not None and emp.monthly_salary is not None:
            salary_ref = str(emp.monthly_salary)

    plan = plan_mistake_fine_recovery(
        fine_amount=Decimal(str(fine_raw)),
        recovery_method=RECOVERY_CONVERT_LOAN,
        tenure_months=tenure,
        monthly_salary=Decimal(str(salary_ref)) if salary_ref not in (None, "") else None,
        annual_rate=annual_rate,
    )
    principal = Decimal(plan["principal"])
    rate = Decimal(plan["annual_rate"])
    installments = int(plan["tenure_months"])
    monthly = Decimal(plan["monthly_installment"])
    anchor = row.document_date or date.today()
    first_due = _first_of_next_month(anchor)

    loan = LoanRow(
        employee_id=row.employee_id,
        source_ticket_id=None,
        principal=principal,
        annual_rate=rate,
        installments=installments,
        monthly_installment=monthly,
        outstanding=principal,
        status="active",
        first_due_date=first_due,
        created_by=actor,
        updated_by=actor,
    )
    session.add(loan)
    session.flush()
    LoanRepository(session).replace_schedule(
        loan.id,
        build_amortization_schedule(principal, rate, installments, first_due),
    )

    # GL posting for non-ticket loans (same path as POST /v1/loans)
    try:
        from airfare_management.infrastructure import finance_ledger as finance_gl

        emp_row = _load_employee(session, row.employee_id)
        if emp_row is not None:
            finance_gl.safe_post(
                session,
                finance_gl.post_loan_disbursement,
                company_id=emp_row.company_id,
                employee_id=row.employee_id,
                loan_id=loan.id,
                entry_date=first_due,
                principal=principal,
                actor=actor or "system",
            )
    except Exception:  # noqa: BLE001 — letter + loan must not fail if GL optional
        pass

    now = utc_now()
    params["recovery_method"] = RECOVERY_CONVERT_LOAN
    params["consent_acknowledged"] = "true"
    params["tenure_months"] = str(installments)
    params["planned_monthly_installment"] = str(monthly)
    params["loan_id"] = loan.id
    params["loan_code"] = loan.loan_code or loan.id
    params["loan_principal"] = str(principal)
    params["loan_annual_rate"] = str(rate)
    params["loan_first_due_date"] = first_due.isoformat()
    params["loan_first_due_date_long"] = first_due.strftime("%d %B %Y")
    params["converted_to_loan_at"] = now.isoformat()
    params["converted_to_loan_by"] = actor or ""
    params["recovery_method_label"] = "Convert to interest-free payroll loan"
    params["consent_label"] = "Yes — employee consent recorded"
    if plan.get("warnings"):
        params["recovery_warnings"] = " | ".join(plan["warnings"])
    if salary_ref not in (None, ""):
        params["monthly_salary_reference"] = str(salary_ref)
    row.params = params
    row.updated_at = now
    row.updated_by = actor
    row.version = int(row.version or 1) + 1
    row.additional_details = params.get("mistake_summary") or row.additional_details
    session.flush()

    # Regenerate PDF so letter shows loan voucher + EMI
    source, tpl, _req, _opt = _resolve_template(session, row.template_key, row.kind)
    company = _company_profile(session, str(row.company_id) if row.company_id else None, require_arabic=False)
    logo = resolve_company_logo_path(
        session, branding_root, str(row.company_id) if row.company_id else None
    )
    emp = _load_employee(session, row.employee_id)
    party = {
        "full_name": params.get("full_name") or (emp.full_name if emp else "Employee"),
        "code": params.get("employee_code") or (emp.code if emp else ""),
        "designation": params.get("designation") or "",
        "department": params.get("department") or "",
        "nationality": params.get("nationality") or "",
        "arabic_name": params.get("employee_name_arabic") or "",
    }
    ctx = build_lifecycle_context(
        company=company,
        employee=party,
        kind=row.kind,
        params=params,
        voucher_no=row.voucher_no,
        doc_number=row.document_number,
        logo_src=str(logo) if logo else None,
        print_layout=_print_layout_for(session, kind=row.kind, params=params),
    )
    html = render_lifecycle_html(session, source=source, template_obj=tpl, context=ctx)
    pdf_bytes = render_pdf(html)
    root = Path(document_root)
    root.mkdir(parents=True, exist_ok=True)
    pdf_path = root / f"{row.id}.pdf"
    pdf_path.write_bytes(pdf_bytes)
    row.pdf_key = pdf_path.name
    session.flush()
    return row, loan, list(plan.get("warnings") or [])


def lifecycle_employee_defaults(employee: EmployeeRow) -> dict[str, str]:
    base = offer_employee_defaults(employee)
    return {
        "full_name": base.get("full_name") or employee.full_name or "",
        "employee_code": employee.code or "",
        "designation": employee.designation or "",
        "department": employee.department or "",
        "nationality": employee.nationality or "",
        "cpr_no": base.get("cpr_no") or "",
        "employee_name_arabic": base.get("employee_name_arabic") or "",
        "joining_date": base.get("joining_date") or "",
        "document_date": date.today().isoformat(),
        "signatory_name": "Authorized Signatory",
        "signatory_title": "Human Resources",
        "warning_level": "1st Notice",
        "basic_before": str(employee.monthly_salary) if employee.monthly_salary is not None else "",
        "basic_after": "",
        "increment_percentage": "",
        "effective_date": date.today().isoformat(),
        "previous_designation": employee.designation or "",
        "new_designation": "",
        "request_signature": "false",
        "recovery_method": RECOVERY_LUMP_SUM,
        "consent_acknowledged": "false",
        "monthly_salary_reference": (
            str(employee.monthly_salary) if employee.monthly_salary is not None else ""
        ),
        "tenure_months": "3",
    }


def _print_layout_for(
    session: Session,
    *,
    kind: str,
    params: dict[str, Any],
    form_fields: list[dict[str, Any]] | None = None,
) -> dict[str, list[dict[str, str]]]:
    fields = form_fields
    if fields is None:
        form = session.scalar(
            select(HrFormDefinitionRow).where(
                HrFormDefinitionRow.kind == kind,
                HrFormDefinitionRow.deleted_at.is_(None),
            )
        )
        fields = list(form.fields) if form else []
    return build_print_layout(fields, params, kind=kind)


def build_lifecycle_context(
    *,
    company: dict[str, Any],
    employee: dict[str, Any],
    kind: str,
    params: dict[str, Any],
    voucher_no: str | None,
    doc_number: int | None,
    logo_src: str | None,
    print_layout: dict[str, list[dict[str, str]]] | None = None,
) -> dict[str, Any]:
    title = KIND_TITLES.get(kind, "HR Document")
    prefix = VOUCHER_PREFIX.get(kind, "HR")
    ref = voucher_no or (f"{prefix}-DRAFT" if not doc_number else f"{prefix}-{doc_number:04d}")
    chrome = letterhead_footer_context(company)
    return {
        **chrome,
        "logo_src": logo_src,
        "employee": employee,
        "doc": {
            "ref": ref,
            "voucher_no": ref,
            "number": doc_number,
            "kind": kind,
            "title": title,
            "issue_date": params.get("document_date_long") or date.today().strftime("%d %B %Y"),
        },
        "params": params,
        "print_layout": print_layout
        or {z: [] for z in PRINT_ZONES if z != "hidden"},
        # Flat aliases for OrangeHRM-style tokens
        "increment": {
            "percentage": params.get("increment_percentage", ""),
            "basic_before": params.get("basic_before", ""),
            "basic_after": params.get("basic_after", ""),
        },
        "effective_date": params.get("effective_date_long") or params.get("effective_date", ""),
    }


def render_lifecycle_html(
    session: Session,
    *,
    source: str,
    template_obj: Any,
    context: dict[str, Any],
) -> str:
    if source == "database":
        return _string_jinja.from_string(template_obj.body_html).render(**context)
    return _file_jinja.get_template(template_obj.template_file).render(**context)


def preview_lifecycle_document(
    session: Session,
    *,
    branding_root: str | Path,
    kind: str,
    template_key: str,
    raw_params: dict[str, Any],
    employee_id: UUID | None = None,
    company_id: str | None = None,
) -> str:
    if kind not in LIFECYCLE_KINDS:
        raise DomainError("invalid_kind", f"Unsupported kind '{kind}'.")
    source, tpl, required, optional = _resolve_template(session, template_key, kind)
    form = session.scalar(
        select(HrFormDefinitionRow).where(
            HrFormDefinitionRow.kind == kind,
            HrFormDefinitionRow.deleted_at.is_(None),
        )
    )
    employee_row = _load_employee(session, employee_id) if employee_id else None
    merged = dict(raw_params)
    if employee_row is not None:
        for k, v in lifecycle_employee_defaults(employee_row).items():
            if merged.get(k) in (None, ""):
                merged[k] = v
    params = validate_lifecycle_params(
        required, optional, merged, form_fields=list(form.fields) if form else None
    )
    resolved_company_id = _resolve_company_id(session, company_id=company_id, employee=employee_row)
    company = _company_profile(session, resolved_company_id, require_arabic=False)
    logo = resolve_company_logo_path(session, branding_root, resolved_company_id)
    party = {
        "full_name": params.get("full_name") or (employee_row.full_name if employee_row else ""),
        "code": params.get("employee_code") or (employee_row.code if employee_row else ""),
        "designation": params.get("designation") or (employee_row.designation if employee_row else ""),
        "department": params.get("department") or (employee_row.department if employee_row else ""),
        "nationality": params.get("nationality") or "",
        "arabic_name": params.get("employee_name_arabic") or "",
    }
    ctx = build_lifecycle_context(
        company=company,
        employee=party,
        kind=kind,
        params=params,
        voucher_no=None,
        doc_number=None,
        logo_src=f"/v1/companies/{resolved_company_id}/logo" if logo else None,
        print_layout=_print_layout_for(
            session, kind=kind, params=params, form_fields=list(form.fields) if form else None
        ),
    )
    return render_lifecycle_html(session, source=source, template_obj=tpl, context=ctx)


def create_lifecycle_document(
    session: Session,
    *,
    document_root: str | Path,
    branding_root: str | Path,
    kind: str,
    template_key: str,
    raw_params: dict[str, Any],
    actor: str | None,
    employee_id: UUID | None = None,
    company_id: str | None = None,
    status: str = "issued",
) -> DocumentRow:
    if kind not in LIFECYCLE_KINDS:
        raise DomainError("invalid_kind", f"Unsupported kind '{kind}'.")
    if status not in SIGNATURE_STATUSES:
        raise DomainError("invalid_status", f"Unsupported status '{status}'.")
    source, tpl, required, optional = _resolve_template(session, template_key, kind)
    form = session.scalar(
        select(HrFormDefinitionRow).where(
            HrFormDefinitionRow.kind == kind,
            HrFormDefinitionRow.deleted_at.is_(None),
        )
    )
    employee_row = _load_employee(session, employee_id) if employee_id else None
    merged = dict(raw_params)
    if employee_row is not None:
        for k, v in lifecycle_employee_defaults(employee_row).items():
            if merged.get(k) in (None, ""):
                merged[k] = v
    params = validate_lifecycle_params(
        required, optional, merged, form_fields=list(form.fields) if form else None
    )
    # Signature request from template / params
    request_sig = str(params.get("request_signature", "")).lower() in {"1", "true", "yes"}
    if source == "database" and getattr(tpl, "request_signature", False):
        request_sig = True
    if request_sig and status == "issued":
        status = "pending_signature"

    resolved_company_id = _resolve_company_id(session, company_id=company_id, employee=employee_row)
    company = _company_profile(session, resolved_company_id, require_arabic=False)
    logo = resolve_company_logo_path(session, branding_root, resolved_company_id)

    document_date = date.fromisoformat(params["document_date"])
    joining_raw = params.get("joining_date")
    joining_date = date.fromisoformat(joining_raw) if joining_raw else None
    voucher_no = allocate_voucher_no(session, kind=kind, document_date=document_date)
    now = datetime.now(UTC)
    party_name = params.get("full_name") or "Employee"
    title = f"{KIND_TITLES[kind]} — {party_name}"

    basic_after = params.get("basic_after") or params.get("basic_before")
    basic_dec = Decimal(basic_after) if basic_after not in (None, "") else None

    row = DocumentRow(
        kind=kind,
        voucher_no=voucher_no,
        employee_id=employee_id,
        company_id=resolved_company_id,
        template_key=template_key,
        title=title[:200],
        status=status,
        document_date=document_date,
        joining_date=joining_date,
        narration=params.get("narration") or None,
        employee_name_arabic=params.get("employee_name_arabic") or None,
        cpr_no=params.get("cpr_no") or None,
        nature_of_employment=params.get("designation") or params.get("new_designation") or None,
        basic_salary=basic_dec,
        hra=Decimal(params["hra_after"]) if params.get("hra_after") else None,
        petrol_allowance=None,
        car_allowance=None,
        special_duty_allowance=None,
        net_amount=Decimal(params["total_after"]) if params.get("total_after") else basic_dec,
        traveling_airfare=False,
        additional_details=params.get("incident_summary")
        or params.get("mistake_summary")
        or params.get("reason")
        or None,
        params=params,
        issued_at=now,
        issued_by=actor,
        created_at=now,
        updated_at=now,
        created_by=actor,
        updated_by=actor,
    )
    session.add(row)
    session.flush()

    party = {
        "full_name": party_name,
        "code": params.get("employee_code") or (employee_row.code if employee_row else ""),
        "designation": params.get("designation") or "",
        "department": params.get("department") or "",
        "nationality": params.get("nationality") or "",
        "arabic_name": params.get("employee_name_arabic") or "",
    }
    ctx = build_lifecycle_context(
        company=company,
        employee=party,
        kind=kind,
        params=params,
        voucher_no=row.voucher_no,
        doc_number=row.document_number,
        logo_src=str(logo) if logo else None,
        print_layout=_print_layout_for(
            session, kind=kind, params=params, form_fields=list(form.fields) if form else None
        ),
    )
    html = render_lifecycle_html(session, source=source, template_obj=tpl, context=ctx)
    pdf_bytes = render_pdf(html)
    root = Path(document_root)
    root.mkdir(parents=True, exist_ok=True)
    pdf_path = root / f"{row.id}.pdf"
    pdf_path.write_bytes(pdf_bytes)
    row.pdf_key = pdf_path.name
    session.flush()

    if (
        kind == KIND_MISTAKE_FINE
        and str(params.get("recovery_method") or "").lower() == RECOVERY_CONVERT_LOAN
        and employee_id
        and not params.get("loan_id")
    ):
        row, _loan, _warnings = convert_mistake_fine_to_loan(
            session,
            document_id=row.id,
            document_root=document_root,
            branding_root=branding_root,
            actor=actor,
            consent_acknowledged=True,
        )
    return row


def update_lifecycle_document(
    session: Session,
    *,
    document_id: str,
    document_root: str | Path,
    branding_root: str | Path,
    raw_params: dict[str, Any],
    actor: str | None,
    if_match: int,
    employee_id: UUID | None = None,
    company_id: str | None = None,
    template_key: str | None = None,
    status: str | None = None,
) -> DocumentRow:
    """Edit an issued lifecycle letter and regenerate PDF (keeps voucher_no)."""
    row = get_document(session, document_id)
    if row.kind not in LIFECYCLE_KINDS:
        raise DomainError("invalid_kind", "Not an HR lifecycle document.")
    if row.version != if_match:
        raise DomainError("stale_version", "The document was modified by another user.")

    kind = row.kind
    key = template_key or row.template_key
    next_status = status or row.status or "issued"
    if next_status not in SIGNATURE_STATUSES:
        raise DomainError("invalid_status", f"Unsupported status '{next_status}'.")

    source, tpl, required, optional = _resolve_template(session, key, kind)
    form = session.scalar(
        select(HrFormDefinitionRow).where(
            HrFormDefinitionRow.kind == kind,
            HrFormDefinitionRow.deleted_at.is_(None),
        )
    )
    employee_row = _load_employee(session, employee_id) if employee_id else None
    merged = dict(raw_params)
    if employee_row is not None:
        for k, v in lifecycle_employee_defaults(employee_row).items():
            if merged.get(k) in (None, ""):
                merged[k] = v
    params = validate_lifecycle_params(
        required, optional, merged, form_fields=list(form.fields) if form else None
    )

    request_sig = str(params.get("request_signature", "")).lower() in {"1", "true", "yes"}
    if source == "database" and getattr(tpl, "request_signature", False):
        request_sig = True
    if request_sig and next_status == "issued":
        next_status = "pending_signature"

    resolved_company_id = _resolve_company_id(
        session,
        company_id=company_id,
        employee=employee_row,
        locked_company_id=str(row.company_id) if row.company_id else None,
    )
    company = _company_profile(session, resolved_company_id, require_arabic=False)
    logo = resolve_company_logo_path(session, branding_root, resolved_company_id)

    document_date = date.fromisoformat(params["document_date"])
    joining_raw = params.get("joining_date")
    joining_date = date.fromisoformat(joining_raw) if joining_raw else None
    now = datetime.now(UTC)
    party_name = params.get("full_name") or "Employee"
    title = f"{KIND_TITLES[kind]} — {party_name}"
    basic_after = params.get("basic_after") or params.get("basic_before")
    basic_dec = Decimal(basic_after) if basic_after not in (None, "") else None

    row.employee_id = employee_id
    row.company_id = resolved_company_id
    row.template_key = key
    row.title = title[:200]
    row.status = next_status
    row.document_date = document_date
    row.joining_date = joining_date
    row.narration = params.get("narration") or None
    row.employee_name_arabic = params.get("employee_name_arabic") or None
    row.cpr_no = params.get("cpr_no") or None
    row.nature_of_employment = (
        params.get("designation") or params.get("new_designation") or None
    )
    row.basic_salary = basic_dec
    row.hra = Decimal(params["hra_after"]) if params.get("hra_after") else None
    row.net_amount = (
        Decimal(params["total_after"]) if params.get("total_after") else basic_dec
    )
    row.additional_details = (
        params.get("incident_summary")
        or params.get("mistake_summary")
        or params.get("reason")
        or None
    )
    row.params = params
    row.updated_at = now
    row.updated_by = actor
    row.version = int(row.version or 1) + 1

    party = {
        "full_name": party_name,
        "code": params.get("employee_code") or (employee_row.code if employee_row else ""),
        "designation": params.get("designation") or "",
        "department": params.get("department") or "",
        "nationality": params.get("nationality") or "",
        "arabic_name": params.get("employee_name_arabic") or "",
    }
    ctx = build_lifecycle_context(
        company=company,
        employee=party,
        kind=kind,
        params=params,
        voucher_no=row.voucher_no,
        doc_number=row.document_number,
        logo_src=str(logo) if logo else None,
        print_layout=_print_layout_for(
            session, kind=kind, params=params, form_fields=list(form.fields) if form else None
        ),
    )
    html = render_lifecycle_html(session, source=source, template_obj=tpl, context=ctx)
    pdf_bytes = render_pdf(html)
    root = Path(document_root)
    root.mkdir(parents=True, exist_ok=True)
    pdf_path = root / f"{row.id}.pdf"
    pdf_path.write_bytes(pdf_bytes)
    row.pdf_key = pdf_path.name
    session.flush()

    # Auto-convert Mistake with Fine → loan when recovery_method requests it
    if (
        kind == KIND_MISTAKE_FINE
        and str(params.get("recovery_method") or "").lower() == RECOVERY_CONVERT_LOAN
        and employee_id
        and not params.get("loan_id")
    ):
        row, _loan, _warnings = convert_mistake_fine_to_loan(
            session,
            document_id=row.id,
            document_root=document_root,
            branding_root=branding_root,
            actor=actor,
            consent_acknowledged=True,
        )
    return row


def update_signature_status(
    session: Session,
    document_id: str,
    *,
    status: str,
    signature_data: str | None = None,
    actor: str | None = None,
) -> DocumentRow:
    """Track signature lifecycle without breaking issued PDFs (params snapshot)."""
    if status not in SIGNATURE_STATUSES:
        raise DomainError("invalid_status", f"Unsupported status '{status}'.")
    row = session.scalar(
        select(DocumentRow).where(DocumentRow.id == document_id, DocumentRow.deleted_at.is_(None))
    )
    if row is None:
        raise DomainError("not_found", "Document not found.")
    if row.kind not in LIFECYCLE_KINDS:
        raise DomainError("invalid_kind", "Signature tracking applies to lifecycle documents only.")
    params = dict(row.params or {})
    if signature_data:
        # Store data-URL / base64 marker only — not a binary column change
        params["signature_captured_at"] = utc_now().isoformat()
        params["signature_by"] = actor or ""
        params["signature_present"] = "true"
        # Cap stored payload
        params["signature_data"] = signature_data[:200_000]
    row.params = params
    row.status = status
    row.updated_by = actor
    row.updated_at = utc_now()
    row.version = int(row.version or 1) + 1
    session.flush()
    return row
