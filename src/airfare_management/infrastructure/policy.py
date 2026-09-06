"""Global airfare settings catalog for the Preferences console.

The catalog is the single source of truth for every tunable business rule
shown in the Settings UI. Stored values live as global-scope preference rows;
missing keys fall back to the catalog default, which always preserves the
proven ATLAS behavior. Typed loading goes through ``policy_from_preferences``
in the domain layer so entitlement math and the console stay in sync.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from airfare_management.domain.services import PolicySettings, policy_from_preferences
from airfare_management.infrastructure.schema import PreferenceRow

SettingType = Literal["boolean", "integer", "decimal", "select"]


@dataclass(frozen=True, slots=True)
class SettingSpec:
    """One tunable business rule in the settings catalog."""

    key: str
    label: str
    type: SettingType
    default: Any
    description: str
    options: tuple[tuple[str, str], ...] = ()
    minimum: float | None = None
    maximum: float | None = None
    unit: str = ""


@dataclass(frozen=True, slots=True)
class SettingGroup:
    """A named group of related settings for the console."""

    key: str
    label: str
    description: str
    settings: tuple[SettingSpec, ...]


SETTINGS_CATALOG: tuple[SettingGroup, ...] = (
    SettingGroup(
        key="accrual",
        label="Accrual Policy",
        description="When and how much entitlement employees earn.",
        settings=(
            SettingSpec(
                key="accrual_frequency",
                label="Accrual frequency",
                type="select",
                default="daily",
                description=(
                    "Daily accrues continuously (30/360). Monthly credits 2.5 days per "
                    "completed month. Immediate grants the full cycle on day one."
                ),
                options=(
                    ("daily", "Daily (continuous 30/360)"),
                    ("monthly", "Monthly (per completed month)"),
                    ("immediate", "Immediate (full cycle up front)"),
                ),
            ),
            SettingSpec(
                key="accrual_cap_multiplier",
                label="Accrual cap (× rate)",
                type="decimal",
                default=0,
                description=(
                    "Stops accrual once the total balance reaches this multiple of the "
                    "airfare rate. 0 means no cap. Prevents large unfunded liabilities."
                ),
                minimum=0,
                maximum=12,
                unit="× rate",
            ),
            SettingSpec(
                key="negative_balance_allowed",
                label="Negative balance allowed",
                type="boolean",
                default=True,
                description=(
                    "Yes lets a ticket exceed the balance and converts the excess to a "
                    "loan. No strictly rejects requests above the available balance."
                ),
            ),
        ),
    ),
    SettingGroup(
        key="vesting",
        label="Entitlement Vesting",
        description="All-or-nothing rules and first-year eligibility.",
        settings=(
            SettingSpec(
                key="vesting_type",
                label="Vesting type",
                type="select",
                default="pro_rata",
                description=(
                    "Pro-rata allows partial accrual. Cliff grants nothing until the "
                    "cliff period completes. Graded grants 50% at the cliff and 100% "
                    "at double the cliff."
                ),
                options=(
                    ("pro_rata", "Pro-rata (partial accrual)"),
                    ("cliff", "Cliff (all or nothing)"),
                    ("graded", "Graded (50% then 100%)"),
                ),
            ),
            SettingSpec(
                key="vesting_cliff_days",
                label="Cliff period (days)",
                type="integer",
                default=360,
                description="Service days required before cliff/graded vesting unlocks.",
                minimum=0,
                maximum=1825,
                unit="days",
            ),
            SettingSpec(
                key="probation_days",
                label="Probation period (days)",
                type="integer",
                default=0,
                description=(
                    "First-year eligibility: the accrual cycle starts counting only "
                    "after this many days from the joining date. 0 = eligible day one."
                ),
                minimum=0,
                maximum=365,
                unit="days",
            ),
        ),
    ),
    SettingGroup(
        key="carry_forward",
        label="Carry-Forward & Expiry",
        description="What happens to unused balances at the end of a cycle.",
        settings=(
            SettingSpec(
                key="carry_forward_limit_type",
                label="Carry-forward limit",
                type="select",
                default="unlimited",
                description=(
                    "Fixed caps the carried amount, Percentage rolls over a share of "
                    "the unused balance, Unlimited carries everything."
                ),
                options=(
                    ("unlimited", "Unlimited"),
                    ("fixed", "Fixed amount"),
                    ("percentage", "Percentage of unused"),
                ),
            ),
            SettingSpec(
                key="carry_forward_limit",
                label="Limit value",
                type="decimal",
                default=0,
                description="Amount for Fixed, or 0–100 for Percentage. Ignored when Unlimited.",
                minimum=0,
                maximum=100000,
            ),
            SettingSpec(
                key="carry_forward_expiry_months",
                label="Carry-forward expiry",
                type="integer",
                default=0,
                description=(
                    "Carried balances older than this many months are forfeited "
                    "automatically. 0 means never expire."
                ),
                minimum=0,
                maximum=120,
                unit="months",
            ),
            SettingSpec(
                key="carry_forward_grace_days",
                label="Grace period (days)",
                type="integer",
                default=0,
                description="Extra days after expiry during which the balance can still be used.",
                minimum=0,
                maximum=90,
                unit="days",
            ),
        ),
    ),
    SettingGroup(
        key="booking",
        label="Booking & Claims",
        description="How employees consume their balance.",
        settings=(
            SettingSpec(
                key="advance_booking_allowed",
                label="Advance booking allowed",
                type="boolean",
                default=True,
                description=(
                    "Yes allows booking a future travel date using currently accrued "
                    "entitlement. No restricts travel dates to today or earlier."
                ),
            ),
            SettingSpec(
                key="partial_claim_allowed",
                label="Partial claim allowed",
                type="boolean",
                default=True,
                description=(
                    "Yes allows claiming less than the ticket price (self-paid excess "
                    "or entitlement-capped issue). No requires full entitlement cover, "
                    "a full loan, or company-paid."
                ),
            ),
            SettingSpec(
                key="dependent_coverage",
                label="Dependent coverage",
                type="select",
                default="self",
                description=(
                    "Controls whether dependent fares may be claimed against the same "
                    "request (they settle through the excess route)."
                ),
                options=(
                    ("self", "Self only"),
                    ("self_plus_one", "Self + 1 dependent"),
                    ("family", "Self + family"),
                ),
            ),
        ),
    ),
    SettingGroup(
        key="cycle",
        label="Cycle Reset & Recalculation",
        description="The perpetual 'no year-end' cycle and rate-change behavior.",
        settings=(
            SettingSpec(
                key="cycle_reset_basis",
                label="Cycle reset basis",
                type="select",
                default="joining_date",
                description=(
                    "Joining date (modern continuous): rolling anniversary cycle — "
                    "no fiscal year-end wipe (Workday/SF hire-date pattern). "
                    "Calendar resets every 1 January (classic ATLAS)."
                ),
                options=(
                    ("joining_date", "Joining date (rolling anniversary)"),
                    ("calendar", "Global calendar (1 Jan)"),
                ),
            ),
            SettingSpec(
                key="rate_change_handling",
                label="Mid-cycle rate change",
                type="select",
                default="prorate",
                description=(
                    "Prorate uses the effective-dated rate on the calculation date. "
                    "Restart begins a fresh cycle when the rate changes. Ignore keeps "
                    "the cycle-start rate until the next cycle."
                ),
                options=(
                    ("prorate", "Prorate (effective-dated)"),
                    ("restart", "Restart cycle on change"),
                    ("ignore", "Ignore until next cycle"),
                ),
            ),
            SettingSpec(
                key="rounding_rule",
                label="Rounding rule",
                type="select",
                default="nearest",
                description="How prorated money amounts are rounded to two decimals.",
                options=(
                    ("nearest", "Nearest (half-up)"),
                    ("up", "Up"),
                    ("down", "Down"),
                ),
            ),
        ),
    ),
    SettingGroup(
        key="loan",
        label="Recovery & Loan",
        description="How excess ticket amounts are recovered.",
        settings=(
            SettingSpec(
                key="loan_recovery_method",
                label="Recovery method",
                type="select",
                default="manual",
                description=(
                    "Auto-deduct clears outstanding loans from new entitlements first. "
                    "Manual records repayments by hand. Salary flags loans for payroll "
                    "deduction and keeps entitlements untouched."
                ),
                options=(
                    ("manual", "Manual repayment"),
                    ("auto_deduct", "Auto-deduct from entitlement"),
                    ("salary", "Salary deduction (payroll)"),
                ),
            ),
            SettingSpec(
                key="loan_recovery_priority",
                label="Recovery priority",
                type="select",
                default="before_accrual",
                description=(
                    "Before accrual nets the loan against new entitlement. After "
                    "accrual shows the full balance but blocks new claims until the "
                    "loan is cleared."
                ),
                options=(
                    ("before_accrual", "Before accrual (net balance)"),
                    ("after_accrual", "After accrual (block claims)"),
                ),
            ),
            SettingSpec(
                key="loan_interest_rate",
                label="Default loan interest (% p.a.)",
                type="decimal",
                default=0,
                description="Annual percentage applied to new excess-recovery loans.",
                minimum=0,
                maximum=36,
                unit="%",
            ),
        ),
    ),
    SettingGroup(
        key="audit",
        label="Audit & Compliance",
        description="Fraud prevention and financial-audit controls.",
        settings=(
            SettingSpec(
                key="transaction_lock_days",
                label="Transaction lock period",
                type="integer",
                default=0,
                description=(
                    "Tickets, opening balances, and loans older than this many days "
                    "cannot be modified or deleted. 0 disables the lock."
                ),
                minimum=0,
                maximum=365,
                unit="days",
            ),
            SettingSpec(
                key="recredit_on_cancel",
                label="Auto re-credit on cancel",
                type="boolean",
                default=True,
                description=(
                    "Yes restores the entitlement automatically when a ticket is "
                    "cancelled. No restricts cancellation to administrators."
                ),
            ),
            SettingSpec(
                key="currency_conversion",
                label="Currency conversion",
                type="select",
                default="static",
                description="How foreign-currency ticket amounts are converted.",
                options=(
                    ("static", "Static rate"),
                    ("daily", "Daily exchange rate (future)"),
                ),
            ),
            SettingSpec(
                key="static_conversion_rate",
                label="Static exchange rate",
                type="decimal",
                default=1,
                description="Conversion rate applied when Currency conversion is Static (1 = none).",
                minimum=0,
                maximum=10000,
            ),
        ),
    ),
)

CATALOG_INDEX: dict[str, tuple[SettingGroup, SettingSpec]] = {
    spec.key: (group, spec) for group in SETTINGS_CATALOG for spec in group.settings
}


def _coerce(spec: SettingSpec, raw: Any) -> Any:
    """Coerce a stored JSON value into the catalog type, tolerating legacy data."""
    if raw is None:
        return spec.default
    try:
        if spec.type == "boolean":
            if isinstance(raw, bool):
                return raw
            return str(raw).strip().lower() in {"1", "true", "yes", "on"}
        if spec.type == "integer":
            return int(Decimal(str(raw)))
        if spec.type == "decimal":
            return Decimal(str(raw))
        value = str(raw).strip().lower()
        allowed = {option for option, _ in spec.options}
        return value if value in allowed else spec.default
    except (InvalidOperation, ValueError, TypeError):
        return spec.default


def validate_setting(key: str, raw: Any) -> Any:
    """Validate and coerce one catalog value; raises ValueError on unknown keys."""
    entry = CATALOG_INDEX.get(key)
    if entry is None:
        raise ValueError(f"Unknown setting '{key}'.")
    _, spec = entry
    value = _coerce(spec, raw)
    if spec.type in {"integer", "decimal"}:
        numeric = float(value)
        if spec.minimum is not None and numeric < spec.minimum:
            raise ValueError(f"{spec.label} must be at least {spec.minimum:g}.")
        if spec.maximum is not None and numeric > spec.maximum:
            raise ValueError(f"{spec.label} must be at most {spec.maximum:g}.")
    return value


def _stored_map(session: Session) -> dict[str, Any]:
    rows = session.scalars(
        select(PreferenceRow).where(
            PreferenceRow.scope_type == "global",
            PreferenceRow.scope_id == "",
            PreferenceRow.deleted_at.is_(None),
        )
    ).all()
    return {row.preference_key: row.value for row in rows}


def load_policy(session: Session) -> PolicySettings:
    """Load the effective global policy, defaulting to proven ATLAS behavior."""
    return policy_from_preferences(_stored_map(session))


def catalog_with_values(session: Session) -> list[dict[str, Any]]:
    """Render the catalog with current values for the Settings console."""
    stored = _stored_map(session)
    groups: list[dict[str, Any]] = []
    for group in SETTINGS_CATALOG:
        settings: list[dict[str, Any]] = []
        for spec in group.settings:
            value = _coerce(spec, stored.get(spec.key))
            settings.append(
                {
                    "key": spec.key,
                    "label": spec.label,
                    "type": spec.type,
                    "value": value if not isinstance(value, Decimal) else str(value),
                    "default": (
                        spec.default if not isinstance(spec.default, Decimal) else str(spec.default)
                    ),
                    "description": spec.description,
                    "options": [{"value": v, "label": label} for v, label in spec.options],
                    "minimum": spec.minimum,
                    "maximum": spec.maximum,
                    "unit": spec.unit,
                    "is_default": spec.key not in stored,
                }
            )
        groups.append(
            {
                "key": group.key,
                "label": group.label,
                "description": group.description,
                "settings": settings,
            }
        )
    return groups


def policy_default_rows() -> tuple[tuple[str, Any], ...]:
    """Seed rows so fresh installs persist the catalog defaults explicitly."""
    seeds: list[tuple[str, Any]] = []
    for group in SETTINGS_CATALOG:
        for spec in group.settings:
            seeds.append((spec.key, spec.default))
    return tuple(seeds)


def to_allocation_policy(settings: PolicySettings):
    """Project PolicySettings onto the engine-facing AllocationPolicy."""
    from airfare_management.domain.services import AllocationPolicy

    vesting = settings.vesting_type
    if vesting == "pro_rata":
        vesting = "prorata"
    limit_type = settings.carry_forward_limit_type
    if limit_type == "percentage":
        limit_type = "percent"
    return AllocationPolicy(
        accrual_frequency=settings.accrual_frequency,
        accrual_cap_multiple=(
            settings.accrual_cap_multiplier
            if settings.accrual_cap_multiplier is not None
            else Decimal("0")
        ),
        vesting_type=vesting,
        vesting_cliff_days=settings.vesting_cliff_days or 360,
        probation_days=settings.probation_days,
        carry_forward_limit_type=limit_type,
        carry_forward_limit_value=settings.carry_forward_limit,
        cycle_reset_basis=settings.cycle_reset_basis,
        rate_change_handling=settings.rate_change_handling,
        rounding_rule=settings.rounding_rule,
    )
