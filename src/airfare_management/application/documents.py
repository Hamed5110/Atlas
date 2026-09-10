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
import unicodedata
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
        optional_params=_COMMON_OPTIONAL + ("traveling_airfare", "offer_valid_until", "nature_of_employment_arabic"),
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
    """English amount-in-words including cents as /100 of a dinar."""
    whole, cents = _split_dinar_cents(value)
    words = _english_cardinal(Decimal(whole))
    result = f"{words} {currency}".strip()
    if cents:
        result += f" and {cents:02d}/100"
    return result + " Only"


def _split_dinar_cents(value: Decimal) -> tuple[int, int]:
    """Return (whole dinars, cents) at 2-decimal legal print precision."""
    quantized = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    whole = int(quantized)
    cents = int((quantized - Decimal(whole)) * 100)
    return whole, cents


def _english_cardinal(value: Decimal) -> str:
    """Cardinal words for the whole dinar portion (no currency suffix)."""
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

    whole = int(value)
    if whole == 0:
        return "Zero"
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
    return " ".join(parts)


def _money(value: Decimal | None, currency: str = "") -> str | None:
    if value is None:
        return None
    quantized = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    prefix = f"{currency} " if currency else ""
    return f"{prefix}{quantized:,.2f}"


def _money_focus(value: Decimal | None) -> str | None:
    """Salary grid style: ``350.00/-`` (Western digits, EN column)."""
    if value is None:
        return None
    quantized = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{quantized:,.2f}/-"


def _money_focus_ar(value: Decimal | None) -> str | None:
    """Arabic salary cell: Eastern digits + Arabic separators ``٣٥٠٫٥٠/-``."""
    western = _money_focus(value)
    if not western:
        return None
    localized = western.replace(",", "٬").replace(".", "٫")
    return _eastern_digits(localized)


def _amount_in_words_focus(value: Decimal) -> str:
    """EN words with fractional cents: ``… and 50/100 only``."""
    whole, cents = _split_dinar_cents(value)
    body = f"Bahraini Dinar   {_english_cardinal(Decimal(whole))}"
    if cents:
        body += f" and {cents:02d}/100"
    return body + " only"


def _amount_in_words_ar(value: Decimal) -> str:
    """Arabic amount-in-words; append ``و…/مائة`` when cents are present."""
    ones = [
        "",
        "واحد",
        "اثنان",
        "ثلاثة",
        "أربعة",
        "خمسة",
        "ستة",
        "سبعة",
        "ثمانية",
        "تسعة",
        "عشرة",
        "أحد عشر",
        "اثنا عشر",
        "ثلاثة عشر",
        "أربعة عشر",
        "خمسة عشر",
        "ستة عشر",
        "سبعة عشر",
        "ثمانية عشر",
        "تسعة عشر",
    ]
    tens = [
        "",
        "",
        "عشرون",
        "ثلاثون",
        "أربعون",
        "خمسون",
        "ستون",
        "سبعون",
        "ثمانون",
        "تسعون",
    ]
    hundreds = [
        "",
        "مائة",
        "مائتان",
        "ثلاثمائة",
        "أربعمائة",
        "خمسمائة",
        "ستمائة",
        "سبعمائة",
        "ثمانمائة",
        "تسعمائة",
    ]

    def under_hundred(n: int) -> str:
        if n < 20:
            return ones[n]
        t, o = divmod(n, 10)
        if o == 0:
            return tens[t]
        return f"{ones[o]} و{tens[t]}"

    def under_thousand(n: int) -> str:
        if n < 100:
            return under_hundred(n)
        h, rest = divmod(n, 100)
        head = hundreds[h]
        if rest == 0:
            return head
        return f"{head} و{under_hundred(rest)}"

    whole, cents = _split_dinar_cents(value)
    if whole == 0 and cents == 0:
        return "صفر فقط"
    if whole == 0:
        frac = _eastern_digits(f"{cents:02d}/100")
        return f"{frac} فقط"
    if whole < 1000:
        head = under_thousand(whole)
    else:
        thousands, rest = divmod(whole, 1000)
        if thousands == 1:
            th = "ألف"
        elif thousands == 2:
            th = "ألفان"
        elif thousands < 11:
            th = f"{ones[thousands]} آلاف"
        else:
            th = f"{under_thousand(thousands)} ألف"
        head = th if rest == 0 else f"{th} و{under_thousand(rest)}"
    if cents:
        frac = _eastern_digits(f"{cents:02d}/100")
        return f"{head} و{frac} فقط"
    return f"{head} فقط"


def _eastern_digits(text: str) -> str:
    """Convert Western digits to Eastern Arabic numerals (Focus AR column)."""
    return str(text).translate(str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩"))


def _probation_months_en(months: int) -> str:
    """Focus Soft offer: ``three months`` (words for common values)."""
    words = {
        1: "one month",
        2: "two months",
        3: "three months",
        6: "six months",
        12: "twelve months",
    }
    return words.get(months, f"{months} months")


def _focus_date(value: date) -> str:
    """English secondary date: unambiguous ``09-Sep-2026`` (never bare MM/DD/YYYY)."""
    return value.strftime("%d-%b-%Y")


def _focus_date_ar(value: date) -> str:
    """Arabic-primary date: Eastern ``dd/mm/yyyy`` (day-first — never MM/DD)."""
    return _eastern_digits(value.strftime("%d/%m/%Y"))


def _focus_weekday_date(value: date) -> str:
    """English signature date: ``Sun 09-Sep-2026``."""
    return value.strftime("%a %d-%b-%Y")


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
    "UGANDAN": "أوغندي",
    "KENYAN": "كيني",
    "SUDANESE": "سوداني",
}

_COMPANY_NAME_AR = {
    "atlas aluminum": "شركة أطلس ألمنيوم",
    "atlas aluminum w.l.l": "شركة أطلس ألمنيوم",
    "atlas aluminum w.l.l.": "شركة أطلس ألمنيوم",
    "atlas aluminium": "شركة أطلس ألمنيوم",
    "atlas aluminium w.l.l": "شركة أطلس ألمنيوم",
    "atlas aluminium w.l.l.": "شركة أطلس ألمنيوم",
}


def _resolve_company_arabic_name(name: str, stored: str | None = None) -> str:
    """Prefer MSSQL company.arabic_name; fall back to known Focus-style map."""
    stored_clean = (stored or "").strip()
    if stored_clean:
        return stored_clean
    key = re.sub(r"\s+", " ", (name or "").strip().lower())
    key = key.replace(",", "").strip()
    mapped = _COMPANY_NAME_AR.get(key, "")
    if mapped:
        return mapped
    # Strip trailing W.L.L / LLC noise then retry
    key2 = re.sub(r"\b(w\.?\s*l\.?\s*l\.?|llc|ltd\.?)\b", "", key, flags=re.I).strip()
    key2 = re.sub(r"\s+", " ", key2).strip(" -./")
    return _COMPANY_NAME_AR.get(key2, "")


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
    value = sanitize_printable_field(str(params.get(key) or ""), limit=limit)
    if required and not value:
        raise DocumentParamsError(f"'{key}' is required.")
    return value


_FORMAT_TOKEN_RE = re.compile(r"%[0-9.#\-+ ]*[sdnxXfFeEgGc%]")
_CONTROL_RE = re.compile(r"[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize_printable_field(value: str, *, limit: int | None = None) -> str:
    """Strip CR/LF, format tokens, and non-allowlisted characters from user text.

    Used before params, PDF footer meta, logs, and outbound templates so one
    physical event cannot forge extra log lines or expand format tokens.
    """
    text = str(value or "")
    text = _CONTROL_RE.sub(" ", text)
    text = _FORMAT_TOKEN_RE.sub("", text)
    cleaned: list[str] = []
    for ch in text:
        if ch in " \t.,;:'-/()&+@#%°·•–—":
            cleaned.append(" " if ch == "\t" else ch)
        elif ch.isalpha() or ch.isdigit() or unicodedata.category(ch).startswith(
            ("L", "M", "N", "Z")
        ):
            cleaned.append(ch)
    text = re.sub(r" +", " ", "".join(cleaned)).strip()
    if limit is not None and len(text) > limit:
        text = text[:limit].rstrip()
    return text


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
    probation_months = _int_param(params, "probation_months", minimum=0, maximum=12)
    annual_leave_days = _int_param(params, "annual_leave_days", minimum=0, maximum=120)

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
        "probation_months": probation_months,
        "probation_months_en": _probation_months_en(probation_months),
        "basic": str(basic),
        "basic_salary": str(basic),
        "hra": str(hra),
        "petrol_allowance": str(petrol),
        "car_allowance": str(car),
        "special_duty_allowance": str(special),
        "net": str(net),
        "annual_leave_days": annual_leave_days,
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
        "basic_fmt_focus_ar": _money_focus_ar(basic),
        "hra_fmt_focus_ar": _money_focus_ar(hra) if hra else None,
        "petrol_allowance_fmt_focus_ar": _money_focus_ar(petrol) if petrol else None,
        "car_allowance_fmt_focus_ar": _money_focus_ar(car) if car else None,
        "special_duty_allowance_fmt_focus_ar": (
            _money_focus_ar(special) if special else None
        ),
        "net_fmt_focus_ar": _money_focus_ar(net),
        "net_in_words_ar": _amount_in_words_ar(net),
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
    locked_company_id: str | None = None,
) -> str:
    """Resolve tenant for documents — server-authoritative, no silent blend.

    - When ``locked_company_id`` is set (update of an existing voucher), the
      client cannot rebrand to another company.
    - When both ``company_id`` and employee are present, they must match.
    """
    if locked_company_id:
        locked = str(locked_company_id)
        if session.get(CompanyRow, locked) is None:
            raise DomainError("invalid_company", "Voucher company does not exist.")
        if company_id is not None and str(company_id) != locked:
            raise DomainError(
                "company_mismatch",
                "Document company cannot be changed on regenerate; issue a new voucher.",
            )
        if employee is not None and employee.company_id and str(employee.company_id) != locked:
            raise DomainError(
                "company_mismatch",
                "Employee does not belong to this document's company.",
            )
        return locked

    if company_id is not None:
        cid = str(company_id)
        if session.get(CompanyRow, cid) is None:
            raise DomainError("invalid_company", "Selected company does not exist.")
        if employee is not None and employee.company_id and str(employee.company_id) != cid:
            raise DomainError(
                "company_mismatch",
                "Selected company does not match the employee's company.",
            )
        return cid
    if employee is not None:
        emp_cid = str(employee.company_id) if employee.company_id else ""
        if emp_cid and session.get(CompanyRow, emp_cid) is not None:
            return emp_cid
    raise DomainError("invalid_company", "Company is required for offer/contract vouchers.")


def _company_profile(
    session: Session,
    company_id: str,
    *,
    require_arabic: bool = False,
) -> dict[str, Any]:
    """Load company letterhead fields.

    Product rule (Option A — BLOCK): Issue/regenerate hard-fails when Arabic
    company name cannot be resolved from DB or the known map. Preview may
    degrade with ``arabic_name_degraded=True`` and Latin fallback.
    """
    company = session.get(CompanyRow, company_id)
    if company is None:
        raise DomainError("invalid_company", "The selected company does not exist.")
    name = sanitize_printable_field(company.name or "", limit=200)
    resolved_ar = sanitize_printable_field(
        _resolve_company_arabic_name(name, getattr(company, "arabic_name", None)) or "",
        limit=200,
    )
    if not resolved_ar:
        if require_arabic:
            raise DomainError(
                "arabic_name_required",
                "Arabic company name is required to Issue this document. "
                "Set company.arabic_name in Settings, then retry.",
            )
        return {
            "name": name,
            "arabic_name": name,
            "arabic_name_degraded": True,
            "code": company.code,
            "currency": company.currency or "BHD",
            "cr_no": sanitize_printable_field(
                (getattr(company, "cr_no", None) or "").strip(), limit=40
            ),
            "address": sanitize_printable_field(
                getattr(company, "address", None) or "", limit=300
            ),
        }
    return {
        "name": name,
        "arabic_name": resolved_ar,
        "arabic_name_degraded": False,
        "code": company.code,
        "currency": company.currency or "BHD",
        "cr_no": sanitize_printable_field(
            (getattr(company, "cr_no", None) or "").strip(), limit=40
        ),
        "address": sanitize_printable_field(
            getattr(company, "address", None) or "", limit=300
        ),
    }


def _assert_employee_arabic_for_issue(party: dict[str, Any]) -> None:
    """Option A — BLOCK: employee Arabic name required on Issue/regenerate."""
    ar = sanitize_printable_field(str(party.get("arabic_name") or ""), limit=200)
    if not ar:
        raise DomainError(
            "arabic_name_required",
            "Employee Arabic name is required to Issue this Arabic-primary document.",
        )


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
    # Issued PDF must never show the HTML preview page-label sample.
    prepared = re.sub(
        r'<div\b[^>]*class="[^"]*page-label-sample[^"]*"[^>]*>.*?</div>',
        "",
        prepared,
        flags=re.IGNORECASE | re.DOTALL,
    )
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


def _extract_focus_footer_meta(html: str) -> dict[str, str]:
    """Read company footer fields embedded by focus_base.html for PDF stamping."""
    import json

    match = re.search(
        r'<script[^>]*id=["\']focus-footer-meta["\'][^>]*>(.*?)</script>',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return {}
    try:
        raw = json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        "co": sanitize_printable_field(str(raw.get("co") or ""), limit=90),
        "ar": sanitize_printable_field(str(raw.get("ar") or ""), limit=80),
        "addr": sanitize_printable_field(str(raw.get("addr") or ""), limit=160),
        "mid": sanitize_printable_field(str(raw.get("mid") or ""), limit=60),
        "page_ar": "1" if raw.get("page_ar") else "",
    }


def _focus_footer_font_paths() -> tuple[Path | None, Path | None]:
    """Latin + Arabic TTF paths for footer stamps."""
    candidates = (
        Path(r"C:\Airfare_Allowance\.pdf_fonts"),
        FONTS_DIR,
    )
    latin = None
    arabic = None
    for root in candidates:
        if latin is None:
            for name in ("Arial.ttf", "Tahoma.ttf"):
                path = root / name
                if path.exists():
                    latin = path
                    break
        if arabic is None:
            for name in ("SimplifiedArabic.ttf", "TraditionalArabic.ttf"):
                path = root / name
                if path.exists():
                    arabic = path
                    break
    return latin, arabic


def _focus_footer_band_top(page_height: float) -> float:
    """Y of footer rule — aligns with focus_base ``@page`` margin-bottom 32mm."""
    return float(page_height) - (32.0 * 72.0 / 25.4)


def _wrap_footer_address(addr: str, *, max_len: int = 102) -> list[str]:
    """Wrap footer address without orphaning the CR number alone on a line."""
    cleaned = (
        (addr or "")
        .replace("\u00ad", "-")
        .replace("\xad", "-")
        .replace("\xa0", " ")
        .strip()
    )
    if not cleaned:
        return []
    if len(cleaned) > 160:
        raise DomainError(
            "footer_overflow",
            "Company address/CR exceeds print footer capacity; shorten address or CR.",
        )
    if len(cleaned) <= max_len:
        return [cleaned]

    marker = " · CR "
    # marker may use NB hyphen inside CR value only; split on · CR
    split_at = cleaned.rfind(" · CR ")
    if split_at >= 0:
        base = cleaned[:split_at]
        cr_part = cleaned[split_at + 3 :].strip()  # "CR …"
        if len(base) <= max_len:
            return [base, cr_part]
        words = base.split()
        line1 = ""
        rest: list[str] = []
        for i, w in enumerate(words):
            trial = f"{line1} {w}".strip()
            if len(trial) <= max_len:
                line1 = trial
            else:
                rest = words[i:]
                break
        line2 = f"{' '.join(rest)} {cr_part}".strip()
        return [line1 or base[:max_len], line2[:max_len]]

    words = cleaned.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if len(trial) <= max_len:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
        if len(lines) >= 2:
            break
    if cur and len(lines) < 2:
        lines.append(cur)
    return lines[:2]


def _stamp_focus_page_numbers(
    pdf_bytes: bytes, *, footer_meta: dict[str, str] | None = None
) -> bytes:
    """Stamp footer band + Arabic/English page labels into the bottom margin.

    Chromium ``position:fixed`` footers paint at the content-box bottom and clip
    contract clauses; company text is therefore applied after print-to-PDF.
    Arabic-primary docs get ``صفحة N من M`` with Eastern digits only (never the
    HTML preview sample, never Chromium ``Page number`` chrome).
    """
    try:
        import pymupdf
    except ImportError:  # pragma: no cover - optional stamp
        return pdf_bytes

    meta = footer_meta or {}
    latin_path, arabic_path = _focus_footer_font_paths()
    brand = (0.039, 0.145, 0.251)  # #0a2540 navy
    muted = (0.353, 0.396, 0.467)  # #5a6577

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        # Scrub leaked HTML preview sample / browser page chrome before stamping.
        leak_needles = (
            "Page number",
            "صيغة الترقيم",
            "صفحة ٠ من ٠",
            "صفحة 0 من 0",
            "أرقام هندية",
        )
        for page in doc:
            dirty = False
            for needle in leak_needles:
                for rect in page.search_for(needle):
                    # Expand slightly so full line clears.
                    pad = pymupdf.Rect(rect.x0 - 2, rect.y0 - 1, rect.x1 + 40, rect.y1 + 2)
                    page.add_redact_annot(pad, fill=(1, 1, 1))
                    dirty = True
            if dirty:
                page.apply_redactions()

        total = doc.page_count
        for index, page in enumerate(doc):
            width = page.rect.width
            height = page.rect.height
            # Align rule with Chromium content-box bottom (@page margin-bottom 32mm)
            # so dual-column side borders meet the footer line (no stub gap).
            margin_x = 12.0 * 72.0 / 25.4
            band_top = _focus_footer_band_top(height)
            page.draw_rect(
                pymupdf.Rect(0, band_top, width, height),
                color=(1, 1, 1),
                fill=(1, 1, 1),
                width=0,
            )
            page.draw_line(
                pymupdf.Point(margin_x, band_top),
                pymupdf.Point(width - margin_x, band_top),
                color=brand,
                width=0.7,
            )

            font_latin = "helv"
            font_arabic = "helv"
            if latin_path is not None:
                try:
                    page.insert_font(fontname="ftsans", fontfile=str(latin_path))
                    font_latin = "ftsans"
                except Exception:  # noqa: BLE001 — fall back to Base-14
                    font_latin = "helv"
            if arabic_path is not None:
                try:
                    page.insert_font(fontname="ftar", fontfile=str(arabic_path))
                    font_arabic = "ftar"
                except Exception:  # noqa: BLE001
                    font_arabic = font_latin

            y_co = band_top + 11
            co = meta.get("co") or ""
            if co:
                page.insert_text(
                    (margin_x, y_co),
                    co[:90],
                    fontsize=7.0,
                    fontname=font_latin,
                    color=brand,
                )

            # Arabic company — between EN name and page label (no overlap).
            ar_co = (meta.get("ar") or "").strip()
            if ar_co and ar_co != co:
                try:
                    font_obj = (
                        pymupdf.Font(fontfile=str(arabic_path))
                        if arabic_path is not None
                        else pymupdf.Font("helv")
                    )
                    box = pymupdf.Rect(
                        width * 0.48, band_top + 2, width - 125, band_top + 16
                    )
                    tw = pymupdf.TextWriter(page.rect, color=brand)
                    tw.fill_textbox(
                        box,
                        ar_co[:60],
                        font=font_obj,
                        fontsize=7,
                        align=pymupdf.TEXT_ALIGN_RIGHT,
                        right_to_left=True,
                    )
                    tw.write_text(page)
                except Exception:  # noqa: BLE001
                    pass

            addr = meta.get("addr") or ""
            if addr:
                lines = _wrap_footer_address(addr)
                for i, line in enumerate(lines[:2]):
                    page.insert_text(
                        (margin_x, band_top + 21 + i * 9),
                        line,
                        fontsize=6.0,
                        fontname=font_latin,
                        color=muted,
                    )

            use_ar_page = bool(meta.get("page_ar"))
            if use_ar_page:
                label = _eastern_digits(f"صفحة {index + 1} من {total}")
                box = pymupdf.Rect(width - 150, band_top + 4, width - margin_x, band_top + 20)
                try:
                    font_obj = (
                        pymupdf.Font(fontfile=str(arabic_path))
                        if arabic_path is not None
                        else pymupdf.Font("helv")
                    )
                    tw = pymupdf.TextWriter(page.rect, color=muted)
                    tw.fill_textbox(
                        box,
                        label,
                        font=font_obj,
                        fontsize=8,
                        align=pymupdf.TEXT_ALIGN_RIGHT,
                        right_to_left=True,
                    )
                    tw.write_text(page)
                except Exception:  # noqa: BLE001
                    page.insert_htmlbox(
                        box,
                        f'<div dir="rtl" style="font-size:8pt;text-align:right;'
                        f'color:#333;">{label}</div>',
                    )
            else:
                label = f"Page number : {index + 1} of {total}"
                # Baseline-aligned with company name (not floating at page bottom).
                page.insert_text(
                    (width - 118, y_co),
                    label,
                    fontsize=7,
                    fontname=font_latin,
                    color=muted,
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

    footer_meta = _extract_focus_footer_meta(html)
    try:
        return _stamp_focus_page_numbers(
            _render_pdf_chromium(html), footer_meta=footer_meta
        )
    except DomainError:
        raise
    except Exception as exc:  # noqa: BLE001 — intentional engine fallback
        logging.getLogger(__name__).warning("chromium_pdf_fallback: %s", exc)
        return _stamp_focus_page_numbers(
            _render_pdf_xhtml2pdf(html), footer_meta=footer_meta
        )


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
    company = _company_profile(session, resolved_company_id, require_arabic=True)
    party = _party_from_params(params, employee)
    _assert_employee_arabic_for_issue(party)
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
    company = _company_profile(session, resolved_company_id, require_arabic=False)
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
    if company.get("arabic_name_degraded"):
        context["preview_degrade_banner"] = (
            "DEGRADED — Arabic company name missing (Issue blocked until set)."
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
        session,
        company_id=company_id,
        employee=employee,
        locked_company_id=str(row.company_id) if row.company_id else None,
    )
    company = _company_profile(session, resolved_company_id, require_arabic=True)
    party = _party_from_params(params, employee)
    _assert_employee_arabic_for_issue(party)
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
        raise DomainError(
            "pdf_missing",
            "The generated PDF is missing on disk.",
            error_class="infrastructure_retryable",
        )
    return path


def count_documents(session: Session) -> int:
    """Total live documents (for dashboard-style stats)."""
    return session.scalar(
        select(func.count()).select_from(DocumentRow).where(DocumentRow.deleted_at.is_(None))
    ) or 0


def _allocation_money(value: Any, currency: str = "BHD") -> str:
    """Format allocation amounts for the bilingual print grid (BHD + 3 decimals)."""
    if value is None or value == "":
        return "—"
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    except Exception:
        return str(value)
    code = (currency or "BHD").strip().upper()
    return f"{code} {amount:,.3f}"


def _allocation_date(value: Any) -> str:
    """Format ISO/date values for allocation print (dd/mm/yyyy — attached PDF style)."""
    if value is None or value == "":
        return "—"
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.strftime("%d/%m/%Y")
    text = str(value)
    try:
        return date.fromisoformat(text[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return text


def _allocation_status_ar(value: Any) -> str:
    """Arabic status for bilingual slip (الحالة: مدفوع)."""
    key = str(value or "APPROVED").strip().upper().replace(" ", "_")
    return {
        "PAID": "مدفوع",
        "APPROVED": "معتمد",
        "SUBMITTED": "مقدَّم",
        "DRAFT": "مسودة",
        "REJECTED": "مرفوض",
        "CANCELLED": "ملغى",
        "CANCELED": "ملغى",
    }.get(key, str(value or "—"))


def render_allocation_print_pdf(
    session: Session,
    *,
    branding_root: str | Path,
    company_id: str,
    data: dict[str, Any],
    prepared_by: str = "",
) -> bytes:
    """Render full bilingual airfare allocation PDF (same layout as the A4 attach/preview).

    Letterhead uses the company logo from MSSQL / branding (same as offer letters).
    """
    company = _company_profile(session, company_id)
    currency = company.get("currency") or "BHD"
    logo = resolve_company_logo_path(session, branding_root, company_id)
    if logo is None:
        from airfare_management.infrastructure.documents import _ATLAS_LOGO

        if _ATLAS_LOGO.exists():
            logo = _ATLAS_LOGO

    origin = str(data.get("origin_code") or "—").upper()
    destination = str(data.get("destination_code") or "—").upper()
    route = f"{origin} → {destination}" if origin != "—" and destination != "—" else "—"
    excess_option = str(
        data.get("excess_option") or data.get("excess_handling") or "SELF_PAID"
    ).upper()
    if excess_option == "LOAN":
        excess_option = "CONVERT_TO_LOAN"
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
    if excess is None and ticket_amount is not None and entitlement is not None:
        try:
            excess = max(Decimal("0"), Decimal(str(ticket_amount)) - Decimal(str(entitlement)))
        except Exception:
            excess = None
    if employee_payable is None and excess is not None:
        employee_payable = excess

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
            "as_of_date": _allocation_date(data.get("as_of_date") or data.get("travel_date")),
            "join_date": _allocation_date(data.get("join_date") or data.get("date_of_joining")),
            "status": str(data.get("status") or "APPROVED").upper(),
            "status_ar": _allocation_status_ar(data.get("status") or "APPROVED"),
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
