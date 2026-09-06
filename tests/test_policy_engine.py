"""Policy rule-engine catalog and entitlement wiring."""

from datetime import date
from decimal import Decimal

from airfare_management.domain.services import (
    AllocationPolicy,
    RateSource,
    calculate_allocation_entitlement,
    policy_from_preferences,
)
from airfare_management.infrastructure.policy import (
    SETTINGS_CATALOG,
    to_allocation_policy,
    validate_setting,
)


def test_catalog_covers_seven_enterprise_groups() -> None:
    keys = {group.key for group in SETTINGS_CATALOG}
    assert keys == {
        "accrual",
        "vesting",
        "carry_forward",
        "booking",
        "cycle",
        "loan",
        "audit",
    }
    assert sum(len(group.settings) for group in SETTINGS_CATALOG) >= 20


def test_default_policy_is_modern_continuous_joining_date() -> None:
    policy = policy_from_preferences({})
    assert policy.accrual_frequency == "daily"
    assert policy.vesting_type == "pro_rata"
    assert policy.cycle_reset_basis == "joining_date"
    assert policy.negative_balance_allowed is True
    assert policy.partial_claim_allowed is True
    with_policy = calculate_allocation_entitlement(
        as_of_date=date(2026, 12, 31),
        date_of_joining=date(2024, 1, 15),
        last_ticket_date=None,
        opening_balance_days=Decimal("0"),
        opening_balance_amount=Decimal("0"),
        airfare_rate=Decimal("150"),
        rate_source=RateSource.GLOBAL,
        max_entitlement_cap_rate=Decimal("150"),
        policy=to_allocation_policy(policy),
    )
    without_policy = calculate_allocation_entitlement(
        as_of_date=date(2026, 12, 31),
        date_of_joining=date(2024, 1, 15),
        last_ticket_date=None,
        opening_balance_days=Decimal("0"),
        opening_balance_amount=Decimal("0"),
        airfare_rate=Decimal("150"),
        rate_source=RateSource.GLOBAL,
        max_entitlement_cap_rate=Decimal("150"),
    )
    assert with_policy.final_entitlement_amount == without_policy.final_entitlement_amount
    assert with_policy.accrued_days == without_policy.accrued_days
    assert any("joining anniversary" in n for n in with_policy.policy_notes)


def test_calendar_cycle_still_available_explicitly() -> None:
    calendar = AllocationPolicy(cycle_reset_basis="calendar")
    joining = AllocationPolicy(cycle_reset_basis="joining_date")
    as_of = date(2026, 9, 6)
    join = date(2020, 4, 16)
    kwargs = dict(
        as_of_date=as_of,
        date_of_joining=join,
        last_ticket_date=None,
        opening_balance_days=Decimal("0"),
        opening_balance_amount=Decimal("0"),
        airfare_rate=Decimal("150"),
        rate_source=RateSource.GLOBAL,
        max_entitlement_cap_rate=None,
    )
    cal = calculate_allocation_entitlement(**kwargs, policy=calendar)
    roll = calculate_allocation_entitlement(**kwargs, policy=joining)
    assert cal.accrual_start == date(2026, 1, 1)
    assert roll.accrual_start == date(2026, 4, 16)
    assert roll.accrued_days < cal.accrued_days
    assert any("joining anniversary" in n for n in roll.policy_notes)

def test_cliff_vesting_blocks_until_service_days() -> None:
    policy = AllocationPolicy(vesting_type="cliff", vesting_cliff_days=360)
    blocked = calculate_allocation_entitlement(
        as_of_date=date(2026, 3, 1),
        date_of_joining=date(2026, 1, 1),
        last_ticket_date=None,
        opening_balance_days=Decimal("0"),
        opening_balance_amount=Decimal("0"),
        airfare_rate=Decimal("150"),
        rate_source=RateSource.GLOBAL,
        max_entitlement_cap_rate=None,
        policy=policy,
    )
    assert blocked.accrued_days == Decimal("0")
    assert any("Cliff" in note for note in blocked.policy_notes)


def test_carry_forward_fixed_cap() -> None:
    policy = AllocationPolicy(
        carry_forward_limit_type="fixed",
        carry_forward_limit_value=Decimal("40"),
    )
    result = calculate_allocation_entitlement(
        as_of_date=date(2026, 1, 31),
        date_of_joining=date(2020, 1, 1),
        last_ticket_date=None,
        opening_balance_days=Decimal("0"),
        opening_balance_amount=Decimal("80"),
        airfare_rate=Decimal("150"),
        rate_source=RateSource.GLOBAL,
        max_entitlement_cap_rate=None,
        policy=policy,
    )
    assert result.opening_balance_amount == Decimal("40")
    assert any("Carry-forward" in note for note in result.policy_notes)


def test_validate_setting_rejects_unknown_and_out_of_range() -> None:
    assert validate_setting("accrual_frequency", "monthly") == "monthly"
    try:
        validate_setting("nope", 1)
        assert False, "expected ValueError"
    except ValueError:
        pass
    try:
        validate_setting("loan_interest_rate", 99)
        assert False, "expected ValueError"
    except ValueError:
        pass
