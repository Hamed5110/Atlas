"""Boundary tests for domain calculations and aggregate behavior."""

from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest

from airfare_management.domain.models import Employee, Ticket, ValidationError
from airfare_management.domain.services import (
    EntitlementScenario,
    allocation_working_days,
    calculate_emi,
    calculate_entitlement,
    calculate_entitlement_scenario,
    conditional_format,
)


def test_entitlement_boundary_failures_and_date_edges() -> None:
    """Cover invalid values, required scenario anchors, and year boundaries."""
    assert allocation_working_days(date(2025, 1, 1), 2026) == 0
    assert allocation_working_days(date(2027, 1, 1), 2026) == 360
    assert allocation_working_days(date(2026, 1, 1), 2026, date(2026, 2, 1)) == 0
    with pytest.raises(ValidationError):
        calculate_entitlement(Decimal("0"), 361, Decimal("0"), Decimal("1"))
    with pytest.raises(ValidationError):
        calculate_entitlement(Decimal("-1"), 1, Decimal("0"), Decimal("1"))
    with pytest.raises(ValidationError):
        calculate_entitlement_scenario(
            EntitlementScenario.NEW_JOINER,
            date(2026, 1, 1),
            2026,
            Decimal("0"),
            Decimal("0"),
            Decimal("1"),
        )
    with pytest.raises(ValidationError):
        calculate_entitlement_scenario(
            EntitlementScenario.MID_YEAR_ALLOCATION,
            date(2026, 1, 1),
            2026,
            Decimal("0"),
            Decimal("0"),
            Decimal("1"),
        )
    with pytest.raises(ValidationError):
        calculate_entitlement_scenario(
            EntitlementScenario.CARRY_FORWARD,
            date(2026, 1, 1),
            2026,
            Decimal("0"),
            Decimal("0"),
            Decimal("1"),
            carry_forward_cap=Decimal("-1"),
        )
    with pytest.raises(ValidationError):
        calculate_emi(Decimal("0"), Decimal("0"), 1)


def test_domain_soft_delete_excess_and_format_tokens() -> None:
    """Cover aggregate soft deletion, ticket excess, and formatting outcomes."""
    employee = Employee(
        company_id=uuid4(),
        code="EDGE",
        full_name="Edge Employee",
        join_date=date(2026, 1, 1),
    )
    employee.soft_delete(1)
    assert employee.deleted_at is not None
    assert employee.version == 2
    ticket = Ticket(
        employee_id=employee.id,
        travel_date=date(2026, 1, 1),
        ticket_cost=Decimal("100"),
        entitlement=Decimal("80"),
        company_paid=Decimal("90"),
    )
    assert ticket.excess_amount == Decimal("10")
    assert conditional_format(status="failed") == "danger"
    assert conditional_format(status="pending") == "warning"
    assert conditional_format(status="approved") == "success"
    assert conditional_format(status="unknown") == "neutral"
