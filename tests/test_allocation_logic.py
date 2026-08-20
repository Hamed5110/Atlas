"""Tests for the ATLAS 30/360 airfare allocation engine used on port 3355."""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from airfare_management.api.main import DEFAULT_COMPANY_ID, create_app
from airfare_management.application.contracts import AllocationQueryHandler, PreviewAllocation
from airfare_management.config import Settings
from airfare_management.domain.models import ValidationError
from airfare_management.domain.services import (
    AllocationScenario,
    EntitlementRate,
    ExcessSettlementOption,
    RateSource,
    allocation_working_days,
    calculate_allocation_entitlement,
    calculate_entitlement,
    daily_airfare_rate,
    resolve_airfare_rate_hierarchy,
    resolve_entitlement_rate,
    settle_excess_ticket,
)
from airfare_management.infrastructure.database import (
    Base,
    EmployeeRow,
    create_session_factory,
)
from airfare_management.infrastructure.schema import (
    CompanyRow,
    LoanInstallmentRow,
    LoanPaymentRow,
    LoanRow,
    OpeningBalanceRow,
    TicketRow,
)
from airfare_management.infrastructure.security import issue_access_token

POLICY_150 = Decimal("150")
RATE_365 = Decimal("365")


def test_allocation_engine_rejects_invalid_inputs() -> None:
    """Cover negative rates, caps, openings, and missing loan tenure."""
    with pytest.raises(ValidationError, match="Airfare rate"):
        daily_airfare_rate(Decimal("-1"))
    with pytest.raises(ValidationError, match="Opening balance"):
        calculate_allocation_entitlement(
            as_of_date=date(2026, 1, 11),
            date_of_joining=date(2025, 1, 1),
            last_ticket_date=None,
            opening_balance_days=Decimal("-1"),
            opening_balance_amount=Decimal("0"),
            airfare_rate=RATE_365,
            rate_source=RateSource.GLOBAL,
            max_entitlement_cap_rate=None,
        )
    with pytest.raises(ValidationError, match="Entitlement cap"):
        calculate_allocation_entitlement(
            as_of_date=date(2026, 1, 11),
            date_of_joining=date(2025, 1, 1),
            last_ticket_date=None,
            opening_balance_days=Decimal("0"),
            opening_balance_amount=Decimal("0"),
            airfare_rate=RATE_365,
            rate_source=RateSource.GLOBAL,
            max_entitlement_cap_rate=Decimal("-1"),
        )
    with pytest.raises(ValidationError, match="cannot be negative"):
        settle_excess_ticket(Decimal("-1"), Decimal("1"), ExcessSettlementOption.SELF_PAID)
    with pytest.raises(ValidationError, match="tenure"):
        settle_excess_ticket(
            Decimal("100"), Decimal("10"), ExcessSettlementOption.LOAN, tenure_months=0
        )
    zero = settle_excess_ticket(Decimal("10"), Decimal("20"), ExcessSettlementOption.SELF_PAID)
    assert zero.excess_cost == Decimal("0")
    assert zero.company_payout == Decimal("10")


def test_allocation_preview_without_excess_and_issue_company_self() -> None:
    """Preview without settlement and persist COMPANY_PAID plus SELF_PAID issues."""
    client, headers = _client()
    preview = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={
            "as_of_date": "2026-01-11",
            "date_of_joining": "2026-01-01",
            "global_company_preference_rate": "365",
        },
    )
    assert preview.status_code == 200
    assert "excess_cost" not in preview.json()
    missing = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={"as_of_date": "2026-01-11", "date_of_joining": "2026-01-01"},
    )
    assert missing.status_code == 422
    employee = client.post(
        "/v1/employees",
        headers=headers,
        json={
            "code": "ALLOC-02",
            "full_name": "Second Allocation Employee",
            "company_id": DEFAULT_COMPANY_ID,
            "join_date": "2026-01-01",
            "pay_group": "OPS",
            "custom_airfare_rate": "365",
        },
    )
    employee_id = employee.json()["id"]
    company = client.post(
        "/v1/allocations/issue",
        headers=headers,
        json={
            "employee_id": employee_id,
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "50",
            "excess_option": "COMPANY_PAID",
            "origin_code": "KHI",
            "destination_code": "DXB",
        },
    )
    assert company.status_code == 201
    assert Decimal(company.json()["employee_payable"]) == Decimal("0")
    assert company.json()["loan_id"] is None
    self_paid = client.post(
        "/v1/allocations/issue",
        headers=headers,
        json={
            "employee_id": employee_id,
            "as_of_date": "2026-06-01",
            "requested_ticket_amount": "200",
            "excess_option": "SELF_PAID",
            "origin_code": "KHI",
            "destination_code": "JED",
        },
    )
    assert self_paid.status_code == 201
    assert Decimal(self_paid.json()["company_payout"]) == Decimal(
        self_paid.json()["final_entitlement_amount"]
    )
    unknown = client.post(
        "/v1/allocations/issue",
        headers=headers,
        json={
            "employee_id": str(uuid4()),
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "10",
            "excess_option": "SELF_PAID",
            "origin_code": "KHI",
            "destination_code": "DXB",
        },
    )
    assert unknown.status_code == 404
    same_route = client.post(
        "/v1/allocations/issue",
        headers=headers,
        json={
            "employee_id": employee_id,
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "10",
            "excess_option": "SELF_PAID",
            "origin_code": "AAA",
            "destination_code": "AAA",
        },
    )
    assert same_route.status_code == 422


def test_daily_rate_uses_atlas_cycle_divisor_60() -> None:
    """Allocation engine uses Daily_Rate = Resolved_Airfare_Rate / 60."""
    assert daily_airfare_rate(POLICY_150) == POLICY_150 / Decimal("60")
    assert daily_airfare_rate(RATE_365) == RATE_365 / Decimal("60")
    assert resolve_entitlement_rate(
        (EntitlementRate("pay_group", "OPS", Decimal("100"), Decimal("90")),),
        employee_id="E1",
        pay_group="OPS",
        preference_cap=Decimal("80"),
    ) == Decimal("80.00")
    with pytest.raises(ValidationError, match="No effective airfare rate"):
        resolve_entitlement_rate((), employee_id="E1", pay_group="OPS")


def test_rate_hierarchy_employee_pay_group_then_global() -> None:
    """Employee custom rate wins, then pay group, then global preference."""
    assert resolve_airfare_rate_hierarchy(Decimal("100"), Decimal("200"), Decimal("300")) == (
        Decimal("100"),
        RateSource.EMPLOYEE,
    )
    assert resolve_airfare_rate_hierarchy(None, Decimal("200"), Decimal("300")) == (
        Decimal("200"),
        RateSource.PAY_GROUP,
    )
    assert resolve_airfare_rate_hierarchy(None, None, Decimal("300"), Decimal("250")) == (
        Decimal("250"),
        RateSource.COMPANY,
    )
    assert resolve_airfare_rate_hierarchy(None, None, Decimal("300")) == (
        Decimal("300"),
        RateSource.GLOBAL,
    )
    with pytest.raises(ValidationError, match="No effective airfare rate"):
        resolve_airfare_rate_hierarchy(None, None, None)


def test_atlas_formula_matches_3355_engine() -> None:
    """Lock ATLAS airfare-engine.ts cases: remaining = min(60, open + current - paid)."""
    excel = calculate_entitlement(
        Decimal("28.41666666666667"), 360, Decimal("33.417"), POLICY_150
    )
    assert excel.current_days == Decimal("30.0000")
    assert excel.remaining_days == Decimal("24.9997")
    assert excel.payable == Decimal("62.50")
    full_year = calculate_entitlement(Decimal("0"), 360, Decimal("0"), POLICY_150)
    assert full_year.current_days == Decimal("30.0000")
    assert full_year.remaining_days == Decimal("30.0000")
    assert full_year.payable == Decimal("75.00")
    june = calculate_entitlement(Decimal("0"), 168, Decimal("0"), POLICY_150)
    assert june.current_days == Decimal("14.0000")
    assert june.payable == Decimal("35.00")
    capped = calculate_entitlement(Decimal("90"), 168, Decimal("0"), POLICY_150)
    assert capped.remaining_days == Decimal("60.0000")
    assert capped.payable == Decimal("150.00")


def test_scenario_a_previous_ticket_resets_working_days() -> None:
    """Previous ticket moves 30/360 start; opening BHD is still applied (CalcPolicy)."""
    result = calculate_allocation_entitlement(
        as_of_date=date(2026, 1, 11),
        date_of_joining=date(2020, 1, 1),
        last_ticket_date=date(2026, 1, 1),
        opening_balance_days=Decimal("20"),
        opening_balance_amount=Decimal("50"),
        airfare_rate=POLICY_150,
        rate_source=RateSource.EMPLOYEE,
        max_entitlement_cap_rate=None,
    )
    assert result.scenario is AllocationScenario.PREVIOUS_TICKET
    assert result.accrual_start == date(2026, 1, 2)
    assert result.accrued_days == Decimal("0.8333")
    assert result.opening_balance_days == Decimal("20")
    assert result.opening_balance_amount == Decimal("50")
    assert result.final_entitlement_amount == Decimal("52.08")


def test_scenario_b_current_year_new_joinee() -> None:
    """New joiner in current year accrues from DOJ using 30/360 working days."""
    result = calculate_allocation_entitlement(
        as_of_date=date(2026, 3, 21),
        date_of_joining=date(2026, 3, 1),
        last_ticket_date=None,
        opening_balance_days=Decimal("0"),
        opening_balance_amount=Decimal("0"),
        airfare_rate=POLICY_150,
        rate_source=RateSource.PAY_GROUP,
        max_entitlement_cap_rate=None,
    )
    assert result.scenario is AllocationScenario.NEW_JOINEE
    assert result.accrual_start == date(2026, 3, 1)
    assert result.accrued_days == Decimal("1.7500")
    assert result.final_entitlement_amount == Decimal("4.38")


def test_scenario_c_opening_balance_plus_current_year_accrual() -> None:
    """Opening BHD plus current-year 30/360 accrual, capped at MaxPayout."""
    result = calculate_allocation_entitlement(
        as_of_date=date(2026, 1, 11),
        date_of_joining=date(2025, 6, 1),
        last_ticket_date=None,
        opening_balance_days=Decimal("20"),
        opening_balance_amount=Decimal("40"),
        airfare_rate=POLICY_150,
        rate_source=RateSource.GLOBAL,
        max_entitlement_cap_rate=None,
    )
    assert result.scenario is AllocationScenario.OPENING_BALANCE_ACCRUAL
    assert result.accrual_start == date(2026, 1, 1)
    assert result.accrued_days == Decimal("0.9167")
    assert result.final_entitlement_amount == Decimal("42.29")


def test_employee_0004_as_of_2026_08_18_matches_atlas() -> None:
    """Live screenshot case: 0004 joined 2024-01-01, opening 0, global 150."""
    result = calculate_allocation_entitlement(
        as_of_date=date(2026, 8, 18),
        date_of_joining=date(2024, 1, 1),
        last_ticket_date=None,
        opening_balance_days=Decimal("0"),
        opening_balance_amount=Decimal("0"),
        airfare_rate=POLICY_150,
        rate_source=RateSource.GLOBAL,
        max_entitlement_cap_rate=None,
        rate_days=Decimal("365"),
    )
    assert allocation_working_days(date(2026, 8, 18), 2026, date(2024, 1, 1), None) == 228
    assert result.accrual_start == date(2026, 1, 1)
    assert result.accrued_days == Decimal("19.0000")
    assert result.daily_rate == Decimal("2.5")
    assert result.rate_days == Decimal("60")
    assert result.current_year_amount == Decimal("47.50")
    assert result.final_entitlement_amount == Decimal("47.50")


def test_rate_capping_uses_minimum_of_policy_and_cap() -> None:
    """Final entitlement is capped: min(calculated_entitlement, max_cap_rate)."""
    result = calculate_allocation_entitlement(
        as_of_date=date(2026, 1, 11),
        date_of_joining=date(2025, 1, 1),
        last_ticket_date=None,
        opening_balance_days=Decimal("20"),
        opening_balance_amount=Decimal("40"),
        airfare_rate=POLICY_150,
        rate_source=RateSource.GLOBAL,
        max_entitlement_cap_rate=Decimal("12"),
    )
    assert result.final_entitlement_amount == Decimal("12.00")


def test_excess_loan_creates_active_emi_terms() -> None:
    """LOAN posts principal = excess and EMI = excess / tenure."""
    settlement = settle_excess_ticket(
        Decimal("100"),
        Decimal("40"),
        ExcessSettlementOption.LOAN,
        tenure_months=6,
    )
    assert settlement.excess_cost == Decimal("60")
    assert settlement.loan_principal == Decimal("60")
    assert settlement.emi == Decimal("10")
    assert settlement.loan_status == "Active"
    assert settlement.company_payout == Decimal("40")
    assert settlement.employee_payable == Decimal("60")


def test_excess_company_paid_and_self_paid_routes() -> None:
    """COMPANY_PAID zeros employee payable; SELF_PAID pays only the entitlement."""
    company = settle_excess_ticket(
        Decimal("100"), Decimal("40"), ExcessSettlementOption.COMPANY_PAID
    )
    assert company.employee_payable == Decimal("0")
    assert company.company_payout == Decimal("100")
    assert company.loan_principal is None
    self_paid = settle_excess_ticket(
        Decimal("100"), Decimal("40"), ExcessSettlementOption.SELF_PAID
    )
    assert self_paid.employee_payable == Decimal("60")
    assert self_paid.company_payout == Decimal("40")


def test_allocation_query_handler_combines_hierarchy_and_settlement() -> None:
    """Application handler resolves rates then optional excess settlement."""
    preview = AllocationQueryHandler().handle(
        PreviewAllocation(
            as_of_date=date(2026, 1, 11),
            date_of_joining=date(2026, 1, 1),
            last_ticket_date=None,
            opening_balance_days=Decimal("0"),
            opening_balance_amount=Decimal("0"),
            employee_custom_rate=None,
            pay_group_rate=None,
            global_company_preference_rate=POLICY_150,
            requested_ticket_amount=Decimal("25"),
            excess_option=ExcessSettlementOption.LOAN,
            tenure_months=5,
        )
    )
    assert preview.rate_source is RateSource.GLOBAL
    assert preview.entitlement.final_entitlement_amount == Decimal("2.29")
    assert preview.settlement is not None
    assert preview.settlement.emi == Decimal("4.54")
    capped = AllocationQueryHandler().handle(
        PreviewAllocation(
            as_of_date=date(2026, 1, 1),
            date_of_joining=date(2026, 6, 1),
            last_ticket_date=None,
            opening_balance_days=Decimal("0"),
            opening_balance_amount=Decimal("0"),
            employee_custom_rate=None,
            pay_group_rate=RATE_365,
            global_company_preference_rate=Decimal("1"),
            employee_cap=None,
            pay_group_cap=Decimal("5"),
            global_cap=Decimal("100"),
        )
    )
    assert capped.rate_source is RateSource.PAY_GROUP
    assert capped.entitlement.accrued_days == Decimal("0")
    assert capped.entitlement.final_entitlement_amount == Decimal("0.00")


def _client() -> tuple[TestClient, dict[str, str]]:
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="a" * 32,
        jwt_issuer="airfare-tests",
        bootstrap_admin_password="StrongPassword!2026",
    )
    app = create_app(settings)
    token = issue_access_token(uuid4(), {"admin", "hr", "manager", "finance"}, settings)
    return TestClient(app), {"Authorization": f"Bearer {token}"}


def test_allocation_preview_api_decimal_math() -> None:
    """Preview endpoint returns exact Decimal strings for sample payloads."""
    client, headers = _client()
    denied = client.post(
        "/v1/allocations/preview",
        json={
            "as_of_date": "2026-01-11",
            "date_of_joining": "2026-01-01",
            "global_company_preference_rate": "365",
        },
    )
    assert denied.status_code == 401
    response = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={
            "as_of_date": "2026-01-11",
            "date_of_joining": "2025-01-01",
            "opening_balance_days": "20",
            "opening_balance_amount": "40",
            "global_company_preference_rate": "150",
            "max_entitlement_cap_rate": "12",
            "requested_ticket_amount": "100",
            "excess_option": "LOAN",
            "tenure_months": 6,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["scenario"] == "opening_balance_accrual"
    assert Decimal(body["daily_rate"]) == POLICY_150 / Decimal("60")
    assert Decimal(body["final_entitlement_amount"]) == Decimal("12.00")
    assert Decimal(body["excess_cost"]) == Decimal("88.00")
    assert Decimal(body["emi"]) == Decimal("14.67")


def test_allocation_issue_persists_loan_on_excess() -> None:
    """Issue endpoint stores the ticket and an Active EMI loan for excess LOAN."""
    client, headers = _client()
    employee = client.post(
        "/v1/employees",
        headers=headers,
        json={
            "code": "ALLOC-01",
            "full_name": "Allocation Employee",
            "company_id": DEFAULT_COMPANY_ID,
            "join_date": "2025-01-01",
            "custom_airfare_rate": "150",
            "max_entitlement_cap_rate": "150",
        },
    )
    assert employee.status_code == 201
    employee_id = employee.json()["id"]
    assert (
        client.post(
            "/v1/opening-balances",
            headers=headers,
            json={
                "employee_id": employee_id,
                "balance_year": 2026,
                "opening_days": "20",
                "opening_amount": "40",
                "maximum_payout": "150",
            },
        ).status_code
        == 201
    )
    issued = client.post(
        "/v1/allocations/issue",
        headers=headers,
        json={
            "employee_id": employee_id,
            "as_of_date": "2026-01-11",
            "requested_ticket_amount": "100",
            "excess_option": "LOAN",
            "tenure_months": 6,
            "origin_code": "KHI",
            "destination_code": "DXB",
        },
    )
    assert issued.status_code == 201
    body = issued.json()
    assert Decimal(body["final_entitlement_amount"]) == Decimal("42.29")
    assert Decimal(body["excess_cost"]) == Decimal("57.71")
    assert Decimal(body["emi"]) == Decimal("9.62")
    assert body["loan_id"]
    loans = client.get("/v1/loans", headers=headers).json()
    assert Decimal(loans[0]["principal"]) == Decimal("57.7100")
    assert Decimal(loans[0]["monthly_installment"]) == Decimal("9.6200")
    assert loans[0]["status"] == "active"
    assert loans[0]["source_ticket_id"] == body["ticket_id"]


def test_database_rollback_discards_issued_allocation() -> None:
    """A rolled-back unit of work leaves no ticket or loan rows."""
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="b" * 32,
    )
    sessions = create_session_factory(settings)
    Base.metadata.create_all(sessions.kw["bind"])
    employee_id = uuid4()
    company_id = uuid4()
    stamped = datetime(2026, 1, 1, tzinfo=UTC)
    with sessions() as session:
        session.add(CompanyRow(id=str(company_id), code="RB", name="Rollback Co"))
        session.flush()
        session.add(
            EmployeeRow(
                id=employee_id,
                company_id=str(company_id),
                code="RB-01",
                full_name="Rollback Employee",
                join_date=date(2025, 1, 1),
                custom_airfare_rate=RATE_365,
                created_at=stamped,
                updated_at=stamped,
            )
        )
        session.commit()
    with sessions() as session:
        ticket = TicketRow(
            employee_id=employee_id,
            travel_date=date(2026, 1, 11),
            origin_code="KHI",
            destination_code="DXB",
            ticket_cost=Decimal("100"),
            entitlement=Decimal("40"),
            company_paid=Decimal("40"),
            excess_handling="LOAN",
            excess_cost=Decimal("60"),
            status="approved",
        )
        session.add(ticket)
        session.flush()
        session.add(
            LoanRow(
                employee_id=employee_id,
                source_ticket_id=ticket.id,
                principal=Decimal("60"),
                annual_rate=Decimal("0"),
                installments=6,
                monthly_installment=Decimal("10"),
                outstanding=Decimal("60"),
                status="active",
                first_due_date=date(2026, 2, 1),
            )
        )
        session.flush()
        assert session.scalar(select(TicketRow)) is not None
        assert session.scalar(select(LoanRow)) is not None
        session.rollback()
        assert session.scalar(select(TicketRow)) is None
        assert session.scalar(select(LoanRow)) is None
        assert session.get(EmployeeRow, employee_id) is not None
    sessions.kw["bind"].dispose()


def test_mssql_allocation_insert_rolls_back() -> None:
    """When local MSSQL is reachable, uncommitted allocation work is discarded."""
    settings = Settings()
    if "mssql" not in settings.database_url:
        pytest.skip("AIRFARE_DATABASE_URL is not MSSQL.")
    try:
        sessions = create_session_factory(settings)
        with sessions() as probe:
            probe.scalar(select(CompanyRow.id).limit(1))
    except Exception as exc:  # pragma: no cover - environment specific
        pytest.skip(f"Local MSSQL is not reachable: {exc}")
    employee_id = uuid4()
    stamped = datetime(2026, 1, 1, tzinfo=UTC)
    with sessions() as session:
        session.add(
            EmployeeRow(
                id=employee_id,
                company_id=DEFAULT_COMPANY_ID,
                code=f"RB{employee_id.hex[:8]}",
                full_name="MSSQL Rollback Employee",
                join_date=date(2025, 1, 1),
                custom_airfare_rate=RATE_365,
                created_at=stamped,
                updated_at=stamped,
            )
        )
        ticket = TicketRow(
            employee_id=employee_id,
            travel_date=date(2026, 1, 11),
            origin_code="KHI",
            destination_code="DXB",
            ticket_cost=Decimal("100"),
            entitlement=Decimal("40"),
            company_paid=Decimal("40"),
            excess_handling="LOAN",
            excess_cost=Decimal("60"),
            status="approved",
        )
        session.add(ticket)
        session.flush()
        stored_id = ticket.id
        assert session.get(TicketRow, stored_id) is not None
        session.rollback()
        assert session.get(TicketRow, stored_id) is None
        assert session.get(EmployeeRow, employee_id) is None
    sessions.kw["bind"].dispose()


def test_mssql_allocation_issue_commits_then_cleans_up() -> None:
    """Issue a ticket against live MSSQL with an isolated employee, then remove it."""
    settings = Settings()
    if "mssql" not in settings.database_url:
        pytest.skip("AIRFARE_DATABASE_URL is not MSSQL.")
    try:
        sessions = create_session_factory(settings)
        with sessions() as probe:
            if probe.get(CompanyRow, DEFAULT_COMPANY_ID) is None:
                pytest.skip("Default company is not present in MSSQL.")
    except Exception as exc:  # pragma: no cover - environment specific
        pytest.skip(f"Local MSSQL is not reachable: {exc}")
    client = TestClient(create_app(settings))
    token = issue_access_token(
        uuid4(),
        {"admin", "SYSTEM_ADMIN", "hr", "HR_MANAGER", "manager"},
        settings,
    )
    headers = {"Authorization": f"Bearer {token}"}
    employee_id: UUID | None = None
    try:
        created = client.post(
            "/v1/employees",
            headers=headers,
            json={
                "code": f"LIVE{uuid4().hex[:8]}",
                "full_name": "Live Issue Probe",
                "company_id": DEFAULT_COMPANY_ID,
                "join_date": "2025-01-01",
                "custom_airfare_rate": "150",
                "max_entitlement_cap_rate": "150",
            },
        )
        assert created.status_code == 201, created.text
        employee_id = UUID(str(created.json()["id"]))
        opening = client.post(
            "/v1/opening-balances",
            headers=headers,
            json={
                "employee_id": str(employee_id),
                "balance_year": 2026,
                "opening_days": "20",
                "opening_amount": "40",
                "maximum_payout": "150",
            },
        )
        assert opening.status_code == 201, opening.text
        issued = client.post(
            "/v1/allocations/issue",
            headers=headers,
            json={
                "employee_id": str(employee_id),
                "as_of_date": "2026-01-11",
                "requested_ticket_amount": "100",
                "excess_option": "LOAN",
                "tenure_months": 6,
                "origin_code": "KHI",
                "destination_code": "DXB",
            },
        )
        assert issued.status_code == 201, issued.text
        body = issued.json()
        assert Decimal(body["final_entitlement_amount"]) == Decimal("42.29")
        assert Decimal(body["excess_cost"]) == Decimal("57.71")
        assert body["ticket_id"]
        assert body["loan_id"]
        with sessions() as session:
            assert session.get(TicketRow, body["ticket_id"]) is not None
            assert session.get(LoanRow, body["loan_id"]) is not None
    finally:
        if employee_id is not None:
            with sessions() as session:
                loan_ids = list(
                    session.scalars(select(LoanRow.id).where(LoanRow.employee_id == employee_id))
                )
                if loan_ids:
                    session.execute(
                        delete(LoanInstallmentRow).where(LoanInstallmentRow.loan_id.in_(loan_ids))
                    )
                    session.execute(
                        delete(LoanPaymentRow).where(LoanPaymentRow.loan_id.in_(loan_ids))
                    )
                    session.execute(delete(LoanRow).where(LoanRow.id.in_(loan_ids)))
                session.execute(delete(TicketRow).where(TicketRow.employee_id == employee_id))
                session.execute(
                    delete(OpeningBalanceRow).where(OpeningBalanceRow.employee_id == employee_id)
                )
                session.execute(delete(EmployeeRow).where(EmployeeRow.id == employee_id))
                session.commit()
            with sessions() as session:
                assert session.get(EmployeeRow, employee_id) is None
        sessions.kw["bind"].dispose()
