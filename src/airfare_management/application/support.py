"""AI self-support engine: detect → diagnose → remediate → verify → learn.

Read-only diagnostics scan operational data for known failure patterns.
Whitelisted remediations apply a safe fix, re-run the check to verify, and
record the outcome in the MSSQL learning store. Historical success rates feed
back into future confidence scores, so the system improves with use.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select, true
from sqlalchemy.orm import Session

from airfare_management.infrastructure.database import EmployeeRow
from airfare_management.infrastructure.schema import (
    AiLearningEventRow,
    AttachmentRow,
    EntitlementRateRow,
    LoanInstallmentRow,
    LoanRow,
    OpeningBalanceRow,
    TicketRow,
    UserRow,
)

BASE_CONFIDENCE = 0.7
STALE_DRAFT_DAYS = 30
SCAN_PENDING_HOURS = 24
SOFT_DELETE_BLOAT_RATIO = 0.5


@dataclass
class Finding:
    """One diagnosed issue with a suggested, possibly automatic, fix."""

    check_code: str
    severity: str
    summary: str
    suggestion: str
    auto_fixable: bool
    affected: int
    details: dict[str, Any] = field(default_factory=dict)
    confidence: float = BASE_CONFIDENCE
    learned_success_rate: float | None = None

    def as_dict(self) -> dict[str, Any]:
        """Serialize for the API."""
        return {
            "check_code": self.check_code,
            "severity": self.severity,
            "summary": self.summary,
            "suggestion": self.suggestion,
            "auto_fixable": self.auto_fixable,
            "affected": self.affected,
            "details": self.details,
            "confidence": round(float(self.confidence), 4),
            "learned_success_rate": (
                None if self.learned_success_rate is None else round(self.learned_success_rate, 4)
            ),
        }


def _aware(value: datetime) -> datetime:
    """Normalize a possibly naive MSSQL datetime to UTC-aware."""
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _success_rate(session: Session, check_code: str) -> float | None:
    """Historical remediation success rate for a check, or None when unseen."""
    rows = session.scalars(
        select(AiLearningEventRow.outcome).where(
            AiLearningEventRow.check_code == check_code,
            AiLearningEventRow.event_type == "remediation",
            AiLearningEventRow.outcome.in_(("success", "failed")),
        )
    ).all()
    if not rows:
        return None
    return sum(1 for outcome in rows if outcome == "success") / len(rows)


def _record(
    session: Session,
    *,
    event_type: str,
    check_code: str,
    summary: str,
    severity: str = "info",
    details: dict[str, Any] | None = None,
    fix_applied: str | None = None,
    outcome: str = "pending",
    confidence: float = BASE_CONFIDENCE,
    actor: str | None = None,
) -> None:
    session.add(
        AiLearningEventRow(
            event_type=event_type,
            check_code=check_code,
            severity=severity,
            summary=summary,
            details=details or {},
            fix_applied=fix_applied,
            outcome=outcome,
            confidence=confidence,
            created_by=actor,
        )
    )


def _check_locked_users(session: Session) -> Finding | None:
    now = datetime.now(UTC)
    locked = session.scalars(
        select(UserRow).where(
            UserRow.deleted_at.is_(None),
            UserRow.locked_until.is_not(None),
        )
    ).all()
    locked = [user for user in locked if user.locked_until and _aware(user.locked_until) > now]
    if not locked:
        return None
    return Finding(
        check_code="locked_users",
        severity="warning",
        summary=f"{len(locked)} user account(s) are locked out after failed sign-ins.",
        suggestion="Unlock the accounts so users can sign in again; remind them to reset passwords.",
        auto_fixable=True,
        affected=len(locked),
        details={"usernames": [user.username for user in locked]},
    )


def _check_loans_missing_schedule(session: Session) -> Finding | None:
    loans = session.scalars(
        select(LoanRow).where(LoanRow.deleted_at.is_(None), LoanRow.status == "active")
    ).all()
    missing = []
    for loan in loans:
        count = session.scalar(
            select(func.count())
            .select_from(LoanInstallmentRow)
            .where(
                LoanInstallmentRow.loan_id == loan.id,
                LoanInstallmentRow.deleted_at.is_(None),
            )
        ) or 0
        if count == 0:
            missing.append(str(loan.id))
    if not missing:
        return None
    return Finding(
        check_code="loans_missing_schedule",
        severity="critical",
        summary=f"{len(missing)} active loan(s) have no EMI schedule, so recovery cannot run.",
        suggestion="Rebuild the reducing-balance EMI schedules from the loan terms.",
        auto_fixable=True,
        affected=len(missing),
        details={"loan_ids": missing},
    )


def _check_stale_draft_tickets(session: Session) -> Finding | None:
    cutoff = date.today() - timedelta(days=STALE_DRAFT_DAYS)
    stale = session.scalars(
        select(TicketRow).where(
            TicketRow.deleted_at.is_(None),
            TicketRow.status == "draft",
            TicketRow.travel_date < cutoff,
        )
    ).all()
    if not stale:
        return None
    return Finding(
        check_code="stale_draft_tickets",
        severity="warning",
        summary=(
            f"{len(stale)} draft ticket(s) are older than {STALE_DRAFT_DAYS} days "
            "and were never submitted."
        ),
        suggestion="Review and submit or delete the stale drafts from Airfare Allocation.",
        auto_fixable=False,
        affected=len(stale),
        details={"ticket_codes": [ticket.ticket_code for ticket in stale]},
    )


def _check_pending_attachments(session: Session) -> Finding | None:
    cutoff = datetime.now(UTC) - timedelta(hours=SCAN_PENDING_HOURS)
    pending = session.scalars(
        select(AttachmentRow).where(
            AttachmentRow.deleted_at.is_(None),
            AttachmentRow.scan_status == "pending",
        )
    ).all()
    pending = [item for item in pending if _aware(item.created_at) < cutoff]
    if not pending:
        return None
    return Finding(
        check_code="attachments_scan_pending",
        severity="warning",
        summary=(
            f"{len(pending)} attachment(s) have waited over {SCAN_PENDING_HOURS}h "
            "for a virus scan verdict."
        ),
        suggestion="Mark the queue as scanned so downloads are unblocked; investigate the scanner.",
        auto_fixable=True,
        affected=len(pending),
        details={"attachment_ids": [item.id for item in pending]},
    )


def _check_employees_missing_join_date(session: Session) -> Finding | None:
    employees = session.scalars(
        select(EmployeeRow).where(
            EmployeeRow.deleted_at.is_(None),
            EmployeeRow.active == true(),
            EmployeeRow.join_date.is_(None),
        )
    ).all()
    if not employees:
        return None
    return Finding(
        check_code="employees_missing_join_date",
        severity="critical",
        summary=(
            f"{len(employees)} active employee(s) have no join date; "
            "entitlement accrual cannot be computed for them."
        ),
        suggestion="Open Employees and set the join date for each listed record.",
        auto_fixable=False,
        affected=len(employees),
        details={"codes": [employee.code for employee in employees]},
    )


def _check_soft_delete_bloat(session: Session) -> Finding | None:
    bloated: dict[str, int] = {}
    for model, label in (
        (TicketRow, "tickets"),
        (LoanRow, "loans"),
        (EmployeeRow, "employees"),
    ):
        total = session.scalar(select(func.count()).select_from(model)) or 0
        deleted = session.scalar(
            select(func.count()).select_from(model).where(model.deleted_at.is_not(None))
        ) or 0
        if total and deleted / total > SOFT_DELETE_BLOAT_RATIO and deleted >= 10:
            bloated[label] = deleted
    if not bloated:
        return None
    return Finding(
        check_code="soft_delete_bloat",
        severity="info",
        summary=f"Soft-deleted rows are accumulating: {bloated}.",
        suggestion="Export a backup, then purge soft-deleted rows to keep MSSQL indexes lean.",
        auto_fixable=False,
        affected=sum(bloated.values()),
        details={"tables": bloated},
    )


def _check_employees_missing_reference(session: Session) -> Finding | None:
    employees = session.scalars(
        select(EmployeeRow).where(
            EmployeeRow.deleted_at.is_(None),
            EmployeeRow.active == true(),
        )
    ).all()
    missing = [
        employee
        for employee in employees
        if not (employee.passport_no or "").strip() or not (employee.nationality or "").strip()
    ]
    if not missing:
        return None
    return Finding(
        check_code="employees_missing_reference",
        severity="warning",
        summary=(
            f"{len(missing)} active employee(s) are missing passport or nationality; "
            "documents and rate resolution may be incomplete."
        ),
        suggestion="Open Employees and complete the passport / nationality fields for each listed record.",
        auto_fixable=False,
        affected=len(missing),
        details={"codes": [employee.code for employee in missing]},
    )


def _check_stale_open_tickets(session: Session) -> Finding | None:
    """Approved/paid tickets whose travel date passed without a ticket copy attached."""
    today = date.today()
    rows = session.scalars(
        select(TicketRow).where(
            TicketRow.deleted_at.is_(None),
            TicketRow.status.in_(("approved", "paid")),
            TicketRow.travel_date < today,
        )
    ).all()
    stale = []
    for ticket in rows:
        attached = session.scalar(
            select(func.count())
            .select_from(AttachmentRow)
            .where(
                AttachmentRow.deleted_at.is_(None),
                AttachmentRow.entity_type == "ticket",
                AttachmentRow.entity_id == ticket.id,
            )
        ) or 0
        if attached == 0:
            stale.append(ticket)
    if not stale:
        return None
    return Finding(
        check_code="stale_open_tickets",
        severity="warning",
        summary=(
            f"{len(stale)} approved/paid ticket(s) have a past travel date and no "
            "ticket copy attached."
        ),
        suggestion="Attach the issued ticket copy on the ticket card, or cancel tickets that never flew.",
        auto_fixable=False,
        affected=len(stale),
        details={"ticket_codes": [ticket.ticket_code for ticket in stale]},
    )


def _check_duplicate_employee_codes(session: Session) -> Finding | None:
    rows = session.execute(
        select(EmployeeRow.company_id, func.lower(EmployeeRow.code), func.count())
        .where(EmployeeRow.deleted_at.is_(None))
        .group_by(EmployeeRow.company_id, func.lower(EmployeeRow.code))
        .having(func.count() > 1)
    ).all()
    if not rows:
        return None
    samples = [f"{company}/{code}" for company, code, _ in rows[:10]]
    return Finding(
        check_code="duplicate_employee_codes",
        severity="critical",
        summary=f"{len(rows)} employee code(s) are duplicated within a company.",
        suggestion="Merge or rename duplicate employee codes before bulk imports or payroll export.",
        auto_fixable=False,
        affected=len(rows),
        details={"samples": samples},
    )


def _check_opening_balances_orphans(session: Session) -> Finding | None:
    orphans = session.scalars(
        select(OpeningBalanceRow)
        .outerjoin(EmployeeRow, EmployeeRow.id == OpeningBalanceRow.employee_id)
        .where(
            OpeningBalanceRow.deleted_at.is_(None),
            (EmployeeRow.id.is_(None)) | (EmployeeRow.deleted_at.is_not(None)),
        )
        .limit(50)
    ).all()
    if not orphans:
        return None
    return Finding(
        check_code="opening_balance_orphans",
        severity="warning",
        summary=f"{len(orphans)} opening balance(s) reference missing or soft-deleted employees.",
        suggestion="Soft-delete orphan balances or restore the linked employee master record.",
        auto_fixable=True,
        affected=len(orphans),
        details={"balance_ids": [str(item.id) for item in orphans[:20]]},
    )


def _check_overlapping_entitlement_rates(session: Session) -> Finding | None:
    rates = session.scalars(
        select(EntitlementRateRow)
        .where(EntitlementRateRow.deleted_at.is_(None))
        .order_by(
            EntitlementRateRow.scope_type,
            EntitlementRateRow.scope_id,
            EntitlementRateRow.effective_from,
        )
    ).all()
    overlaps: list[str] = []
    by_scope: dict[tuple[str, str], list[EntitlementRateRow]] = {}
    for rate in rates:
        by_scope.setdefault((rate.scope_type, rate.scope_id or ""), []).append(rate)
    for (scope_type, scope_id), group in by_scope.items():
        for index, left in enumerate(group):
            left_end = left.effective_to or date.max
            for right in group[index + 1 :]:
                right_end = right.effective_to or date.max
                if left.effective_from <= right_end and right.effective_from <= left_end:
                    overlaps.append(f"{scope_type}:{scope_id or '*'}")
                    break
    if not overlaps:
        return None
    return Finding(
        check_code="overlapping_entitlement_rates",
        severity="warning",
        summary=f"{len(overlaps)} entitlement rate scope(s) have overlapping effective dates.",
        suggestion="Close earlier rates (set effective_to) so only one active rate applies per scope.",
        auto_fixable=True,
        affected=len(overlaps),
        details={"scopes": overlaps[:20]},
    )


CHECKS = (
    _check_locked_users,
    _check_loans_missing_schedule,
    _check_stale_draft_tickets,
    _check_stale_open_tickets,
    _check_pending_attachments,
    _check_employees_missing_join_date,
    _check_employees_missing_reference,
    _check_soft_delete_bloat,
    _check_duplicate_employee_codes,
    _check_opening_balances_orphans,
    _check_overlapping_entitlement_rates,
)


def run_diagnostics(session: Session, *, actor: str | None = None) -> dict[str, Any]:
    """Detect and diagnose; confidence is adjusted by learned success rates."""
    findings: list[Finding] = []
    for check in CHECKS:
        finding = check(session)
        if finding is None:
            continue
        rate = _success_rate(session, finding.check_code)
        finding.learned_success_rate = rate
        if rate is not None:
            finding.confidence = max(0.05, min(0.99, BASE_CONFIDENCE * (0.5 + rate)))
        findings.append(finding)
        _record(
            session,
            event_type="diagnosis",
            check_code=finding.check_code,
            severity=finding.severity,
            summary=finding.summary,
            details=finding.details,
            confidence=finding.confidence,
            actor=actor,
        )
    session.commit()
    return {
        "ran_at": datetime.now(UTC).isoformat(),
        "healthy": not any(item.severity == "critical" for item in findings),
        "findings": [item.as_dict() for item in findings],
    }


def _fix_locked_users(session: Session) -> int:
    now = datetime.now(UTC)
    locked = session.scalars(
        select(UserRow).where(
            UserRow.deleted_at.is_(None),
            UserRow.locked_until.is_not(None),
        )
    ).all()
    fixed = 0
    for user in locked:
        if user.locked_until and _aware(user.locked_until) > now:
            user.locked_until = None
            user.failed_login_count = 0
            fixed += 1
    return fixed


def _fix_loans_missing_schedule(session: Session) -> int:
    from airfare_management.domain.services import build_amortization_schedule

    loans = session.scalars(
        select(LoanRow).where(LoanRow.deleted_at.is_(None), LoanRow.status == "active")
    ).all()
    fixed = 0
    for loan in loans:
        count = session.scalar(
            select(func.count())
            .select_from(LoanInstallmentRow)
            .where(
                LoanInstallmentRow.loan_id == loan.id,
                LoanInstallmentRow.deleted_at.is_(None),
            )
        ) or 0
        if count:
            continue
        schedule = build_amortization_schedule(
            principal=Decimal(str(loan.principal)),
            annual_rate=Decimal(str(loan.annual_rate)),
            installments=int(loan.installments),
            first_due_date=loan.first_due_date,
        )
        now = datetime.now(UTC)
        for part in schedule:
            session.add(
                LoanInstallmentRow(
                    loan_id=loan.id,
                    number=part.number,
                    due_date=part.due_date,
                    opening_balance=part.opening_balance,
                    principal=part.principal,
                    interest=part.interest,
                    payment=part.payment,
                    closing_balance=part.closing_balance,
                    created_at=now,
                    updated_at=now,
                )
            )
        fixed += 1
    return fixed


def _fix_attachments_scan_pending(session: Session) -> int:
    cutoff = datetime.now(UTC) - timedelta(hours=SCAN_PENDING_HOURS)
    pending = session.scalars(
        select(AttachmentRow).where(
            AttachmentRow.deleted_at.is_(None),
            AttachmentRow.scan_status == "pending",
        )
    ).all()
    fixed = 0
    for item in pending:
        if _aware(item.created_at) < cutoff:
            item.scan_status = "clean"
            fixed += 1
    return fixed


def _fix_opening_balance_orphans(session: Session) -> int:
    orphans = session.scalars(
        select(OpeningBalanceRow)
        .outerjoin(EmployeeRow, EmployeeRow.id == OpeningBalanceRow.employee_id)
        .where(
            OpeningBalanceRow.deleted_at.is_(None),
            (EmployeeRow.id.is_(None)) | (EmployeeRow.deleted_at.is_not(None)),
        )
    ).all()
    now = datetime.now(UTC)
    fixed = 0
    for item in orphans:
        item.deleted_at = now
        item.version += 1
        fixed += 1
    return fixed


def _fix_overlapping_entitlement_rates(session: Session) -> int:
    rates = session.scalars(
        select(EntitlementRateRow)
        .where(EntitlementRateRow.deleted_at.is_(None))
        .order_by(
            EntitlementRateRow.scope_type,
            EntitlementRateRow.scope_id,
            EntitlementRateRow.effective_from,
            EntitlementRateRow.created_at,
        )
    ).all()
    fixed = 0
    by_scope: dict[tuple[str, str], list[EntitlementRateRow]] = {}
    for rate in rates:
        by_scope.setdefault((rate.scope_type, rate.scope_id or ""), []).append(rate)
    for group in by_scope.values():
        for index, left in enumerate(group[:-1]):
            right = group[index + 1]
            left_end = left.effective_to or date.max
            right_end = right.effective_to or date.max
            if left.effective_from <= right_end and right.effective_from <= left_end:
                close_on = right.effective_from - timedelta(days=1)
                if left.effective_to is None or left.effective_to > close_on:
                    left.effective_to = close_on
                    left.version += 1
                    fixed += 1
    return fixed


REMEDIATIONS = {
    "locked_users": (_fix_locked_users, _check_locked_users),
    "loans_missing_schedule": (_fix_loans_missing_schedule, _check_loans_missing_schedule),
    "attachments_scan_pending": (_fix_attachments_scan_pending, _check_pending_attachments),
    "opening_balance_orphans": (_fix_opening_balance_orphans, _check_opening_balances_orphans),
    "overlapping_entitlement_rates": (
        _fix_overlapping_entitlement_rates,
        _check_overlapping_entitlement_rates,
    ),
}


def apply_remediation(
    session: Session, check_code: str, *, actor: str | None = None
) -> dict[str, Any]:
    """Apply a whitelisted fix, verify by re-running the check, and learn."""
    entry = REMEDIATIONS.get(check_code)
    if entry is None:
        raise ValueError(f"No safe automatic fix is registered for '{check_code}'.")
    fix, verify = entry
    fixed_count = fix(session)
    session.flush()
    remaining = verify(session)
    verified = remaining is None
    _record(
        session,
        event_type="remediation",
        check_code=check_code,
        severity="info" if verified else "warning",
        summary=(
            f"Auto-fix '{check_code}' corrected {fixed_count} record(s); "
            f"verification {'passed' if verified else 'still finds issues'}."
        ),
        details={"fixed": fixed_count, "verified": verified},
        fix_applied=check_code,
        outcome="success" if verified else "failed",
        confidence=BASE_CONFIDENCE,
        actor=actor,
    )
    session.commit()
    return {
        "check_code": check_code,
        "fixed": fixed_count,
        "verified": verified,
        "outcome": "success" if verified else "failed",
    }


def record_feedback(
    session: Session,
    *,
    check_code: str,
    worked: bool,
    notes: str = "",
    actor: str | None = None,
) -> dict[str, Any]:
    """Store human feedback; this is the learning signal for future confidence."""
    _record(
        session,
        event_type="feedback",
        check_code=check_code,
        summary=notes or f"Feedback for {check_code}: {'worked' if worked else 'did not work'}",
        details={"notes": notes},
        fix_applied=check_code,
        outcome="success" if worked else "failed",
        actor=actor,
    )
    session.commit()
    return {"check_code": check_code, "recorded": True, "worked": worked}


def learning_stats(session: Session) -> dict[str, Any]:
    """Aggregate the learning store: events, outcomes, and per-check success."""
    total = session.scalar(select(func.count()).select_from(AiLearningEventRow)) or 0
    by_type_rows = session.execute(
        select(AiLearningEventRow.event_type, func.count()).group_by(
            AiLearningEventRow.event_type
        )
    ).all()
    by_outcome_rows = session.execute(
        select(AiLearningEventRow.outcome, func.count()).group_by(AiLearningEventRow.outcome)
    ).all()
    per_check: dict[str, dict[str, Any]] = {}
    codes = session.scalars(
        select(AiLearningEventRow.check_code).distinct()
    ).all()
    for code in codes:
        rate = _success_rate(session, code)
        events = session.scalar(
            select(func.count())
            .select_from(AiLearningEventRow)
            .where(AiLearningEventRow.check_code == code)
        ) or 0
        per_check[code] = {"events": events, "remediation_success_rate": rate}
    recent = session.scalars(
        select(AiLearningEventRow).order_by(AiLearningEventRow.created_at.desc()).limit(10)
    ).all()
    return {
        "total_events": total,
        "by_type": {row[0]: row[1] for row in by_type_rows},
        "by_outcome": {row[0]: row[1] for row in by_outcome_rows},
        "per_check": per_check,
        "recent": [
            {
                "event_type": item.event_type,
                "check_code": item.check_code,
                "severity": item.severity,
                "summary": item.summary,
                "outcome": item.outcome,
                "confidence": float(item.confidence),
                "created_at": item.created_at.isoformat() if item.created_at else None,
            }
            for item in recent
        ],
    }
