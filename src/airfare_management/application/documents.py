"""HR document generation: offer letters and employment contracts.

Voucher model is inspired by Focus Soft Offer Letter / CONTRACT OF EMPLOYMENT
(document no, joining date, salary grid, nationality/department on print),
but all data lives in the ATLAS HCM database — no Focus8080 runtime dependency.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import re
from typing import Any
from uuid import UUID

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from airfare_management.domain.models import DomainError
from airfare_management.infrastructure.database import EmployeeRow
from airfare_management.infrastructure.schema import CompanyRow, DocumentRow

TEMPLATES_ROOT = Path(__file__).resolve().parent.parent / "templates"
FONTS_DIR = TEMPLATES_ROOT / "documents" / "fonts"

KIND_OFFER = "offer_letter"
KIND_CONTRACT = "contract"
DOCUMENT_KINDS = (KIND_OFFER, KIND_CONTRACT)

VOUCHER_PREFIX = {
    KIND_OFFER: "OFL",
    KIND_CONTRACT: "CO",
}


@dataclass(frozen=True, slots=True)
class TemplateInfo:
    """A selectable document template with its parameter requirements."""

    key: str
    kind: str
    label: str
    description: str
    template: str
    required_params: tuple[str, ...]
    optional_params: tuple[str, ...]


# Focus-inspired voucher fields (party on-screen; Employee Master optional)
_COMMON_REQUIRED = (
    "full_name",
    "nationality",
    "nature_of_employment",
    "joining_date",
    "document_date",
    "probation_months",
    "basic",
    "annual_leave_days",
)
_COMMON_OPTIONAL = (
    "passport_no",
    "narration",
    "employee_name_arabic",
    "cpr_no",
    "department",
    "hra",
    "petrol_allowance",
    "car_allowance",
    "special_duty_allowance",
    "signatory_name",
    "signatory_title",
    "special_terms",
    "additional_details",
)

TEMPLATES: tuple[TemplateInfo, ...] = (
    TemplateInfo(
        key="offer_default",
        kind=KIND_OFFER,
        label="Offer Letter",
        description="Focus-style offer with Basic / HRA / Petrol / Car / Special Duty grid.",
        template="documents/offer_letter/default.html",
        required_params=_COMMON_REQUIRED,
        optional_params=_COMMON_OPTIONAL + ("traveling_airfare", "offer_valid_until"),
    ),
    TemplateInfo(
        key="contract_unlimited",
        kind=KIND_CONTRACT,
        label="Contract of Employment — Unlimited",
        description="Open-ended contract with Focus-style compensation and address block.",
        template="documents/contract/unlimited.html",
        required_params=_COMMON_REQUIRED + ("working_hours", "notice_period_days"),
        optional_params=_COMMON_OPTIONAL
        + ("address_villa", "address_street", "address_block", "nature_of_employment_arabic"),
    ),
    TemplateInfo(
        key="contract_limited",
        kind=KIND_CONTRACT,
        label="Contract of Employment — Limited",
        description="Fixed-term contract with computed end date and Focus-style salary grid.",
        template="documents/contract/limited.html",
        required_params=_COMMON_REQUIRED
        + ("working_hours", "notice_period_days", "duration_months"),
        optional_params=_COMMON_OPTIONAL
        + ("address_villa", "address_street", "address_block", "nature_of_employment_arabic"),
    ),
)

_TEMPLATE_INDEX = {item.key: item for item in TEMPLATES}

_jinja = Environment(
    loader=FileSystemLoader(str(TEMPLATES_ROOT)),
    autoescape=select_autoescape(("html", "xml")),
)


class DocumentParamsError(DomainError):
    """Invalid document parameter set."""

    def __init__(self, detail: str) -> None:
        super().__init__("invalid_document_params", detail)


def list_templates() -> list[dict[str, Any]]:
    """Describe every selectable template for the API/UI."""
    return [
        {
            "key": item.key,
            "kind": item.kind,
            "label": item.label,
            "description": item.description,
            "required_params": list(item.required_params),
            "optional_params": list(item.optional_params),
        }
        for item in TEMPLATES
    ]


def employee_defaults(employee: EmployeeRow) -> dict[str, str]:
    """Prefill voucher fields from Employee Master (optional helper)."""
    today = date.today().isoformat()
    return {
        "full_name": employee.full_name or "",
        "nationality": employee.nationality or "",
        "passport_no": employee.passport_no or "",
        "department": employee.department or "",
        "nature_of_employment": employee.designation or "",
        "joining_date": employee.join_date.isoformat() if employee.join_date else today,
        "document_date": today,
        "cpr_no": getattr(employee, "cpr_no", None) or "",
        "employee_name_arabic": getattr(employee, "arabic_name", None) or "",
        "basic": str(employee.monthly_salary) if employee.monthly_salary is not None else "",
        "probation_months": "3",
        "annual_leave_days": "30",
        "hra": "",
        "petrol_allowance": "",
        "car_allowance": "",
        "special_duty_allowance": "",
        "working_hours": "48",
        "notice_period_days": "30",
        "duration_months": "24",
        "offer_valid_until": (date.today() + timedelta(days=7)).isoformat(),
        "traveling_airfare": "true",
        "narration": "",
        "additional_details": "",
        "address_villa": "",
        "address_street": "",
        "address_block": "",
        "nature_of_employment_arabic": "",
        "signatory_name": "Authorized Signatory",
        "signatory_title": "Human Resources",
        "special_terms": "",
    }


def blank_voucher_defaults() -> dict[str, str]:
    """Empty Focus-style voucher defaults (no Employee Master)."""
    today = date.today().isoformat()
    return {
        "full_name": "",
        "nationality": "",
        "passport_no": "",
        "department": "",
        "nature_of_employment": "",
        "joining_date": today,
        "document_date": today,
        "cpr_no": "",
        "employee_name_arabic": "",
        "basic": "",
        "probation_months": "3",
        "annual_leave_days": "30",
        "hra": "0",
        "petrol_allowance": "0",
        "car_allowance": "0",
        "special_duty_allowance": "0",
        "working_hours": "48",
        "notice_period_days": "30",
        "duration_months": "24",
        "offer_valid_until": (date.today() + timedelta(days=7)).isoformat(),
        "traveling_airfare": "true",
        "narration": "",
        "additional_details": "",
        "address_villa": "",
        "address_street": "",
        "address_block": "",
        "nature_of_employment_arabic": "",
        "signatory_name": "Authorized Signatory",
        "signatory_title": "Human Resources",
        "special_terms": "",
    }


def _amount_in_words(value: Decimal, currency: str = "Bahraini Dinars") -> str:
    """Simple English amount-in-words for print (Focus: Total amount in Words)."""
    units = [
        "Zero",
        "One",
        "Two",
        "Three",
        "Four",
        "Five",
        "Six",
        "Seven",
        "Eight",
        "Nine",
        "Ten",
        "Eleven",
        "Twelve",
        "Thirteen",
        "Fourteen",
        "Fifteen",
        "Sixteen",
        "Seventeen",
        "Eighteen",
        "Nineteen",
    ]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def under_thousand(n: int) -> str:
        if n < 20:
            return units[n]
        if n < 100:
            return tens[n // 10] + ("" if n % 10 == 0 else "-" + units[n % 10])
        return (
            units[n // 100]
            + " Hundred"
            + ("" if n % 100 == 0 else " and " + under_thousand(n % 100))
        )

    quantized = value.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    whole = int(quantized)
    fils = int((quantized - whole) * 1000)
    if whole == 0:
        words = "Zero"
    else:
        parts: list[str] = []
        millions = whole // 1_000_000
        thousands = (whole % 1_000_000) // 1000
        rest = whole % 1000
        if millions:
            parts.append(under_thousand(millions) + " Million")
        if thousands:
            parts.append(under_thousand(thousands) + " Thousand")
        if rest:
            parts.append(under_thousand(rest))
        words = " ".join(parts)
    result = f"{words} {currency}"
    if fils:
        result += f" and {fils:03d}/1000"
    return result + " Only"


def _money(value: Decimal | None, currency: str = "") -> str | None:
    if value is None:
        return None
    quantized = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    prefix = f"{currency} " if currency else ""
    return f"{prefix}{quantized:,.3f}"


def _money_focus(value: Decimal | None) -> str | None:
    """Focus Soft salary grid style: ``350.00/-``."""
    if value is None:
        return None
    quantized = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{quantized:,.2f}/-"


def _amount_in_words_focus(value: Decimal) -> str:
    """Focus Soft words line: ``Bahraini Dinar …***``."""
    base = _amount_in_words(value, currency="Bahraini Dinar").removesuffix(" Only")
    return f"{base}***"


def _eastern_digits(text: str) -> str:
    """Convert Western digits to Eastern Arabic numerals (Focus AR column)."""
    return str(text).translate(str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩"))


def _focus_date(value: date) -> str:
    """Focus Soft date style: ``30/August/2026``."""
    return value.strftime("%d/%B/%Y")


def _focus_date_ar(value: date) -> str:
    """Focus Soft Arabic date run: ``05/09/2026`` (LTR digits; avoids RTL digit flip)."""
    return value.strftime("%d/%m/%Y")


def _focus_weekday_date(value: date) -> str:
    """Focus Soft signature date: ``Sunday/August 30/2026``."""
    return value.strftime("%A/%B %d/%Y")


_NATIONALITY_AR = {
    "BAHRAINI": "بحريني",
    "BAHRAIN": "بحريني",
    "INDIAN": "هندي",
    "PAKISTANI": "باكستاني",
    "EGYPTIAN": "مصري",
    "FILIPINO": "فلبيني",
    "BANGLADESHI": "بنغلاديشي",
    "NEPALESE": "نيبالي",
    "SRI LANKAN": "سريلانكي",
}

_COMPANY_NAME_AR = {
    "atlas aluminum": "شركة أطلس ألمنيوم",
}


def _long_date(value: date) -> str:
    return value.strftime("%d %B %Y")


def _add_months(start: date, months: int) -> date:
    """Calendar-month addition clamped to month end."""
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    days_in_month = [
        31,
        29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ][month - 1]
    return date(year, month, min(start.day, days_in_month))


def _decimal_param(params: dict[str, Any], key: str, *, required: bool = False) -> Decimal | None:
    raw = params.get(key)
    if raw in (None, ""):
        if required:
            raise DocumentParamsError(f"'{key}' is required.")
        return None
    try:
        value = Decimal(str(raw))
    except Exception as exc:  # noqa: BLE001
        raise DocumentParamsError(f"'{key}' must be a number.") from exc
    if value < 0:
        raise DocumentParamsError(f"'{key}' cannot be negative.")
    return value


def _int_param(params: dict[str, Any], key: str, *, minimum: int, maximum: int) -> int:
    raw = params.get(key)
    try:
        value = int(str(raw))
    except Exception as exc:  # noqa: BLE001
        raise DocumentParamsError(f"'{key}' must be a whole number.") from exc
    if not minimum <= value <= maximum:
        raise DocumentParamsError(f"'{key}' must be between {minimum} and {maximum}.")
    return value


def _date_param(params: dict[str, Any], key: str) -> date:
    raw = params.get(key)
    try:
        return date.fromisoformat(str(raw))
    except Exception as exc:  # noqa: BLE001
        raise DocumentParamsError(f"'{key}' must be an ISO date (YYYY-MM-DD).") from exc


def _text_param(params: dict[str, Any], key: str, *, required: bool = False, limit: int = 200) -> str:
    value = str(params.get(key) or "").strip()
    if required and not value:
        raise DocumentParamsError(f"'{key}' is required.")
    if len(value) > limit:
        raise DocumentParamsError(f"'{key}' must be at most {limit} characters.")
    return value


def _bool_param(params: dict[str, Any], key: str, *, default: bool = False) -> bool:
    raw = params.get(key)
    if raw in (None, ""):
        return default
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


def validate_params(template: TemplateInfo, params: dict[str, Any]) -> dict[str, Any]:
    """Validate raw UI params and derive Focus-style formatted values."""
    # Back-compat aliases from older UI field names
    if params.get("nature_of_employment") in (None, "") and params.get("position_title"):
        params["nature_of_employment"] = params["position_title"]
    if params.get("joining_date") in (None, "") and params.get("start_date"):
        params["joining_date"] = params["start_date"]
    if params.get("basic") in (None, "") and params.get("basic_salary"):
        params["basic"] = params["basic_salary"]
    if params.get("hra") in (None, "") and params.get("housing_allowance"):
        params["hra"] = params["housing_allowance"]
    if params.get("document_date") in (None, ""):
        params["document_date"] = date.today().isoformat()

    missing = [key for key in template.required_params if params.get(key) in (None, "")]
    if missing:
        raise DocumentParamsError(f"Missing required field(s): {', '.join(missing)}.")

    joining = _date_param(params, "joining_date")
    document_date = _date_param(params, "document_date")
    basic = _decimal_param(params, "basic", required=True) or Decimal(0)
    hra = _decimal_param(params, "hra") or Decimal(0)
    petrol = _decimal_param(params, "petrol_allowance") or Decimal(0)
    car = _decimal_param(params, "car_allowance") or Decimal(0)
    special = _decimal_param(params, "special_duty_allowance") or Decimal(0)
    net = basic + hra + petrol + car + special

    cleaned: dict[str, Any] = {
        "full_name": _text_param(params, "full_name", required=True, limit=200),
        "nationality": _text_param(params, "nationality", required=True, limit=80),
        "passport_no": _text_param(params, "passport_no", limit=40),
        "department": _text_param(params, "department", limit=120),
        "nature_of_employment": _text_param(
            params, "nature_of_employment", required=True, limit=120
        ),
        "nature_of_employment_arabic": _text_param(
            params, "nature_of_employment_arabic", limit=120
        ),
        "joining_date": joining.isoformat(),
        "joining_date_long": _long_date(joining),
        "document_date": document_date.isoformat(),
        "document_date_long": _long_date(document_date),
        "start_date": joining.isoformat(),
        "start_date_long": _long_date(joining),
        "probation_months": _int_param(params, "probation_months", minimum=0, maximum=12),
        "basic": str(basic),
        "basic_salary": str(basic),
        "hra": str(hra),
        "petrol_allowance": str(petrol),
        "car_allowance": str(car),
        "special_duty_allowance": str(special),
        "net": str(net),
        "annual_leave_days": _int_param(params, "annual_leave_days", minimum=0, maximum=120),
        "signatory_name": _text_param(params, "signatory_name", limit=120) or "Authorized Signatory",
        "signatory_title": _text_param(params, "signatory_title", limit=120) or "Human Resources",
        "special_terms": _text_param(params, "special_terms", limit=2000),
        "narration": _text_param(params, "narration", limit=2000),
        "employee_name_arabic": _text_param(params, "employee_name_arabic", limit=200),
        "cpr_no": _text_param(params, "cpr_no", limit=40),
        "additional_details": _text_param(params, "additional_details", limit=2000),
        "address_villa": _text_param(params, "address_villa", limit=120),
        "address_street": _text_param(params, "address_street", limit=120),
        "address_block": _text_param(params, "address_block", limit=40),
        "traveling_airfare": _bool_param(params, "traveling_airfare", default=True),
        "basic_fmt": _money(basic),
        "hra_fmt": _money(hra),
        "petrol_allowance_fmt": _money(petrol),
        "car_allowance_fmt": _money(car),
        "special_duty_allowance_fmt": _money(special),
        "net_fmt": _money(net),
        "net_in_words": _amount_in_words(net),
        # Focus Soft contract/offer salary presentation
        "basic_fmt_focus": _money_focus(basic),
        "hra_fmt_focus": _money_focus(hra),
        "petrol_allowance_fmt_focus": _money_focus(petrol),
        "car_allowance_fmt_focus": _money_focus(car),
        "special_duty_allowance_fmt_focus": _money_focus(special),
        "net_fmt_focus": _money_focus(net),
        "net_in_words_focus": _amount_in_words_focus(net),
        "document_date_focus": _focus_date(document_date),
        "document_date_focus_ar": _focus_date_ar(document_date),
        "document_weekday_focus": _focus_weekday_date(document_date),
        "document_weekday_focus_ar": _focus_date_ar(document_date),
        "basic_fmt_focus_ar": _eastern_digits(_money_focus(basic) or ""),
        "hra_fmt_focus_ar": _eastern_digits(_money_focus(hra) or "") if hra else None,
        "petrol_allowance_fmt_focus_ar": _eastern_digits(_money_focus(petrol) or "") if petrol else None,
        "car_allowance_fmt_focus_ar": _eastern_digits(_money_focus(car) or "") if car else None,
        "special_duty_allowance_fmt_focus_ar": (
            _eastern_digits(_money_focus(special) or "") if special else None
        ),
        "net_fmt_focus_ar": _eastern_digits(_money_focus(net) or ""),
        "net_in_words_ar": "بالدينار البحريني حسب المبلغ الإجمالي",
        "nationality_ar": _NATIONALITY_AR.get(
            str(params.get("nationality") or "").strip().upper(),
            str(params.get("nationality") or ""),
        ),
        # legacy template keys
        "basic_salary_fmt": _money(basic),
        "housing_allowance_fmt": _money(hra) if hra else None,
        "transport_allowance_fmt": _money(petrol + car) if (petrol + car) else None,
        "other_allowance_fmt": _money(special) if special else None,
        "gross_salary_fmt": _money(net),
        "position_title": _text_param(params, "nature_of_employment", required=True, limit=120),
    }

    if template.key == "offer_default":
        raw_valid = params.get("offer_valid_until")
        if raw_valid in (None, ""):
            valid_until = document_date + timedelta(days=7)
        else:
            valid_until = _date_param(params, "offer_valid_until")
        if valid_until < date.today():
            raise DocumentParamsError("'offer_valid_until' cannot be in the past.")
        cleaned["offer_valid_until"] = valid_until.isoformat()
        cleaned["offer_valid_until_long"] = _long_date(valid_until)

    if template.kind == KIND_CONTRACT:
        cleaned["working_hours"] = _int_param(params, "working_hours", minimum=1, maximum=84)
        cleaned["notice_period_days"] = _int_param(
            params, "notice_period_days", minimum=0, maximum=365
        )
        cleaned["probation_months_ar"] = _eastern_digits(str(cleaned["probation_months"]))
        cleaned["annual_leave_days_ar"] = _eastern_digits(str(cleaned["annual_leave_days"]))
        cleaned["working_hours_ar"] = _eastern_digits(str(cleaned["working_hours"]))
        cleaned["notice_period_days_ar"] = _eastern_digits(str(cleaned["notice_period_days"]))

    if template.key == "contract_limited":
        duration = _int_param(params, "duration_months", minimum=1, maximum=120)
        end = _add_months(joining, duration)
        end = date.fromordinal(end.toordinal() - 1)
        cleaned["duration_months"] = duration
        cleaned["end_date"] = end.isoformat()
        cleaned["end_date_long"] = _long_date(end)

    return cleaned


def allocate_voucher_no(session: Session, *, kind: str, document_date: date) -> str:
    """Allocate OFL-YY-NNN / CO-YY-NNN like Focus document numbers."""
    prefix = VOUCHER_PREFIX[kind]
    yy = f"{document_date.year % 100:02d}"
    pattern = f"{prefix}-{yy}-"
    existing = session.scalars(
        select(DocumentRow.voucher_no).where(
            DocumentRow.kind == kind,
            DocumentRow.voucher_no.is_not(None),
            DocumentRow.voucher_no.like(f"{pattern}%"),
        )
    ).all()
    max_seq = 0
    for value in existing:
        try:
            max_seq = max(max_seq, int(str(value).rsplit("-", 1)[-1]))
        except ValueError:
            continue
    return f"{pattern}{max_seq + 1:03d}"


def _resolve_company_id(
    session: Session,
    *,
    company_id: UUID | None,
    employee: EmployeeRow | None = None,
) -> str:
    """Prefer explicit company; fall back to employee company when linked."""
    if company_id is not None:
        cid = str(company_id)
        if session.get(CompanyRow, cid) is None:
            raise DomainError("invalid_company", "Selected company does not exist.")
        return cid
    if employee is not None:
        emp_cid = str(employee.company_id) if employee.company_id else ""
        if emp_cid and session.get(CompanyRow, emp_cid) is not None:
            return emp_cid
    raise DomainError("invalid_company", "Company is required for offer/contract vouchers.")


def _company_profile(session: Session, company_id: str) -> dict[str, Any]:
    company = session.get(CompanyRow, company_id)
    if company is None:
        raise DomainError("invalid_company", "The selected company does not exist.")
    name = company.name or ""
    arabic_name = _COMPANY_NAME_AR.get(name.strip().lower(), "")
    return {
        "name": name,
        "arabic_name": arabic_name or name,
        "code": company.code,
        "currency": company.currency or "BHD",
        "cr_no": (getattr(company, "cr_no", None) or "").strip(),
        "address": getattr(company, "address", None) or "",
    }


def _party_from_params(
    params: dict[str, Any], employee: EmployeeRow | None = None
) -> dict[str, Any]:
    """Build print party block from voucher params (Employee Master optional)."""
    return {
        "code": employee.code if employee is not None else "",
        "full_name": params.get("full_name")
        or (employee.full_name if employee is not None else "")
        or "",
        "arabic_name": params.get("employee_name_arabic")
        or (getattr(employee, "arabic_name", None) if employee is not None else None)
        or "",
        "designation": params.get("nature_of_employment")
        or (employee.designation if employee is not None else None)
        or "",
        "department": params.get("department")
        or (employee.department if employee is not None else None)
        or "",
        "branch": employee.branch if employee is not None else "",
        "nationality": params.get("nationality")
        or (employee.nationality if employee is not None else None)
        or "",
        "passport_no": params.get("passport_no")
        or (employee.passport_no if employee is not None else None)
        or "",
        "cpr_no": params.get("cpr_no")
        or (getattr(employee, "cpr_no", None) if employee is not None else None)
        or "",
        "email": employee.email if employee is not None else "",
    }


def build_context(
    *,
    company: dict[str, Any],
    party: dict[str, Any],
    kind: str,
    params: dict[str, Any],
    doc_number: int | None,
    voucher_no: str | None,
    logo_src: str | None,
) -> dict[str, Any]:
    """Assemble the full Jinja context for one render."""
    title = "Offer Letter" if kind == KIND_OFFER else "Contract of Employment"
    ref = voucher_no or (
        f"{VOUCHER_PREFIX[kind]}-DRAFT"
        if not doc_number
        else f"{VOUCHER_PREFIX[kind]}-{doc_number:04d}"
    )
    return {
        "company": company,
        "logo_src": logo_src,
        "employee": party,  # templates keep {{ employee.* }} for Focus parity
        "doc": {
            "ref": ref,
            "voucher_no": ref,
            "number": doc_number,
            "kind": kind,
            "title": title,
            "issue_date": params.get("document_date_long") or date.today().strftime("%d %b %Y"),
            "issue_date_long": params.get("document_date_long") or _long_date(date.today()),
            "joining_date_long": params.get("joining_date_long"),
        },
        "params": params,
    }


def render_html(template: TemplateInfo, context: dict[str, Any]) -> str:
    """Render the Jinja template to a full HTML document."""
    return _jinja.get_template(template.template).render(**context)


def _get_display(shaped: str) -> str:
    """python-bidi 0.4 uses ``bidi.algorithm``; 0.5+ uses ``bidi.get_display``."""
    try:
        from bidi.algorithm import get_display
    except ImportError:  # pragma: no cover - version skew
        from bidi import get_display  # type: ignore[no-redef]
    return get_display(shaped, base_dir="R")


def _shape_arabic(text: str) -> str:
    """Shape + visually reorder Arabic for xhtml2pdf (draw-based, LTR canvas).

    xhtml2pdf lacks Chromium HarfBuzz/bidi. The proven pattern is
    ``arabic-reshaper`` + ``python-bidi`` on each *full* text node (Arabic and
    any inline Latin together). CSS Arabic cells must use ``direction: ltr``
    with ``text-align: right`` so the engine does not reverse a second time.

    Do **not** reshape Arabic runs separately from neighboring Latin — that
    breaks mixed offer-letter sentences (company name / job title / voucher).
    """
    if not text or not any("\u0600" <= ch <= "\u06FF" for ch in text):
        return text
    try:
        import arabic_reshaper
    except ImportError:
        return text
    try:
        font_path = Path(r"C:\Airfare_Allowance\.pdf_fonts\TraditionalArabic.ttf")
        if font_path.exists() and hasattr(arabic_reshaper, "config_for_true_type_font"):
            cfg = arabic_reshaper.config_for_true_type_font(str(font_path))
            shaped = arabic_reshaper.ArabicReshaper(configuration=cfg).reshape(text)
        else:
            shaped = arabic_reshaper.reshape(text)
        return _get_display(shaped)
    except Exception:
        try:
            return _get_display(arabic_reshaper.reshape(text))
        except Exception:
            return text


_LTR_ISLAND_RE = re.compile(
    r"<(span|bdi)\b([^>]*?)>(.*?)</\1>",
    re.IGNORECASE | re.DOTALL,
)


def _flatten_ltr_islands(html: str) -> str:
    """Unwrap ``dir=ltr`` / ``ltr-iso`` spans so mixed AR+EN stays one text run."""

    def _replace(match: re.Match[str]) -> str:
        attrs = match.group(2).lower()
        inner = match.group(3)
        if 'dir="ltr"' in attrs or "dir='ltr'" in attrs or "ltr-iso" in attrs:
            # LRM keeps Latin/numbers from being mirrored by the bidi pass.
            return f"\u200e{inner}\u200e"
        return match.group(0)

    prev = None
    out = html
    while prev != out:
        prev = out
        out = _LTR_ISLAND_RE.sub(_replace, out)
    return out


def _reshape_arabic_in_html(html: str) -> str:
    """Shape Arabic text nodes for xhtml2pdf as whole runs (incl. inline Latin)."""
    flat = _flatten_ltr_islands(html)
    parts = re.split(r"(<[^>]+>)", flat)
    out: list[str] = []
    for part in parts:
        if part.startswith("<"):
            out.append(part)
            continue
        # Shape the entire text node when it contains Arabic so mixed EN/AR
        # (company, voucher, amounts) keeps correct visual order.
        if any("\u0600" <= ch <= "\u06FF" for ch in part):
            out.append(_shape_arabic(part))
        else:
            out.append(part)
    return "".join(out)


def _register_pdf_fonts() -> None:
    """Register Tahoma + Traditional Arabic for xhtml2pdf (no @font-face temp copy)."""
    import shutil

    from reportlab.lib.fonts import addMapping
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from xhtml2pdf import default as pisa_default

    # Avoid paths with spaces — xhtml2pdf/reportlab are fragile with them.
    runtime = Path(r"C:\Airfare_Allowance\.pdf_fonts")
    runtime.mkdir(parents=True, exist_ok=True)
    for name in (
        "Tahoma.ttf",
        "Arial.ttf",
        "Arial-Bold.ttf",
        "SimplifiedArabic.ttf",
        "TraditionalArabic.ttf",
        "TraditionalArabic-Bold.ttf",
        "TimesNewRoman.ttf",
        "TimesNewRoman-Bold.ttf",
    ):
        src = FONTS_DIR / name
        dest = runtime / name
        runtime_src = Path(r"C:\Airfare_Allowance\.pdf_fonts") / name
        # Prefer workspace runtime fonts (includes Windows copies).
        chosen = runtime_src if runtime_src.exists() else src
        if chosen.exists() and (not dest.exists() or dest.stat().st_size != chosen.stat().st_size):
            shutil.copy2(chosen, dest)

    families = {
        "DocSans": (
            runtime / "Arial.ttf" if (runtime / "Arial.ttf").exists() else runtime / "Tahoma.ttf",
            runtime / "Arial-Bold.ttf" if (runtime / "Arial-Bold.ttf").exists() else runtime / "Tahoma.ttf",
        ),
        "DocSerif": (
            runtime / "TimesNewRoman.ttf",
            runtime / "TimesNewRoman-Bold.ttf",
        ),
        "DocArabic": (
            runtime / "SimplifiedArabic.ttf"
            if (runtime / "SimplifiedArabic.ttf").exists()
            else runtime / "TraditionalArabic.ttf",
            runtime / "TraditionalArabic-Bold.ttf"
            if (runtime / "TraditionalArabic-Bold.ttf").exists()
            else runtime / "SimplifiedArabic.ttf",
        ),
    }
    for family, (regular, bold) in families.items():
        normal_key = f"{family}_00"
        bold_key = f"{family}_10"
        if regular.exists() and normal_key not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(normal_key, str(regular)))
        bold_path = bold if bold.exists() else regular
        if bold_path.exists() and bold_key not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(bold_key, str(bold_path)))
        if normal_key in pdfmetrics.getRegisteredFontNames():
            addMapping(family, 0, 0, normal_key)
            addMapping(family, 0, 1, normal_key)
            addMapping(
                family,
                1,
                0,
                bold_key if bold_key in pdfmetrics.getRegisteredFontNames() else normal_key,
            )
            addMapping(
                family,
                1,
                1,
                bold_key if bold_key in pdfmetrics.getRegisteredFontNames() else normal_key,
            )
            pisa_default.DEFAULT_FONT[family.lower()] = family


def _pdf_link_callback(uri: str, rel: str) -> str:  # noqa: ARG001
    """Resolve absolute logo paths for xhtml2pdf."""
    from urllib.parse import unquote, urlparse

    if uri.startswith("file:"):
        parsed = urlparse(uri)
        path = unquote(parsed.path or "")
        if path.startswith("/") and len(path) > 2 and path[2] == ":":
            path = path[1:]
        path = path.replace("/", "\\")
        if Path(path).exists():
            return path
        cleaned = unquote(uri.replace("file:///", "").replace("file://", ""))
        return cleaned.replace("/", "\\")
    path = Path(unquote(uri))
    if path.exists():
        return str(path)
    return uri


def _find_chromium_executable() -> Path | None:
    """Prefer a local Chrome/Edge binary for HarfBuzz-quality Arabic PDF."""
    candidates = [
        Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    ]
    for path in candidates:
        if path.exists():
            return path
    return None


def _prepare_chromium_html(html: str) -> str:
    """Logical Arabic + @font-face + file:// assets for headless Chromium."""
    runtime = Path(r"C:\Airfare_Allowance\.pdf_fonts")
    faces: list[str] = []
    # One file per (family, weight) — duplicate faces make Chromium pick the last
    # (e.g. Tahoma over Arial, Traditional over Simplified).
    chosen: dict[tuple[str, str], Path] = {}
    candidates = (
        ("DocSans", "normal", (runtime / "Arial.ttf", runtime / "Tahoma.ttf")),
        ("DocSans", "bold", (runtime / "Arial-Bold.ttf", runtime / "Arial.ttf", runtime / "Tahoma.ttf")),
        ("DocSerif", "normal", (runtime / "TimesNewRoman.ttf",)),
        ("DocSerif", "bold", (runtime / "TimesNewRoman-Bold.ttf", runtime / "TimesNewRoman.ttf")),
        (
            "DocArabic",
            "normal",
            (runtime / "SimplifiedArabic.ttf", runtime / "TraditionalArabic.ttf"),
        ),
        (
            "DocArabic",
            "bold",
            (
                runtime / "TraditionalArabic-Bold.ttf",
                runtime / "SimplifiedArabic.ttf",
                runtime / "TraditionalArabic.ttf",
            ),
        ),
    )
    for family, weight, paths in candidates:
        for path in paths:
            if path.exists():
                chosen[(family, weight)] = path
                break
    for (family, weight), path in chosen.items():
        faces.append(
            f"@font-face {{ font-family: '{family}'; src: url('{path.resolve().as_uri()}'); "
            f"font-weight: {weight}; font-style: normal; }}"
        )
    prepared = html
    if faces and "<style>" in prepared:
        prepared = prepared.replace("<style>", "<style>\n  " + "\n  ".join(faces) + "\n", 1)

    # xhtml2pdf-only tags / frames
    prepared = re.sub(r"<pdf:[^>]+/?>", "", prepared, flags=re.IGNORECASE)
    prepared = prepared.replace("Page  of ", "")
    prepared = prepared.replace("Page ·", "·")
    prepared = prepared.replace("· Page", "·")

    # Ensure body marks Chromium engine (real RTL CSS).
    if re.search(r"<body\b", prepared, flags=re.IGNORECASE):
        prepared = re.sub(
            r"<body\b([^>]*)>",
            lambda m: (
                m.group(0)
                if "pdf-chromium" in m.group(0)
                else f'<body class="pdf-chromium"{m.group(1)}>'
                if "class=" not in m.group(1)
                else re.sub(
                    r'class="([^"]*)"',
                    r'class="\1 pdf-chromium"',
                    m.group(0),
                    count=1,
                )
            ),
            prepared,
            count=1,
            flags=re.IGNORECASE,
        )

    def _img_to_file_uri(match: re.Match[str]) -> str:
        src = match.group(1)
        if src.startswith(("http://", "https://", "data:", "file:")):
            return match.group(0)
        path = Path(src)
        if path.exists():
            return f'src="{path.resolve().as_uri()}"'
        return match.group(0)

    prepared = re.sub(r'src="([^"]+)"', _img_to_file_uri, prepared)
    return prepared


def _render_pdf_chromium(html: str) -> bytes:
    """Print HTML to A4 PDF via headless Chrome/Edge (correct Arabic shaping)."""
    import shutil
    import subprocess
    import time
    import uuid

    chrome = _find_chromium_executable()
    if chrome is None:
        raise RuntimeError("chromium_not_found")

    prepared = _prepare_chromium_html(html)
    # Chrome on Windows is unreliable with %TEMP% short paths; keep work dir stable.
    root = Path(r"C:\Airfare_Allowance\.pdf_runtime")
    root.mkdir(parents=True, exist_ok=True)
    work = root / f"job_{uuid.uuid4().hex}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        html_path = work / "document.html"
        pdf_path = work / "document.pdf"
        profile = work / "chrome-profile"
        profile.mkdir(parents=True, exist_ok=True)
        html_path.write_text(prepared, encoding="utf-8")
        cmd = [
            str(chrome),
            "--headless=new",
            "--disable-gpu",
            "--no-pdf-header-footer",
            "--allow-file-access-from-files",
            f"--user-data-dir={profile}",
            f"--print-to-pdf={pdf_path}",
            html_path.resolve().as_uri(),
        ]
        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        # Headless Chrome often returns before the PDF is fully flushed.
        deadline = time.time() + 15
        while time.time() < deadline:
            if pdf_path.exists() and pdf_path.stat().st_size > 100:
                break
            time.sleep(0.25)
        if not pdf_path.exists() or pdf_path.stat().st_size < 100:
            raise RuntimeError(
                f"chromium_pdf_failed code={completed.returncode} "
                f"stderr={(completed.stderr or '')[:400]}"
            )
        return pdf_path.read_bytes()
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _render_pdf_xhtml2pdf(html: str) -> bytes:
    """Legacy ReportLab path — visual-order Arabic fallback."""
    from io import BytesIO

    from xhtml2pdf import pisa

    _register_pdf_fonts()
    # Mark engine so CSS uses LTR+right-align for already-visual Arabic runs.
    if re.search(r"<body\b", html, flags=re.IGNORECASE):
        html = re.sub(
            r"<body\b([^>]*)>",
            lambda m: (
                m.group(0)
                if "engine-pisa" in m.group(0)
                else f'<body class="engine-pisa"{m.group(1)}>'
                if "class=" not in m.group(1)
                else re.sub(
                    r'class="([^"]*)"',
                    r'class="\1 engine-pisa"',
                    m.group(0),
                    count=1,
                )
            ),
            html,
            count=1,
            flags=re.IGNORECASE,
        )
    shaped = _reshape_arabic_in_html(html)
    buffer = BytesIO()
    result = pisa.CreatePDF(
        BytesIO(shaped.encode("utf-8")),
        dest=buffer,
        encoding="utf-8",
        link_callback=_pdf_link_callback,
    )
    if result.err:
        raise DomainError(
            "document_render_failed",
            "The document could not be rendered to PDF.",
        )
    return buffer.getvalue()


def _stamp_focus_page_numbers(pdf_bytes: bytes) -> bytes:
    """Focus Soft footer: ``Page number : N of M`` (Chromium CLI has no counters)."""
    try:
        import pymupdf
    except ImportError:  # pragma: no cover - optional stamp
        return pdf_bytes

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        total = doc.page_count
        for index, page in enumerate(doc):
            label = f"Page number : {index + 1} of {total}"
            # Inside the printed page frame / footer band (~10–11mm margin).
            x = page.rect.width - 112
            y = page.rect.height - 22
            page.insert_text(
                (x, y),
                label,
                fontsize=7,
                fontname="helv",
                color=(0.2, 0.2, 0.2),
            )
        return doc.tobytes()
    finally:
        doc.close()


def render_pdf(html: str) -> bytes:
    """Convert rendered HTML to an A4 PDF with Arabic-capable fonts.

    Prefer headless Chromium (HarfBuzz + Unicode bidi) so Arabic matches the
    English column. Fall back to xhtml2pdf + arabic-reshaper when Chrome/Edge
    is unavailable.
    """
    import logging

    try:
        return _stamp_focus_page_numbers(_render_pdf_chromium(html))
    except Exception as exc:  # noqa: BLE001 — intentional engine fallback
        logging.getLogger(__name__).warning("chromium_pdf_fallback: %s", exc)
        return _stamp_focus_page_numbers(_render_pdf_xhtml2pdf(html))


def company_logo_file(branding_root: str | Path, company_id: str) -> Path | None:
    """Locate the uploaded company logo used on letterheads."""
    root = Path(branding_root)
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        candidate = root / f"{company_id}{ext}"
        if candidate.exists():
            return candidate
    return None


def resolve_company_logo_path(
    session: Session, branding_root: str | Path, company_id: str
) -> Path | None:
    """Prefer disk/MSSQL company logo; fall back to Atlas letterhead asset."""
    existing = company_logo_file(branding_root, company_id)
    if existing is not None:
        return existing
    company = session.get(CompanyRow, company_id)
    blob = getattr(company, "logo_data", None) if company is not None else None
    if blob:
        media = (getattr(company, "logo_content_type", None) or "image/png").lower()
        ext = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/webp": ".webp",
        }.get(media, ".png")
        root = Path(branding_root)
        root.mkdir(parents=True, exist_ok=True)
        destination = root / f"{company_id}{ext}"
        destination.write_bytes(bytes(blob))
        return destination
    try:
        from airfare_management.infrastructure.documents import _ATLAS_LOGO

        if _ATLAS_LOGO.exists():
            return _ATLAS_LOGO
    except Exception:  # pragma: no cover - optional branding asset
        pass
    return None


def _load_employee(session: Session, employee_id: UUID) -> EmployeeRow:
    employee = session.scalar(
        select(EmployeeRow).where(
            EmployeeRow.id == employee_id, EmployeeRow.deleted_at.is_(None)
        )
    )
    if employee is None:
        raise DomainError("not_found", "Employee not found.")
    return employee


def create_document(
    session: Session,
    *,
    document_root: str | Path,
    branding_root: str | Path,
    kind: str,
    template_key: str,
    raw_params: dict[str, Any],
    actor: str | None,
    employee_id: UUID | None = None,
    company_id: UUID | None = None,
) -> DocumentRow:
    """Validate, render, store the PDF, and persist the Focus-style voucher."""
    template = _TEMPLATE_INDEX.get(template_key)
    if template is None or template.kind != kind:
        raise DomainError("invalid_template", "Unknown document template.")
    employee = _load_employee(session, employee_id) if employee_id else None
    merged = dict(raw_params)
    if employee is not None:
        for key, value in employee_defaults(employee).items():
            if merged.get(key) in (None, ""):
                merged[key] = value
    params = validate_params(template, merged)
    resolved_company_id = _resolve_company_id(
        session, company_id=company_id, employee=employee
    )
    company = _company_profile(session, resolved_company_id)
    party = _party_from_params(params, employee)
    root = Path(document_root)
    root.mkdir(parents=True, exist_ok=True)
    logo = resolve_company_logo_path(session, branding_root, resolved_company_id)

    document_date = date.fromisoformat(params["document_date"])
    joining_date = date.fromisoformat(params["joining_date"])
    voucher_no = allocate_voucher_no(session, kind=kind, document_date=document_date)
    now = datetime.now(UTC)
    title = "Offer Letter" if kind == KIND_OFFER else "Contract of Employment"
    party_name = party["full_name"]
    row = DocumentRow(
        kind=kind,
        voucher_no=voucher_no,
        employee_id=employee_id,
        company_id=resolved_company_id,
        template_key=template_key,
        title=f"{title} — {party_name}",
        status="issued",
        document_date=document_date,
        joining_date=joining_date,
        narration=params.get("narration") or None,
        employee_name_arabic=params.get("employee_name_arabic") or None,
        cpr_no=params.get("cpr_no") or None,
        nature_of_employment=params.get("nature_of_employment") or None,
        basic_salary=Decimal(params["basic"]),
        hra=Decimal(params["hra"]),
        petrol_allowance=Decimal(params["petrol_allowance"]),
        car_allowance=Decimal(params["car_allowance"]),
        special_duty_allowance=Decimal(params["special_duty_allowance"]),
        net_amount=Decimal(params["net"]),
        traveling_airfare=bool(params.get("traveling_airfare")),
        additional_details=params.get("additional_details") or None,
        address_villa=params.get("address_villa") or None,
        address_street=params.get("address_street") or None,
        address_block=params.get("address_block") or None,
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

    context = build_context(
        company=company,
        party=party,
        kind=kind,
        params=params,
        doc_number=row.document_number,
        voucher_no=row.voucher_no,
        logo_src=str(logo) if logo else None,
    )
    pdf_bytes = render_pdf(render_html(template, context))
    pdf_path = root / f"{row.id}.pdf"
    pdf_path.write_bytes(pdf_bytes)
    row.pdf_key = pdf_path.name
    session.flush()
    return row


def preview_document(
    session: Session,
    *,
    branding_root: str | Path,
    kind: str,
    template_key: str,
    raw_params: dict[str, Any],
    employee_id: UUID | None = None,
    company_id: UUID | None = None,
) -> str:
    """Render the HTML preview without persisting anything."""
    template = _TEMPLATE_INDEX.get(template_key)
    if template is None or template.kind != kind:
        raise DomainError("invalid_template", "Unknown document template.")
    employee = _load_employee(session, employee_id) if employee_id else None
    merged = dict(raw_params)
    if employee is not None:
        for key, value in employee_defaults(employee).items():
            if merged.get(key) in (None, ""):
                merged[key] = value
    params = validate_params(template, merged)
    resolved_company_id = _resolve_company_id(
        session, company_id=company_id, employee=employee
    )
    company = _company_profile(session, resolved_company_id)
    party = _party_from_params(params, employee)
    logo = resolve_company_logo_path(session, branding_root, resolved_company_id)
    context = build_context(
        company=company,
        party=party,
        kind=kind,
        params=params,
        doc_number=None,
        voucher_no=None,
        logo_src=f"/v1/companies/{resolved_company_id}/logo" if logo else None,
    )
    return render_html(template, context)


def list_documents(
    session: Session,
    *,
    kind: str | None = None,
    employee_id: UUID | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """List issued documents newest first (Employee Master link optional)."""
    query = (
        select(DocumentRow, EmployeeRow.full_name, EmployeeRow.code)
        .outerjoin(EmployeeRow, EmployeeRow.id == DocumentRow.employee_id)
        .where(DocumentRow.deleted_at.is_(None))
    )
    if kind:
        query = query.where(DocumentRow.kind == kind)
    if employee_id:
        query = query.where(DocumentRow.employee_id == employee_id)
    rows = session.execute(
        query.order_by(DocumentRow.document_number.desc()).limit(limit).offset(offset)
    ).all()
    result: list[dict[str, Any]] = []
    for row in rows:
        doc = row.DocumentRow
        params = doc.params if isinstance(doc.params, dict) else {}
        party_name = row[1] or params.get("full_name") or doc.title
        result.append(
            {
                "id": doc.id,
                "document_number": doc.document_number,
                "voucher_no": doc.voucher_no,
                "kind": doc.kind,
                "template_key": doc.template_key,
                "title": doc.title,
                "status": doc.status,
                "employee_id": str(doc.employee_id) if doc.employee_id else None,
                "employee_name": party_name,
                "employee_code": row[2],
                "nature_of_employment": doc.nature_of_employment,
                "basic": float(doc.basic_salary) if doc.basic_salary is not None else None,
                "net": float(doc.net_amount) if doc.net_amount is not None else None,
                "document_date": doc.document_date.isoformat() if doc.document_date else None,
                "joining_date": doc.joining_date.isoformat() if doc.joining_date else None,
                "issued_at": doc.issued_at.isoformat() if doc.issued_at else None,
                "issued_by": doc.issued_by,
                "has_pdf": bool(doc.pdf_key),
                "version": doc.version,
            }
        )
    return result


def get_document(session: Session, document_id: str) -> DocumentRow:
    """Fetch one live document row or raise."""
    row = session.scalar(
        select(DocumentRow).where(
            DocumentRow.id == document_id, DocumentRow.deleted_at.is_(None)
        )
    )
    if row is None:
        raise DomainError("not_found", "Document not found.")
    return row


def document_detail(session: Session, document_id: str) -> dict[str, Any]:
    """Full voucher payload for Edit (params + party fields)."""
    row = get_document(session, document_id)
    params = dict(row.params) if isinstance(row.params, dict) else {}
    # Ensure print-critical party keys are present for the form.
    if not params.get("full_name") and row.title and "—" in row.title:
        params.setdefault("full_name", row.title.split("—", 1)[-1].strip())
    if row.employee_name_arabic and not params.get("employee_name_arabic"):
        params["employee_name_arabic"] = row.employee_name_arabic
    if row.cpr_no and not params.get("cpr_no"):
        params["cpr_no"] = row.cpr_no
    if row.nature_of_employment and not params.get("nature_of_employment"):
        params["nature_of_employment"] = row.nature_of_employment
    if row.document_date and not params.get("document_date"):
        params["document_date"] = row.document_date.isoformat()
    if row.joining_date and not params.get("joining_date"):
        params["joining_date"] = row.joining_date.isoformat()
    if row.basic_salary is not None and not params.get("basic"):
        params["basic"] = str(row.basic_salary)
    return {
        "id": row.id,
        "document_number": row.document_number,
        "voucher_no": row.voucher_no,
        "kind": row.kind,
        "template_key": row.template_key,
        "title": row.title,
        "status": row.status,
        "employee_id": str(row.employee_id) if row.employee_id else None,
        "company_id": row.company_id,
        "document_date": row.document_date.isoformat() if row.document_date else None,
        "joining_date": row.joining_date.isoformat() if row.joining_date else None,
        "nature_of_employment": row.nature_of_employment,
        "basic": float(row.basic_salary) if row.basic_salary is not None else None,
        "net": float(row.net_amount) if row.net_amount is not None else None,
        "params": params,
        "has_pdf": bool(row.pdf_key),
        "issued_at": row.issued_at.isoformat() if row.issued_at else None,
        "version": row.version,
    }


def update_document(
    session: Session,
    *,
    document_id: str,
    document_root: str | Path,
    branding_root: str | Path,
    raw_params: dict[str, Any],
    actor: str | None,
    if_match: int,
    employee_id: UUID | None = None,
    company_id: UUID | None = None,
    template_key: str | None = None,
) -> DocumentRow:
    """Edit an issued voucher and regenerate its PDF (keeps voucher_no)."""
    row = get_document(session, document_id)
    if row.version != if_match:
        raise DomainError("stale_version", "The document was modified by another user.")
    key = template_key or row.template_key
    template = _TEMPLATE_INDEX.get(key)
    if template is None or template.kind != row.kind:
        raise DomainError("invalid_template", "Unknown document template.")
    employee = _load_employee(session, employee_id) if employee_id else None
    merged = dict(raw_params)
    if employee is not None:
        for key, value in employee_defaults(employee).items():
            if merged.get(key) in (None, ""):
                merged[key] = value
    params = validate_params(template, merged)
    resolved_company_id = _resolve_company_id(
        session, company_id=company_id, employee=employee
    )
    company = _company_profile(session, resolved_company_id)
    party = _party_from_params(params, employee)
    root = Path(document_root)
    root.mkdir(parents=True, exist_ok=True)
    logo = resolve_company_logo_path(session, branding_root, resolved_company_id)

    document_date = date.fromisoformat(params["document_date"])
    joining_date = date.fromisoformat(params["joining_date"])
    now = datetime.now(UTC)
    title = "Offer Letter" if row.kind == KIND_OFFER else "Contract of Employment"
    party_name = party["full_name"]

    row.employee_id = employee_id
    row.company_id = resolved_company_id
    row.template_key = key
    row.title = f"{title} — {party_name}"
    row.document_date = document_date
    row.joining_date = joining_date
    row.narration = params.get("narration") or None
    row.employee_name_arabic = params.get("employee_name_arabic") or None
    row.cpr_no = params.get("cpr_no") or None
    row.nature_of_employment = params.get("nature_of_employment") or None
    row.basic_salary = Decimal(params["basic"])
    row.hra = Decimal(params["hra"])
    row.petrol_allowance = Decimal(params["petrol_allowance"])
    row.car_allowance = Decimal(params["car_allowance"])
    row.special_duty_allowance = Decimal(params["special_duty_allowance"])
    row.net_amount = Decimal(params["net"])
    row.traveling_airfare = bool(params.get("traveling_airfare"))
    row.additional_details = params.get("additional_details") or None
    row.address_villa = params.get("address_villa") or None
    row.address_street = params.get("address_street") or None
    row.address_block = params.get("address_block") or None
    row.params = params
    row.updated_at = now
    row.updated_by = actor
    row.version += 1

    context = build_context(
        company=company,
        party=party,
        kind=row.kind,
        params=params,
        doc_number=row.document_number,
        voucher_no=row.voucher_no,
        logo_src=str(logo) if logo else None,
    )
    pdf_bytes = render_pdf(render_html(template, context))
    pdf_path = root / f"{row.id}.pdf"
    pdf_path.write_bytes(pdf_bytes)
    row.pdf_key = pdf_path.name
    session.flush()
    return row


def document_pdf_path(document_root: str | Path, row: DocumentRow) -> Path:
    """Resolve the stored PDF path, guarding against path escape."""
    root = Path(document_root).resolve()
    path = (root / (row.pdf_key or "")).resolve()
    if not str(path).startswith(str(root)) or not path.exists():
        raise DomainError("not_found", "The generated PDF is missing on disk.")
    return path


def count_documents(session: Session) -> int:
    """Total live documents (for dashboard-style stats)."""
    return session.scalar(
        select(func.count()).select_from(DocumentRow).where(DocumentRow.deleted_at.is_(None))
    ) or 0


def _allocation_money(value: Any, currency: str = "BHD") -> str:
    """Format allocation amounts for the offer-letter-style print grid."""
    if value is None or value == "":
        return "—"
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return str(value)
    code = (currency or "BHD").strip().upper()
    return f"{code} {amount:,.3f}"


def _allocation_date(value: Any) -> str:
    """Format ISO/date values for allocation print."""
    if value is None or value == "":
        return "—"
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.strftime("%d/%m/%Y")
    text = str(value)
    try:
        return date.fromisoformat(text[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return text


def render_allocation_print_pdf(
    session: Session,
    *,
    branding_root: str | Path,
    company_id: str,
    data: dict[str, Any],
    prepared_by: str = "",
) -> bytes:
    """Render airfare allocation PDF with the same letterhead as offer letters.

    Uses Jinja + xhtml2pdf so the centered company logo from MSSQL
    (``companies.logo_data``) matches Offer Letter / Contract prints.
    """
    company = _company_profile(session, company_id)
    currency = company.get("currency") or "BHD"
    logo = resolve_company_logo_path(session, branding_root, company_id)
    if logo is None:
        # Last-resort Atlas print asset so letterhead never goes blank.
        from airfare_management.infrastructure.documents import _ATLAS_LOGO

        if _ATLAS_LOGO.exists():
            logo = _ATLAS_LOGO

    origin = str(data.get("origin_code") or "—").upper()
    destination = str(data.get("destination_code") or "—").upper()
    route = f"{origin} → {destination}" if origin != "—" and destination != "—" else "—"
    excess_option = str(
        data.get("excess_option") or data.get("excess_handling") or "SELF_PAID"
    ).upper()
    loan_label = str(data.get("loan_code") or "").strip()
    if not loan_label:
        tenure = data.get("tenure_months")
        if excess_option in {"CONVERT_TO_LOAN", "LOAN"} and tenure:
            loan_label = (
                f"{tenure} mo · {_allocation_money(data.get('excess_cost'), currency)}"
            )
        else:
            loan_label = "—"
    elif data.get("loan_status"):
        loan_label = f"{loan_label} ({str(data.get('loan_status')).upper()})"

    entitlement = (
        data.get("entitlement_amount")
        or data.get("final_entitlement_amount")
        or data.get("airfare_entitlement_amount")
    )
    ticket_amount = data.get("ticket_cost") or data.get("requested_ticket_amount")
    company_payout = data.get("company_payout") or data.get("company_paid")
    employee_payable = data.get("employee_payable")
    excess = data.get("excess_cost")

    voucher = (
        data.get("ticket_code")
        or data.get("document_number")
        or "ALLOC-DRAFT"
    )
    context = {
        "company": company,
        "logo_src": str(logo) if logo else None,
        "employee": {
            "code": data.get("employee_code") or "—",
            "full_name": data.get("employee_name") or data.get("full_name") or "—",
            "arabic_name": data.get("arabic_name") or "",
            "nationality": data.get("nationality") or "—",
            "department": data.get("department") or "—",
            "designation": data.get("designation") or "—",
            "pay_group": data.get("pay_group") or "—",
            "branch": data.get("branch") or data.get("location") or "—",
        },
        "doc": {
            "title": "Airfare Allocation",
            "voucher_no": voucher,
            "ref": voucher,
        },
        "allocation": {
            "travel_date": _allocation_date(data.get("travel_date") or data.get("as_of_date")),
            "as_of_date": _allocation_date(data.get("as_of_date")),
            "join_date": _allocation_date(data.get("join_date") or data.get("date_of_joining")),
            "status": str(data.get("status") or "APPROVED").upper(),
            "reporting_officer": data.get("reporting_officer") or data.get("reporting_to") or "—",
            "route": route,
            "entitlement_fmt": _allocation_money(entitlement, currency),
            "ticket_fmt": _allocation_money(ticket_amount, currency),
            "company_payout_fmt": _allocation_money(company_payout, currency),
            "employee_payable_fmt": _allocation_money(employee_payable, currency),
            "excess_fmt": _allocation_money(excess, currency),
            "excess_option": excess_option.replace("_", " "),
            "loan_label": loan_label,
            "opening_fmt": _allocation_money(data.get("opening_balance_amount"), currency),
            "earned_fmt": _allocation_money(
                data.get("current_year_earned_amount") or data.get("current_year_amount"),
                currency,
            ),
            "already_paid_fmt": _allocation_money(data.get("already_paid_amount"), currency),
            "settlement_summary": (
                f"Company {_allocation_money(company_payout, currency)} · "
                f"Employee {_allocation_money(employee_payable, currency)}"
            ),
            "notes": (str(data.get("notes") or "").strip()),
            "prepared_by": prepared_by or data.get("prepared_by") or "—",
        },
        "params": {},
    }
    html = _jinja.get_template("documents/allocation/default.html").render(**context)
    return render_pdf(html)
