"""ATLAS finance GL — double-entry COA for ticket issue and loan accounts.

Research (2026): ekmungai/python-accounting is the strongest IFRS/GAAP Python
library (~203★, easy API) but is **fully tested only on MySQL/Postgres/SQLite** —
not MSSQL. PyLedger / OpenLedger add AI MCP but ship as SQLite sidecars.
Django Ledger / Odoo are wrong stacks for this FastAPI + MSSQL app.

Final action: native MSSQL GL here, patterned on python-accounting (balanced
journals + COA + trial balance), wired into ticket/loan flows and AI Insights.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    MetaData,
    Numeric,
    String,
    Table,
    select,
)
from sqlalchemy.orm import Session

from airfare_management.domain.models import DomainError

TWOPLACES = Decimal("0.01")

DEFAULT_COA: tuple[tuple[str, str, str], ...] = (
    ("1000", "Cash / Bank", "ASSET"),
    ("1100", "Employee Ticket Receivable", "ASSET"),
    ("1200", "Employee Loan Receivable", "ASSET"),
    ("2100", "Airfare Entitlement Liability", "LIABILITY"),
    ("4000", "Airfare Ticket Expense", "EXPENSE"),
    ("5000", "Loan Interest Income", "REVENUE"),
)

CODE_CASH = "1000"
CODE_TICKET_RECV = "1100"
CODE_LOAN_RECV = "1200"
CODE_TICKET_EXPENSE = "4000"

_META = MetaData()

finance_accounts = Table(
    "finance_accounts",
    _META,
    Column("id", String(36), primary_key=True),
    Column("company_id", String(36), nullable=False),
    Column("code", String(20), nullable=False),
    Column("name", String(200), nullable=False),
    Column("account_type", String(20), nullable=False),
    Column("currency", String(3), nullable=False),
    Column("is_active", Boolean, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    Column("created_by", String(36)),
    Column("updated_by", String(36)),
    Column("deleted_at", DateTime(timezone=True)),
)

finance_journals = Table(
    "finance_journals",
    _META,
    Column("id", String(36), primary_key=True),
    Column("company_id", String(36), nullable=False),
    Column("entry_date", Date, nullable=False),
    Column("narration", String(500), nullable=False),
    Column("source_type", String(40), nullable=False),
    Column("source_id", String(36)),
    Column("employee_id", String(36)),
    Column("currency", String(3), nullable=False),
    Column("total_debit", Numeric(19, 4), nullable=False),
    Column("total_credit", Numeric(19, 4), nullable=False),
    Column("status", String(20), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    Column("created_by", String(36)),
    Column("updated_by", String(36)),
    Column("deleted_at", DateTime(timezone=True)),
)

finance_journal_lines = Table(
    "finance_journal_lines",
    _META,
    Column("id", String(36), primary_key=True),
    Column("journal_id", String(36), nullable=False),
    Column("account_id", String(36), nullable=False),
    Column("account_code", String(20), nullable=False),
    Column("debit", Numeric(19, 4), nullable=False),
    Column("credit", Numeric(19, 4), nullable=False),
    Column("memo", String(400), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)


def _q2(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def _now() -> datetime:
    return datetime.now(UTC)


def tables_ready(session: Session) -> bool:
    """Return True when finance GL tables exist (migration applied)."""
    try:
        from sqlalchemy import text

        session.connection().execute(text("SELECT 1 FROM finance_accounts WHERE 1=0"))
        return True
    except Exception:
        return False


def ensure_default_coa(
    session: Session, company_id: UUID | str, *, actor: str = "system"
) -> list[dict[str, Any]]:
    """Idempotently seed the default airfare/loan chart of accounts."""
    if not tables_ready(session):
        raise DomainError(
            "finance_gl_missing",
            "Finance GL tables are missing. Run Alembic revision 0015_finance_gl.",
        )
    from sqlalchemy import text

    cid = str(company_id)
    now_s = _now().strftime("%Y-%m-%d %H:%M:%S")
    conn = session.connection()
    existing_codes = {
        str(code)
        for (code,) in conn.execute(
            text(
                "SELECT code FROM finance_accounts "
                "WHERE company_id = :cid AND deleted_at IS NULL"
            ),
            {"cid": cid},
        )
    }
    for code, name, account_type in DEFAULT_COA:
        if code in existing_codes:
            continue
        result = conn.execute(
            text(
                "INSERT INTO finance_accounts "
                "(id, company_id, code, name, account_type, currency, is_active, "
                "created_at, updated_at, created_by, updated_by, deleted_at) "
                "VALUES (:id, :company_id, :code, :name, :account_type, :currency, "
                ":is_active, :created_at, :updated_at, :created_by, :updated_by, NULL)"
            ),
            {
                "id": str(uuid4()),
                "company_id": cid,
                "code": code,
                "name": name,
                "account_type": account_type,
                "currency": "BHD",
                "is_active": 1,
                "created_at": now_s,
                "updated_at": now_s,
                "created_by": actor,
                "updated_by": actor,
            },
        )
        if result.rowcount != 1:
            raise DomainError("finance_coa_seed_failed", f"Failed to seed account {code}.")
        existing_codes.add(code)
    session.flush()
    return list_accounts(session, company_id)


def list_accounts(session: Session, company_id: UUID | str | None = None) -> list[dict[str, Any]]:
    if not tables_ready(session):
        return []
    from sqlalchemy import text

    if company_id is None:
        rows = session.execute(
            text(
                "SELECT id, company_id, code, name, account_type, currency, is_active "
                "FROM finance_accounts WHERE deleted_at IS NULL ORDER BY code"
            )
        )
    else:
        rows = session.execute(
            text(
                "SELECT id, company_id, code, name, account_type, currency, is_active "
                "FROM finance_accounts WHERE deleted_at IS NULL AND company_id = :cid "
                "ORDER BY code"
            ),
            {"cid": str(company_id)},
        )
    return [dict(r._mapping) for r in rows]


def _account_by_code(session: Session, company_id: str, code: str) -> dict[str, Any]:
    from sqlalchemy import text

    row = session.execute(
        text(
            "SELECT id, company_id, code, name, account_type FROM finance_accounts "
            "WHERE company_id = :cid AND code = :code AND deleted_at IS NULL"
        ),
        {"cid": company_id, "code": code},
    ).first()
    if row is None:
        raise DomainError("finance_account_missing", f"Account {code} is not seeded.")
    return dict(row._mapping)


def post_journal(
    session: Session,
    *,
    company_id: UUID | str,
    entry_date: date,
    narration: str,
    source_type: str,
    source_id: str | None,
    employee_id: str | None,
    lines: list[tuple[str, Decimal, Decimal, str]],
    actor: str = "system",
) -> dict[str, Any]:
    """Post a balanced journal. Each line is (account_code, debit, credit, memo)."""
    if not tables_ready(session):
        raise DomainError("finance_gl_missing", "Finance GL tables are missing.")
    cid = str(company_id)
    ensure_default_coa(session, cid, actor=actor)
    cleaned: list[tuple[str, Decimal, Decimal, str]] = []
    total_dr = Decimal("0")
    total_cr = Decimal("0")
    for code, debit, credit, memo in lines:
        d = _q2(Decimal(str(debit or 0)))
        c = _q2(Decimal(str(credit or 0)))
        if d < 0 or c < 0:
            raise DomainError("invalid_journal_line", "Debit/credit cannot be negative.")
        if d == 0 and c == 0:
            continue
        if d > 0 and c > 0:
            raise DomainError("invalid_journal_line", "A line cannot have both debit and credit.")
        cleaned.append((code, d, c, memo))
        total_dr += d
        total_cr += c
    if not cleaned:
        raise DomainError("empty_journal", "Journal has no non-zero lines.")
    if total_dr != total_cr:
        raise DomainError(
            "unbalanced_journal",
            f"Journal unbalanced: debit {total_dr} != credit {total_cr}.",
        )

    now = _now().replace(tzinfo=None)
    journal_id = str(uuid4())
    journal = {
        "id": journal_id,
        "company_id": cid,
        "entry_date": entry_date,
        "narration": narration[:500],
        "source_type": source_type[:40],
        "source_id": source_id,
        "employee_id": employee_id,
        "currency": "BHD",
        "total_debit": total_dr,
        "total_credit": total_cr,
        "status": "posted",
        "created_at": now,
        "updated_at": now,
        "created_by": actor,
        "updated_by": actor,
        "deleted_at": None,
    }
    session.execute(finance_journals.insert().values(**journal))
    for code, debit, credit, memo in cleaned:
        account = _account_by_code(session, cid, code)
        session.execute(
            finance_journal_lines.insert().values(
                id=str(uuid4()),
                journal_id=journal_id,
                account_id=account["id"],
                account_code=code,
                debit=debit,
                credit=credit,
                memo=(memo or "")[:400],
                created_at=now,
            )
        )
    session.flush()
    return {
        **journal,
        "lines": [
            {"account_code": c, "debit": d, "credit": cr, "memo": m} for c, d, cr, m in cleaned
        ],
    }


def post_ticket_issue(
    session: Session,
    *,
    company_id: UUID | str,
    employee_id: UUID | str,
    ticket_id: str,
    entry_date: date,
    company_payout: Decimal,
    loan_principal: Decimal | None,
    employee_payable: Decimal,
    ticket_cost: Decimal,
    excess_handling: str | None,
    actor: str = "system",
) -> dict[str, Any] | None:
    """Post GL for a ticket issue. Returns None when amounts are all zero."""
    payout = _q2(Decimal(str(company_payout or 0)))
    loan = _q2(Decimal(str(loan_principal or 0)))
    receivable = _q2(Decimal(str(employee_payable or 0)))
    handling = (excess_handling or "").upper()
    if "SELF" in handling or handling in {"SELF_PAID", "ENTITLEMENT_AMOUNT"}:
        receivable = Decimal("0.00")
    if "LOAN" in handling or handling == "CONVERT_TO_LOAN":
        receivable = Decimal("0.00")
    if "COMPANY" in handling and "PAID" in handling:
        loan = Decimal("0.00")
        receivable = Decimal("0.00")
        payout = _q2(Decimal(str(ticket_cost or payout)))

    lines: list[tuple[str, Decimal, Decimal, str]] = []
    if payout > 0:
        lines.append((CODE_TICKET_EXPENSE, payout, Decimal("0"), "Company airfare payout"))
    if loan > 0:
        lines.append((CODE_LOAN_RECV, loan, Decimal("0"), "Employee loan receivable"))
    if receivable > 0:
        lines.append((CODE_TICKET_RECV, receivable, Decimal("0"), "Employee ticket receivable"))
    cash_out = payout + loan + receivable
    if cash_out <= 0:
        return None
    lines.append((CODE_CASH, Decimal("0"), cash_out, "Bank / cash settlement"))
    return post_journal(
        session,
        company_id=company_id,
        entry_date=entry_date,
        narration=f"Ticket issue {ticket_id}",
        source_type="ticket_issue",
        source_id=str(ticket_id),
        employee_id=str(employee_id),
        lines=lines,
        actor=actor,
    )


def post_loan_disbursement(
    session: Session,
    *,
    company_id: UUID | str,
    employee_id: UUID | str,
    loan_id: str,
    entry_date: date,
    principal: Decimal,
    actor: str = "system",
) -> dict[str, Any] | None:
    """Standalone loan (not ticket-sourced): Dr Loan Receivable / Cr Cash."""
    amount = _q2(Decimal(str(principal or 0)))
    if amount <= 0:
        return None
    return post_journal(
        session,
        company_id=company_id,
        entry_date=entry_date,
        narration=f"Loan disbursement {loan_id}",
        source_type="loan_disbursement",
        source_id=str(loan_id),
        employee_id=str(employee_id),
        lines=[
            (CODE_LOAN_RECV, amount, Decimal("0"), "Loan principal"),
            (CODE_CASH, Decimal("0"), amount, "Cash advanced"),
        ],
        actor=actor,
    )


def post_loan_recovery(
    session: Session,
    *,
    company_id: UUID | str,
    employee_id: UUID | str,
    loan_id: str,
    payment_id: str,
    entry_date: date,
    amount: Decimal,
    actor: str = "system",
) -> dict[str, Any] | None:
    """Loan recovery payment: Dr Cash / Cr Loan Receivable."""
    paid = _q2(Decimal(str(amount or 0)))
    if paid <= 0:
        return None
    return post_journal(
        session,
        company_id=company_id,
        entry_date=entry_date,
        narration=f"Loan recovery {loan_id} / {payment_id}",
        source_type="loan_recovery",
        source_id=str(payment_id),
        employee_id=str(employee_id),
        lines=[
            (CODE_CASH, paid, Decimal("0"), "Cash received"),
            (CODE_LOAN_RECV, Decimal("0"), paid, "Loan receivable reduction"),
        ],
        actor=actor,
    )


def trial_balance(
    session: Session, company_id: UUID | str, *, as_of: date | None = None
) -> dict[str, Any]:
    """Trial balance by account (debits / credits / net)."""
    empty = {
        "company_id": str(company_id),
        "as_of": (as_of or date.today()).isoformat(),
        "currency": "BHD",
        "balanced": True,
        "accounts": [],
        "total_debit": "0.00",
        "total_credit": "0.00",
        "engine": "atlas_native_mssql_gl",
        "pattern_source": "python-accounting (IFRS/GAAP library; MSSQL-native port)",
    }
    if not tables_ready(session):
        return empty
    cid = str(company_id)
    ensure_default_coa(session, cid)
    accounts = list_accounts(session, cid)
    stmt = (
        select(
            finance_journal_lines.c.account_code,
            finance_journal_lines.c.debit,
            finance_journal_lines.c.credit,
        )
        .select_from(
            finance_journal_lines.join(
                finance_journals,
                finance_journal_lines.c.journal_id == finance_journals.c.id,
            )
        )
        .where(
            finance_journals.c.company_id == cid,
            finance_journals.c.deleted_at.is_(None),
            finance_journals.c.status == "posted",
        )
    )
    if as_of is not None:
        stmt = stmt.where(finance_journals.c.entry_date <= as_of)
    totals: dict[str, dict[str, Decimal]] = {
        a["code"]: {"debit": Decimal("0"), "credit": Decimal("0")} for a in accounts
    }
    for row in session.execute(stmt):
        code = str(row.account_code)
        bucket = totals.setdefault(code, {"debit": Decimal("0"), "credit": Decimal("0")})
        bucket["debit"] += _q2(Decimal(str(row.debit or 0)))
        bucket["credit"] += _q2(Decimal(str(row.credit or 0)))
    by_code = {a["code"]: a for a in accounts}
    report_rows: list[dict[str, Any]] = []
    total_debit = Decimal("0")
    total_credit = Decimal("0")
    for code in sorted(totals):
        d = _q2(totals[code]["debit"])
        c = _q2(totals[code]["credit"])
        total_debit += d
        total_credit += c
        meta = by_code.get(code, {"name": code, "account_type": ""})
        report_rows.append(
            {
                "code": code,
                "name": meta.get("name"),
                "account_type": meta.get("account_type"),
                "debit": str(d),
                "credit": str(c),
                "net": str(_q2(d - c)),
            }
        )
    return {
        "company_id": cid,
        "as_of": (as_of or date.today()).isoformat(),
        "currency": "BHD",
        "balanced": total_debit == total_credit,
        "accounts": report_rows,
        "total_debit": str(_q2(total_debit)),
        "total_credit": str(_q2(total_credit)),
        "engine": "atlas_native_mssql_gl",
        "pattern_source": "python-accounting (IFRS/GAAP library; MSSQL-native port)",
    }


def ledger_report(
    session: Session,
    company_id: UUID | str,
    *,
    account_code: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    limit: int = 200,
) -> dict[str, Any]:
    """Account ledger lines + trial balance snapshot."""
    tb = trial_balance(session, company_id, as_of=to_date)
    if not tables_ready(session):
        return {**tb, "entries": []}
    cid = str(company_id)
    stmt = (
        select(
            finance_journals.c.entry_date,
            finance_journals.c.narration,
            finance_journals.c.source_type,
            finance_journals.c.source_id,
            finance_journals.c.employee_id,
            finance_journal_lines.c.account_code,
            finance_journal_lines.c.debit,
            finance_journal_lines.c.credit,
            finance_journal_lines.c.memo,
            finance_journals.c.id.label("journal_id"),
        )
        .select_from(
            finance_journal_lines.join(
                finance_journals,
                finance_journal_lines.c.journal_id == finance_journals.c.id,
            )
        )
        .where(
            finance_journals.c.company_id == cid,
            finance_journals.c.deleted_at.is_(None),
            finance_journals.c.status == "posted",
        )
        .order_by(finance_journals.c.entry_date.desc(), finance_journals.c.created_at.desc())
        .limit(max(1, min(limit, 1000)))
    )
    if account_code:
        stmt = stmt.where(finance_journal_lines.c.account_code == account_code)
    if from_date:
        stmt = stmt.where(finance_journals.c.entry_date >= from_date)
    if to_date:
        stmt = stmt.where(finance_journals.c.entry_date <= to_date)
    entries = [
        {
            "journal_id": r.journal_id,
            "entry_date": r.entry_date.isoformat()
            if hasattr(r.entry_date, "isoformat")
            else r.entry_date,
            "narration": r.narration,
            "source_type": r.source_type,
            "source_id": r.source_id,
            "employee_id": r.employee_id,
            "account_code": r.account_code,
            "debit": str(_q2(Decimal(str(r.debit or 0)))),
            "credit": str(_q2(Decimal(str(r.credit or 0)))),
            "memo": r.memo,
        }
        for r in session.execute(stmt)
    ]
    return {**tb, "entries": entries, "filter_account": account_code}


def journal_exists_for_source(
    session: Session, *, source_type: str, source_id: str
) -> bool:
    """True when a posted journal already exists for this business source."""
    if not tables_ready(session) or not source_id:
        return False
    row = session.execute(
        select(finance_journals.c.id)
        .where(
            finance_journals.c.source_type == source_type,
            finance_journals.c.source_id == str(source_id),
            finance_journals.c.deleted_at.is_(None),
        )
        .limit(1)
    ).first()
    return row is not None


def backfill_from_operations(
    session: Session,
    company_id: UUID | str,
    *,
    actor: str = "system",
    limit: int = 200,
) -> dict[str, Any]:
    """Post missing GL journals for existing tickets, loans, and loan payments.

    Matches python-accounting workflow: post transactions first, then trial balance
    / ledger reports show non-zero balances.
    """
    from airfare_management.infrastructure.database import EmployeeRow
    from airfare_management.infrastructure.schema import LoanPaymentRow, LoanRow, TicketRow

    cid = str(company_id)
    ensure_default_coa(session, cid, actor=actor)
    posted_tickets = 0
    skipped_tickets = 0
    posted_loans = 0
    skipped_loans = 0
    posted_payments = 0
    skipped_payments = 0
    errors: list[str] = []

    tickets = session.scalars(
        select(TicketRow)
        .where(TicketRow.deleted_at.is_(None), TicketRow.status.in_(("approved", "issued", "paid")))
        .order_by(TicketRow.travel_date.desc())
        .limit(limit)
    ).all()
    # If status filter too strict, also include common live statuses
    if not tickets:
        tickets = session.scalars(
            select(TicketRow)
            .where(TicketRow.deleted_at.is_(None))
            .order_by(TicketRow.travel_date.desc())
            .limit(limit)
        ).all()

    for ticket in tickets:
        if journal_exists_for_source(session, source_type="ticket_issue", source_id=ticket.id):
            skipped_tickets += 1
            continue
        emp = session.get(EmployeeRow, ticket.employee_id)
        if emp is None or str(emp.company_id) != cid:
            skipped_tickets += 1
            continue
        loan = session.scalar(
            select(LoanRow).where(
                LoanRow.source_ticket_id == ticket.id,
                LoanRow.deleted_at.is_(None),
            )
        )
        loan_principal = loan.principal if loan is not None else None
        try:
            with session.begin_nested():
                result = post_ticket_issue(
                    session,
                    company_id=cid,
                    employee_id=ticket.employee_id,
                    ticket_id=ticket.id,
                    entry_date=ticket.as_of_date or ticket.travel_date,
                    company_payout=ticket.company_payout or ticket.company_paid,
                    loan_principal=loan_principal,
                    employee_payable=ticket.employee_payable,
                    ticket_cost=ticket.ticket_cost,
                    excess_handling=ticket.excess_handling,
                    actor=actor,
                )
            if result:
                posted_tickets += 1
            else:
                skipped_tickets += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"ticket {ticket.id}: {exc}")

    loans = session.scalars(
        select(LoanRow)
        .where(LoanRow.deleted_at.is_(None), LoanRow.source_ticket_id.is_(None))
        .order_by(LoanRow.first_due_date.desc())
        .limit(limit)
    ).all()
    for loan in loans:
        if journal_exists_for_source(session, source_type="loan_disbursement", source_id=loan.id):
            skipped_loans += 1
            continue
        emp = session.get(EmployeeRow, loan.employee_id)
        if emp is None or str(emp.company_id) != cid:
            skipped_loans += 1
            continue
        try:
            with session.begin_nested():
                result = post_loan_disbursement(
                    session,
                    company_id=cid,
                    employee_id=loan.employee_id,
                    loan_id=loan.id,
                    entry_date=loan.first_due_date,
                    principal=loan.principal,
                    actor=actor,
                )
            if result:
                posted_loans += 1
            else:
                skipped_loans += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"loan {loan.id}: {exc}")

    payments = session.scalars(
        select(LoanPaymentRow)
        .where(LoanPaymentRow.deleted_at.is_(None))
        .order_by(LoanPaymentRow.paid_on.desc())
        .limit(limit)
    ).all()
    for payment in payments:
        if journal_exists_for_source(session, source_type="loan_recovery", source_id=payment.id):
            skipped_payments += 1
            continue
        loan = session.get(LoanRow, payment.loan_id)
        if loan is None:
            skipped_payments += 1
            continue
        emp = session.get(EmployeeRow, loan.employee_id)
        if emp is None or str(emp.company_id) != cid:
            skipped_payments += 1
            continue
        try:
            with session.begin_nested():
                result = post_loan_recovery(
                    session,
                    company_id=cid,
                    employee_id=loan.employee_id,
                    loan_id=loan.id,
                    payment_id=payment.id,
                    entry_date=payment.paid_on,
                    amount=payment.amount,
                    actor=actor,
                )
            if result:
                posted_payments += 1
            else:
                skipped_payments += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"payment {payment.id}: {exc}")

    tb = trial_balance(session, cid)
    return {
        "company_id": cid,
        "posted_tickets": posted_tickets,
        "skipped_tickets": skipped_tickets,
        "posted_loans": posted_loans,
        "skipped_loans": skipped_loans,
        "posted_payments": posted_payments,
        "skipped_payments": skipped_payments,
        "errors": errors[:20],
        "trial_balance": {
            "balanced": tb.get("balanced"),
            "total_debit": tb.get("total_debit"),
            "total_credit": tb.get("total_credit"),
        },
    }


def safe_post(session: Session, fn: Any, **kwargs: Any) -> dict[str, Any] | None:
    """Post inside a nested transaction so GL failures never abort ticket/loan saves."""
    if not tables_ready(session):
        return None
    try:
        with session.begin_nested():
            return fn(session, **kwargs)
    except Exception:
        return None


def build_ledger_export_xlsx(report: dict[str, Any]) -> bytes:
    """Focus-style Excel: Trial Balance sheet + Journal Lines sheet."""
    from io import BytesIO

    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    workbook = Workbook()
    header_fill = PatternFill("solid", fgColor="1F4E78")
    header_font = Font(bold=True, color="FFFFFF")

    tb = workbook.active
    assert tb is not None
    tb.title = "Trial Balance"
    tb.append(["Finance Ledger — Trial Balance (BHD)"])
    tb.append(
        [
            f"As of {report.get('as_of')}",
            f"Balanced={report.get('balanced')}",
            f"Total Debit={report.get('total_debit')}",
            f"Total Credit={report.get('total_credit')}",
        ]
    )
    tb.append([])
    tb_cols = ["code", "name", "account_type", "debit", "credit", "net"]
    tb.append(tb_cols)
    for cell in tb[4]:
        cell.font = header_font
        cell.fill = header_fill
    for account in report.get("accounts") or []:
        tb.append([account.get(c, "") for c in tb_cols])
    tb.freeze_panes = "A5"

    jl = workbook.create_sheet("Journal Lines")
    jl_cols = [
        "entry_date",
        "account_code",
        "source_type",
        "source_id",
        "narration",
        "memo",
        "debit",
        "credit",
    ]
    jl.append(jl_cols)
    for cell in jl[1]:
        cell.font = header_font
        cell.fill = header_fill
    for entry in report.get("entries") or []:
        jl.append([entry.get(c, "") for c in jl_cols])
    jl.freeze_panes = "A2"
    if jl.dimensions:
        jl.auto_filter.ref = jl.dimensions

    for sheet in (tb, jl):
        for column_number, column_cells in enumerate(sheet.columns, start=1):
            width = min(
                50,
                max(12, *(len(str(cell.value or "")) + 2 for cell in column_cells)),
            )
            sheet.column_dimensions[get_column_letter(column_number)].width = width

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def build_ledger_export_pdf(report: dict[str, Any], *, company_name: str = "Atlas Aluminum") -> bytes:
    """Focus-style printable PDF: trial balance summary + journal lines."""
    from airfare_management.infrastructure.documents import build_pdf_report

    columns = [
        "Date",
        "Account",
        "Source",
        "Narration",
        "Debit",
        "Credit",
    ]
    rows: list[list[Any]] = [
        [
            "TRIAL BALANCE",
            f"As of {report.get('as_of')}",
            f"Balanced={report.get('balanced')}",
            f"Currency {report.get('currency', 'BHD')}",
            str(report.get("total_debit") or "0"),
            str(report.get("total_credit") or "0"),
        ]
    ]
    for account in report.get("accounts") or []:
        rows.append(
            [
                "",
                f"{account.get('code')} {account.get('name')}",
                str(account.get("account_type") or ""),
                "account balance",
                str(account.get("debit") or "0"),
                str(account.get("credit") or "0"),
            ]
        )
    rows.append(["", "", "", "— Journal lines —", "", ""])
    entries = report.get("entries") or []
    if not entries:
        rows.append(["", "", "", "No journal lines", "0", "0"])
    for entry in entries:
        rows.append(
            [
                entry.get("entry_date") or "",
                entry.get("account_code") or "",
                entry.get("source_type") or "",
                (entry.get("narration") or "")[:80],
                entry.get("debit") or "0",
                entry.get("credit") or "0",
            ]
        )
    return build_pdf_report(
        "Finance Ledger Report",
        columns,
        rows,
        company_name=company_name,
    )
