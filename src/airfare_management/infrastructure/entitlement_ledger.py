"""Modern entitlement ledger — thin repository (Python orchestration; MSSQL SPs optional)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import MetaData, Table, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from airfare_management.domain.models import DomainError

TWOPLACES = Decimal("0.01")


def _q2(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def _table(session: Session, name: str) -> Table:
    bind = session.get_bind()
    if bind is None:
        raise DomainError("database_unavailable", "No database bind.")
    engine: Engine = bind if isinstance(bind, Engine) else bind.engine  # type: ignore[assignment]
    return Table(name, MetaData(), autoload_with=engine)


def _now() -> datetime:
    return datetime.now(UTC)


def list_types(session: Session, company_id: UUID | None = None) -> list[dict[str, Any]]:
    t = _table(session, "entitlement_types")
    stmt = select(t).where(t.c.deleted_at.is_(None), t.c.is_current == True)  # noqa: E712
    if company_id:
        stmt = stmt.where(t.c.company_id == str(company_id))
    return [dict(r._mapping) for r in session.execute(stmt)]


def list_rules(session: Session, company_id: UUID | None = None) -> list[dict[str, Any]]:
    t = _table(session, "entitlement_rules")
    stmt = select(t).where(t.c.deleted_at.is_(None), t.c.is_current == True)  # noqa: E712
    if company_id:
        stmt = stmt.where(t.c.company_id == str(company_id))
    return [dict(r._mapping) for r in session.execute(stmt)]


def create_rule(session: Session, payload: dict[str, Any], *, actor: str) -> dict[str, Any]:
    t = _table(session, "entitlement_rules")
    row_id = str(uuid4())
    now = _now()
    values = {
        "id": row_id,
        "company_id": str(payload["company_id"]),
        "entitlement_type_id": payload["entitlement_type_id"],
        "grade": payload.get("grade") or "",
        "location": payload.get("location") or "",
        "family_status": payload.get("family_status") or "",
        "los_band_from": payload.get("los_band_from", 0),
        "los_band_to": payload.get("los_band_to", 99),
        "annual_amount": payload["annual_amount"],
        "is_active": payload.get("is_active", True),
        "effective_from": payload.get("effective_from") or date.today(),
        "effective_to": payload.get("effective_to") or date(9999, 12, 31),
        "is_current": True,
        "version": 1,
        "created_at": now,
        "updated_at": now,
        "created_by": actor,
        "updated_by": actor,
        "deleted_at": None,
    }
    session.execute(t.insert().values(**values))
    session.flush()
    return values


def update_rule_effective(
    session: Session, rule_id: str, payload: dict[str, Any], *, actor: str
) -> dict[str, Any]:
    """Close current row and insert a new current version (effective dating)."""
    t = _table(session, "entitlement_rules")
    current = session.execute(select(t).where(t.c.id == rule_id, t.c.deleted_at.is_(None))).first()
    if current is None:
        raise DomainError("not_found", "Entitlement rule not found.")
    row = dict(current._mapping)
    today = date.today()
    session.execute(
        t.update()
        .where(t.c.id == rule_id)
        .values(is_current=False, effective_to=today, updated_at=_now(), updated_by=actor)
    )
    new_payload = {
        "company_id": row["company_id"],
        "entitlement_type_id": row["entitlement_type_id"],
        "grade": payload.get("grade", row["grade"]),
        "location": payload.get("location", row["location"]),
        "family_status": payload.get("family_status", row["family_status"]),
        "los_band_from": payload.get("los_band_from", row["los_band_from"]),
        "los_band_to": payload.get("los_band_to", row["los_band_to"]),
        "annual_amount": payload.get("annual_amount", row["annual_amount"]),
        "is_active": payload.get("is_active", row["is_active"]),
        "effective_from": today,
    }
    return create_rule(session, new_payload, actor=actor)


def soft_delete_rule(session: Session, rule_id: str, *, actor: str) -> None:
    t = _table(session, "entitlement_rules")
    result = session.execute(
        t.update()
        .where(t.c.id == rule_id, t.c.deleted_at.is_(None))
        .values(deleted_at=_now(), is_current=False, updated_at=_now(), updated_by=actor)
    )
    if result.rowcount == 0:
        raise DomainError("not_found", "Entitlement rule not found.")


def ensure_default_type(session: Session, company_id: UUID, *, actor: str) -> str:
    types = list_types(session, company_id)
    for item in types:
        if str(item.get("code", "")).upper() == "AIRFARE":
            return str(item["id"])
    t = _table(session, "entitlement_types")
    row_id = str(uuid4())
    now = _now()
    session.execute(
        t.insert().values(
            id=row_id,
            company_id=str(company_id),
            code="AIRFARE",
            name="Airfare entitlement",
            accrual_frequency="annual",
            is_active=True,
            effective_from=date.today(),
            effective_to=date(9999, 12, 31),
            is_current=True,
            version=1,
            created_at=now,
            updated_at=now,
            created_by=actor,
            updated_by=actor,
            deleted_at=None,
        )
    )
    session.flush()
    return row_id


def get_account(
    session: Session,
    *,
    company_id: UUID,
    employee_id: UUID,
    fiscal_year: int,
    entitlement_type_id: str,
) -> dict[str, Any] | None:
    t = _table(session, "entitlement_accounts")
    row = session.execute(
        select(t).where(
            t.c.company_id == str(company_id),
            t.c.employee_id == employee_id,
            t.c.fiscal_year == fiscal_year,
            t.c.entitlement_type_id == entitlement_type_id,
            t.c.deleted_at.is_(None),
            t.c.is_current == True,  # noqa: E712
        )
    ).first()
    return dict(row._mapping) if row else None


def list_transactions(session: Session, account_id: str) -> list[dict[str, Any]]:
    t = _table(session, "entitlement_transactions")
    rows = session.execute(
        select(t).where(t.c.account_id == account_id).order_by(t.c.created_at.desc())
    )
    return [dict(r._mapping) for r in rows]


def reconcile(
    session: Session, *, company_id: UUID, fiscal_year: int, entitlement_type_id: str
) -> dict[str, Any]:
    accounts = _table(session, "entitlement_accounts")
    employees = _table(session, "employees")
    rows = session.execute(
        select(
            accounts.c.employee_id,
            employees.c.full_name,
            accounts.c.opening_balance,
            accounts.c.accruals,
            accounts.c.used_amount,
            accounts.c.adjustments,
            accounts.c.forfeited,
            accounts.c.current_balance,
            accounts.c.id,
        )
        .select_from(accounts.join(employees, employees.c.id == accounts.c.employee_id))
        .where(
            accounts.c.company_id == str(company_id),
            accounts.c.fiscal_year == fiscal_year,
            accounts.c.entitlement_type_id == entitlement_type_id,
            accounts.c.deleted_at.is_(None),
            accounts.c.is_current == True,  # noqa: E712
        )
    )
    records: list[dict[str, Any]] = []
    total_variance = Decimal("0")
    for r in rows:
        m = r._mapping
        expected = _q2(
            Decimal(str(m["opening_balance"]))
            + Decimal(str(m["accruals"]))
            - Decimal(str(m["used_amount"]))
            + Decimal(str(m["adjustments"]))
            - Decimal(str(m["forfeited"]))
        )
        current = _q2(Decimal(str(m["current_balance"])))
        variance = _q2(expected - current)
        total_variance += variance
        records.append(
            {
                "employee_id": str(m["employee_id"]),
                "employee_name": m["full_name"],
                "expected_balance": expected,
                "current_balance": current,
                "variance": variance,
                "last_transaction_date": None,
            }
        )
    return {
        "fiscal_year": fiscal_year,
        "entitlement_type_id": entitlement_type_id,
        "records": records,
        "total_variance": _q2(total_variance),
        "is_balanced": total_variance == 0,
    }


def _resolve_annual_amount(
    session: Session,
    *,
    company_id: UUID,
    employee_id: str,
    entitlement_type_id: str,
    as_of: date,
) -> Decimal:
    """Modern path: entitlement_rules first, else live entitlement_rates (BHD)."""
    rules = _table(session, "entitlement_rules")
    rule = session.execute(
        select(rules)
        .where(
            rules.c.company_id == str(company_id),
            rules.c.entitlement_type_id == entitlement_type_id,
            rules.c.is_current == True,  # noqa: E712
            rules.c.is_active == True,  # noqa: E712
            rules.c.deleted_at.is_(None),
        )
        .limit(1)
    ).first()
    if rule:
        return Decimal(str(rule._mapping["annual_amount"] or 0))

    rates = _table(session, "entitlement_rates")
    company_scope = str(company_id)
    for scope_type, scope_id in (
        ("employee", employee_id),
        ("company", company_scope),
        ("global", None),
    ):
        stmt = select(rates).where(
            rates.c.scope_type == scope_type,
            rates.c.deleted_at.is_(None),
            rates.c.effective_from <= as_of,
            rates.c.effective_to >= as_of,
        )
        if scope_id is None:
            # global rows may store NULL or empty scope_id
            stmt = stmt.where((rates.c.scope_id.is_(None)) | (rates.c.scope_id == ""))
        else:
            stmt = stmt.where(rates.c.scope_id == scope_id)
        row = session.execute(stmt.order_by(rates.c.effective_from.desc()).limit(1)).first()
        if row:
            return Decimal(str(row._mapping["amount"] or 0))

    any_rate = session.execute(
        select(rates)
        .where(
            rates.c.deleted_at.is_(None),
            rates.c.effective_from <= as_of,
            rates.c.effective_to >= as_of,
        )
        .order_by(rates.c.effective_from.desc())
        .limit(1)
    ).first()
    if any_rate:
        return Decimal(str(any_rate._mapping["amount"] or 0))
    return Decimal("0")


def accrue_annual_python(
    session: Session,
    *,
    company_id: UUID,
    fiscal_year: int,
    entitlement_type_id: str,
    run_by: str,
) -> dict[str, Any]:
    """Portable annual accrual (used when MSSQL SP is unavailable).

    Seeds modern ``entitlement_accounts`` from rules, or from live
    ``entitlement_rates`` when the rule matrix is empty (Atlas HCM default).
    """
    employees = _table(session, "employees")
    accounts = _table(session, "entitlement_accounts")
    txns = _table(session, "entitlement_transactions")
    year_start = date(fiscal_year, 1, 1)
    year_end = date(fiscal_year, 12, 31)
    total_days = (year_end - year_start).days + 1
    now = _now()
    rows_processed = 0
    total = Decimal("0")
    rate_backed = 0

    emps = session.execute(
        select(employees).where(
            employees.c.company_id == str(company_id),
            employees.c.deleted_at.is_(None),
            employees.c.active == True,  # noqa: E712
        )
    )
    for emp in emps:
        e = emp._mapping
        existing = get_account(
            session,
            company_id=company_id,
            employee_id=e["id"],
            fiscal_year=fiscal_year,
            entitlement_type_id=entitlement_type_id,
        )
        if existing:
            continue
        annual = _resolve_annual_amount(
            session,
            company_id=company_id,
            employee_id=str(e["id"]),
            entitlement_type_id=entitlement_type_id,
            as_of=year_end,
        )
        if annual > 0:
            rate_backed += 1
        hire = e.get("join_date")
        if hire is None:
            eligible = total_days
        elif hire > year_end:
            eligible = 0
        elif hire < year_start:
            eligible = total_days
        else:
            eligible = (year_end - hire).days + 1
        prorated = _q2(annual * Decimal(eligible) / Decimal(total_days)) if total_days else Decimal("0")
        account_id = str(uuid4())
        session.execute(
            accounts.insert().values(
                id=account_id,
                company_id=str(company_id),
                employee_id=e["id"],
                entitlement_type_id=entitlement_type_id,
                fiscal_year=fiscal_year,
                opening_balance=prorated,
                accruals=prorated,
                used_amount=0,
                adjustments=0,
                carry_over=0,
                forfeited=0,
                current_balance=prorated,
                status="open",
                effective_from=year_start,
                effective_to=date(9999, 12, 31),
                is_current=True,
                version=1,
                created_at=now,
                updated_at=now,
                created_by=run_by,
                updated_by=run_by,
                deleted_at=None,
            )
        )
        session.execute(
            txns.insert().values(
                id=str(uuid4()),
                company_id=str(company_id),
                account_id=account_id,
                employee_id=e["id"],
                txn_type="ACCRUAL",
                amount=prorated,
                source="ANNUAL_RUN",
                effective_from=year_start,
                is_approved=True,
                is_exported=False,
                notes="Annual accrual (rules or entitlement_rates)",
                created_at=now,
                created_by=run_by,
            )
        )
        rows_processed += 1
        total += prorated
    session.flush()
    return {
        "rows_processed": rows_processed,
        "total_amount_accrued": total,
        "rate_backed_rows": rate_backed,
        "status": "SUCCESS",
        "errors": None,
    }


def try_mssql_accrue(
    session: Session,
    *,
    company_id: UUID,
    fiscal_year: int,
    entitlement_type_id: str,
    run_by: str,
) -> dict[str, Any] | None:
    bind = session.get_bind()
    if bind is None or bind.dialect.name != "mssql":
        return None
    try:
        result = session.execute(
            text(
                """
                DECLARE @rows INT, @total DECIMAL(18,4);
                EXEC airfare.sp_Entitlement_AccrueAnnual
                    @CompanyID=:company_id,
                    @FiscalYear=:fiscal_year,
                    @EntitlementTypeID=:type_id,
                    @RunBy=:run_by,
                    @RowsProcessed=@rows OUTPUT,
                    @TotalAmountAccrued=@total OUTPUT;
                SELECT @rows AS rows_processed, @total AS total_amount_accrued;
                """
            ),
            {
                "company_id": str(company_id),
                "fiscal_year": fiscal_year,
                "type_id": entitlement_type_id,
                "run_by": run_by,
            },
        )
        row = result.mappings().first()
        if not row:
            return None
        return {
            "rows_processed": int(row["rows_processed"] or 0),
            "total_amount_accrued": Decimal(str(row["total_amount_accrued"] or 0)),
            "status": "SUCCESS",
            "errors": None,
        }
    except Exception:
        return None


def period_end_python(
    session: Session,
    *,
    company_id: UUID,
    fiscal_year: int,
    entitlement_type_id: str,
    run_by: str,
    carry_over_max: Decimal = Decimal("999999"),
) -> dict[str, Any]:
    accounts = _table(session, "entitlement_accounts")
    txns = _table(session, "entitlement_transactions")
    period = _table(session, "entitlement_period_end")
    now = _now()
    next_year = fiscal_year + 1
    next_start = date(next_year, 1, 1)
    closed = 0
    carried = Decimal("0")
    forfeited = Decimal("0")
    seeded = 0

    open_rows = session.execute(
        select(accounts).where(
            accounts.c.company_id == str(company_id),
            accounts.c.fiscal_year == fiscal_year,
            accounts.c.entitlement_type_id == entitlement_type_id,
            accounts.c.status == "open",
            accounts.c.deleted_at.is_(None),
        )
    )
    for row in open_rows:
        a = row._mapping
        bal = _q2(Decimal(str(a["current_balance"])))
        carry = min(bal, carry_over_max) if bal > 0 else Decimal("0")
        forfeit = bal - carry if bal > carry_over_max else Decimal("0")
        session.execute(
            accounts.update()
            .where(accounts.c.id == a["id"])
            .values(
                carry_over=carry,
                forfeited=forfeit,
                current_balance=0,
                status="closed",
                updated_at=now,
                updated_by=run_by,
            )
        )
        if carry > 0:
            session.execute(
                txns.insert().values(
                    id=str(uuid4()),
                    company_id=str(company_id),
                    account_id=a["id"],
                    employee_id=a["employee_id"],
                    txn_type="CARRY_OVER",
                    amount=carry,
                    source="PERIOD_END",
                    effective_from=next_start,
                    is_approved=True,
                    is_exported=False,
                    notes="Period-end carry over",
                    created_at=now,
                    created_by=run_by,
                )
            )
        if forfeit > 0:
            session.execute(
                txns.insert().values(
                    id=str(uuid4()),
                    company_id=str(company_id),
                    account_id=a["id"],
                    employee_id=a["employee_id"],
                    txn_type="FORFEITURE",
                    amount=forfeit,
                    source="PERIOD_END",
                    effective_from=date(fiscal_year, 12, 31),
                    is_approved=True,
                    is_exported=False,
                    notes="Period-end forfeiture",
                    created_at=now,
                    created_by=run_by,
                )
            )
        if not get_account(
            session,
            company_id=company_id,
            employee_id=a["employee_id"],
            fiscal_year=next_year,
            entitlement_type_id=entitlement_type_id,
        ):
            session.execute(
                accounts.insert().values(
                    id=str(uuid4()),
                    company_id=str(company_id),
                    employee_id=a["employee_id"],
                    entitlement_type_id=entitlement_type_id,
                    fiscal_year=next_year,
                    opening_balance=carry,
                    accruals=0,
                    used_amount=0,
                    adjustments=0,
                    carry_over=0,
                    forfeited=0,
                    current_balance=carry,
                    status="open",
                    effective_from=next_start,
                    effective_to=date(9999, 12, 31),
                    is_current=True,
                    version=1,
                    created_at=now,
                    updated_at=now,
                    created_by=run_by,
                    updated_by=run_by,
                    deleted_at=None,
                )
            )
            seeded += 1
        closed += 1
        carried += carry
        forfeited += forfeit

    session.execute(
        period.insert().values(
            id=str(uuid4()),
            company_id=str(company_id),
            fiscal_year=fiscal_year,
            entitlement_type_id=entitlement_type_id,
            accounts_closed=closed,
            total_carried_over=carried,
            total_forfeited=forfeited,
            run_by=run_by,
            created_at=now,
        )
    )
    session.flush()
    return {
        "accounts_closed": closed,
        "total_carried_over": carried,
        "total_forfeited": forfeited,
        "next_fiscal_year_accounts_created": seeded,
        "status": "SUCCESS",
    }


def export_payroll(
    session: Session,
    *,
    company_id: UUID,
    fiscal_year: int,
    payroll_run_id: str,
    run_by: str,
) -> dict[str, Any]:
    txns = _table(session, "entitlement_transactions")
    log = _table(session, "payroll_integration_log")
    now = _now()
    rows = session.execute(
        select(txns).where(
            txns.c.company_id == str(company_id),
            txns.c.is_approved == True,  # noqa: E712
            txns.c.is_exported == False,  # noqa: E712
            txns.c.txn_type.in_(("ACCRUAL", "PAYOUT", "CARRY_OVER")),
        )
    )
    exported = 0
    total = Decimal("0")
    preview: list[dict[str, Any]] = []
    for row in rows:
        t = row._mapping
        # Filter by account fiscal year via account lookup
        acct = get_account_by_id(session, str(t["account_id"]))
        if not acct or int(acct["fiscal_year"]) != fiscal_year:
            continue
        session.execute(
            log.insert().values(
                id=str(uuid4()),
                company_id=str(company_id),
                payroll_run_id=payroll_run_id,
                fiscal_year=fiscal_year,
                transaction_id=t["id"],
                amount=t["amount"],
                exported_at=now,
                exported_by=run_by,
            )
        )
        session.execute(
            txns.update().where(txns.c.id == t["id"]).values(is_exported=True)
        )
        exported += 1
        total += Decimal(str(t["amount"]))
        preview.append(
            {
                "transaction_id": t["id"],
                "employee_id": str(t["employee_id"]),
                "txn_type": t["txn_type"],
                "amount": t["amount"],
            }
        )
    session.flush()
    return {
        "rows_exported": exported,
        "total_amount": _q2(total),
        "preview": preview,
        "status": "SUCCESS",
    }


def get_account_by_id(session: Session, account_id: str) -> dict[str, Any] | None:
    t = _table(session, "entitlement_accounts")
    row = session.execute(select(t).where(t.c.id == account_id)).first()
    return dict(row._mapping) if row else None
