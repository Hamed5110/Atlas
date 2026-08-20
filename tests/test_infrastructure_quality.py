"""Coverage for cache and repository infrastructure behavior."""

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import NoReturn
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from airfare_management.config import Settings
from airfare_management.domain.services import build_amortization_schedule
from airfare_management.infrastructure import cache as cache_module
from airfare_management.infrastructure.cache import PreferenceCache
from airfare_management.infrastructure.database import Base, EmployeeRow, create_session_factory
from airfare_management.infrastructure.repositories import (
    LoanRepository,
    RowRepository,
    SqlAlchemyUnitOfWork,
)
from airfare_management.infrastructure.schema import CompanyRow, LoanRow


class FakeRedis:
    """Small Redis substitute for deterministic cache tests."""

    def __init__(self) -> None:
        """Initialize an empty key/value store."""
        self.values: dict[str, str] = {}
        self.fail_reads = False

    def ping(self) -> bool:
        """Report a healthy connection."""
        return True

    def get(self, key: str) -> str | None:
        """Read one cache value."""
        if self.fail_reads:
            raise cache_module.RedisError("read failed")
        return self.values.get(key)

    def setex(self, key: str, _ttl: int, value: str) -> None:
        """Store one cache value."""
        self.values[key] = value

    def scan_iter(self, *, match: str, count: int) -> list[str]:
        """Return preference keys."""
        assert match == "airfare:prefs:*"
        assert count == 100
        return list(self.values)

    def delete(self, *keys: str) -> None:
        """Delete cache keys."""
        for key in keys:
            self.values.pop(key, None)


def test_preference_cache_redis_and_memory_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Read, write, clear, expire, and fall back from Redis."""
    fake = FakeRedis()
    monkeypatch.setattr(cache_module.Redis, "from_url", lambda *args, **kwargs: fake)
    cache = PreferenceCache("redis://example", ttl_seconds=60)
    assert cache.backend == "redis"
    cache.set("user", {"theme": "dark"})
    assert cache.get("user") == {"theme": "dark"}
    fake.values["airfare:prefs:invalid"] = "[]"
    assert cache.get("invalid") is None
    cache.clear()
    assert fake.values == {}

    fake.fail_reads = True
    cache.set("fallback", {"theme": "light"})
    assert cache.get("fallback") == {"theme": "light"}
    assert cache.backend == "memory"
    cache._memory["expired"] = (0, {"old": True})
    assert cache.get("expired") is None
    assert cache.get("missing") is None

    def unavailable(*args: object, **kwargs: object) -> NoReturn:
        raise OSError("offline")

    monkeypatch.setattr(cache_module.Redis, "from_url", unavailable)
    memory = PreferenceCache("redis://offline")
    memory.set("key", {"value": 1})
    assert memory.get("key") == {"value": 1}
    memory.clear()


def test_row_loan_and_unit_of_work_repositories() -> None:
    """Exercise generic CRUD, loan schedules, and transaction boundaries."""
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="i" * 32,
        bootstrap_admin_password="StrongPassword!2026",
    )
    sessions = create_session_factory(settings)
    Base.metadata.create_all(sessions.kw["bind"])
    company_id = str(uuid4())
    employee_uuid = uuid4()
    now = datetime.now(UTC)

    with sessions.begin() as session:
        companies = RowRepository(session, CompanyRow)
        company = CompanyRow(id=company_id, code="INFRA", name="Infrastructure")
        companies.add(company)
        companies.flush()
        assert companies.get(company_id) is company
        assert companies.get("missing") is None
        assert (
            len(companies.list_active(CompanyRow.active.is_(True), order_by=CompanyRow.code)) == 1
        )
        assert companies.scalar(select(func.count()).select_from(CompanyRow)) == 1
        assert list(companies.scalars(select(CompanyRow))) == [company]

        employee = EmployeeRow(
            id=employee_uuid,
            company_id=company_id,
            code="INFRA-1",
            full_name="Infrastructure Employee",
            join_date=date(2024, 1, 1),
            department="IT",
            branch="HQ",
            pay_group="A",
            repair_center="",
            active=True,
            version=1,
            created_at=now,
            updated_at=now,
        )
        session.add(employee)
        loan = LoanRow(
            employee_id=employee_uuid,
            principal=Decimal("300"),
            annual_rate=Decimal("0"),
            installments=3,
            monthly_installment=Decimal("100"),
            outstanding=Decimal("300"),
            first_due_date=date(2026, 1, 1),
        )
        session.add(loan)
        session.flush()
        loans = LoanRepository(session)
        schedule = build_amortization_schedule(Decimal("300"), Decimal("0"), 3, date(2026, 1, 1))
        loans.replace_schedule(loan.id, schedule)
        loans.replace_schedule(loan.id, schedule)
        assert len(loans.schedule(loan.id)) == 3

    with SqlAlchemyUnitOfWork(sessions) as work:
        assert work.get_employee_row(employee_uuid) is not None
        assert work.get_employee(employee_uuid) is not None
        work.flush()
        work.commit()

    with pytest.raises(RuntimeError):
        with SqlAlchemyUnitOfWork(sessions):
            raise RuntimeError("rollback")
    sessions.kw["bind"].dispose()
