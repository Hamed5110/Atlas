from __future__ import annotations

import base64
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
import sys

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.routers import employee as employee_router  # noqa: E402


@dataclass
class FakeEmployee:
    employee_id: int
    employee_code: str
    punch_machine_id: str | None = None
    full_name: str = "Test User"
    first_name: str = "Test"
    middle_name: str | None = None
    last_name: str = "User"
    passport_name: str | None = None
    gender: str = "Male"
    date_of_birth: date = date(1990, 1, 1)
    nationality: str = "Bahraini"
    religion: str | None = None
    marital_status: str | None = "Single"
    joining_date: date = date(2026, 1, 1)
    probation_end_date: date | None = None
    confirmation_date: date | None = None
    department_id: int | None = None
    designation: str = "Analyst"
    grade_level: str | None = None
    branch_id: int | None = None
    employment_type: str = "Permanent"
    status: str = "Active"
    direct_manager_id: int | None = None
    personal_email: str | None = "personal@example.com"
    work_email: str | None = "work@example.com"
    mobile_number: str | None = "+97300000000"
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relationship: str | None = None
    local_address: str | None = None
    home_country_address: str | None = None
    passport_number: str | None = "P100"
    passport_expiry: date | None = date(2030, 1, 1)
    civil_id: str | None = "C100"
    civil_id_expiry: date | None = date(2030, 1, 1)
    visa_number: str | None = None
    visa_type: str | None = None
    visa_expiry: date | None = None
    labour_card_number: str | None = None
    labour_card_expiry: date | None = None
    basic_salary: Decimal = Decimal("500.000")
    housing_allowance: Decimal = Decimal("100.000")
    transport_allowance: Decimal = Decimal("50.000")
    other_fixed_allowances: Decimal = Decimal("25.000")
    payment_mode: str = "Bank"
    bank_name: str | None = "ATLAS Bank"
    iban_account_number: str | None = "BH00ATLAS000000000"
    swift_code: str | None = None
    resignation_date: date | None = None
    last_working_day: date | None = None
    reason_for_leaving: str | None = None
    rehire_eligible: bool = True
    row_version: bytes = b"\x00\x00\x00\x00\x00\x00\x00\x01"
    is_deleted: bool = False
    created_at_utc: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at_utc: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class FakeSession:
    def __init__(self):
        self.rows: dict[int, FakeEmployee] = {1: FakeEmployee(employee_id=1, employee_code="EMP-001")}
        self.next_id = 2

    def scalar(self, query):
        text = str(query)
        if "count" in text.lower():
            return len([row for row in self.rows.values() if not row.is_deleted])
        return None

    def scalars(self, query):
        return ScalarResult([row for row in self.rows.values() if not row.is_deleted])

    def get(self, model, emp_id):
        return self.rows.get(emp_id)

    def add(self, employee):
        employee.employee_id = self.next_id
        self.next_id += 1
        employee.row_version = b"\x00\x00\x00\x00\x00\x00\x00\x02"
        employee.is_deleted = False
        employee.created_at_utc = datetime.now(timezone.utc)
        employee.updated_at_utc = datetime.now(timezone.utc)
        self.rows[employee.employee_id] = employee

    def commit(self):
        return None

    def rollback(self):
        return None

    def refresh(self, employee):
        employee.row_version = b"\x00\x00\x00\x00\x00\x00\x00\x03"

    def close(self):
        return None


def employee_payload(employee_code: str = "EMP-002") -> dict:
    return {
        "employee_code": employee_code,
        "punch_machine_id": "PM-2",
        "full_name": "New Employee",
        "first_name": "New",
        "middle_name": None,
        "last_name": "Employee",
        "passport_name": "New Employee",
        "gender": "Female",
        "date_of_birth": "1992-01-01",
        "nationality": "Bahraini",
        "religion": None,
        "marital_status": "Single",
        "joining_date": "2026-01-01",
        "probation_end_date": "2026-04-01",
        "confirmation_date": "2026-04-02",
        "department_id": None,
        "designation": "Officer",
        "grade_level": "G1",
        "branch_id": None,
        "employment_type": "Permanent",
        "status": "Active",
        "direct_manager_id": None,
        "personal_email": "new.personal@example.com",
        "work_email": "new.work@example.com",
        "mobile_number": "+97311111111",
        "emergency_contact_name": "Emergency Person",
        "emergency_contact_phone": "+97322222222",
        "emergency_contact_relationship": "Sibling",
        "local_address": "Bahrain",
        "home_country_address": "Home",
        "passport_number": f"P-{employee_code}",
        "passport_expiry": "2030-01-01",
        "civil_id": f"C-{employee_code}",
        "civil_id_expiry": "2030-01-01",
        "visa_number": "V1",
        "visa_type": "Work",
        "visa_expiry": "2030-01-01",
        "labour_card_number": "L1",
        "labour_card_expiry": "2030-01-01",
        "basic_salary": "500.000",
        "housing_allowance": "100.000",
        "transport_allowance": "50.000",
        "other_fixed_allowances": "25.000",
        "payment_mode": "Bank",
        "bank_name": "ATLAS Bank",
        "iban_account_number": "BH00ATLAS000000000",
        "swift_code": "ATLASBH",
        "resignation_date": None,
        "last_working_day": None,
        "reason_for_leaving": None,
        "rehire_eligible": True,
    }


def make_client():
    fake_session = FakeSession()
    app = create_app()

    def override_db():
        yield fake_session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[employee_router.get_db] = override_db
    return TestClient(app), fake_session


def test_employee_api_get_post_put_delete() -> None:
    client, fake = make_client()

    listing = client.get("/api/v1/employees")
    assert listing.status_code == 200
    assert listing.json()["total"] == 1

    created = client.post("/api/v1/employees", json=employee_payload("EMP-002"))
    assert created.status_code == 201
    created_body = created.json()
    assert created_body["employee_code"] == "EMP-002"
    emp_id = created_body["employee_id"]

    fetched = client.get(f"/api/v1/employees/{emp_id}")
    assert fetched.status_code == 200
    assert fetched.json()["employee_id"] == emp_id

    update_payload = employee_payload("EMP-002")
    update_payload["full_name"] = "Updated Employee"
    update_payload["row_version"] = created_body["row_version"]
    updated = client.put(f"/api/v1/employees/{emp_id}", json=update_payload)
    assert updated.status_code == 200
    assert updated.json()["full_name"] == "Updated Employee"

    deleted = client.delete(f"/api/v1/employees/{emp_id}")
    assert deleted.status_code == 204
    assert fake.rows[emp_id].is_deleted is True


def test_employee_api_validation_rejects_bad_exit_and_bank_payload() -> None:
    client, _ = make_client()
    bad = employee_payload("EMP-003")
    bad["payment_mode"] = "Bank"
    bad["iban_account_number"] = None
    response = client.post("/api/v1/employees", json=bad)
    assert response.status_code == 422

    bad_exit = employee_payload("EMP-004")
    bad_exit["status"] = "Terminated"
    response = client.post("/api/v1/employees", json=bad_exit)
    assert response.status_code == 422


def test_employee_api_rejects_stale_row_version() -> None:
    client, _ = make_client()
    created = client.post("/api/v1/employees", json=employee_payload("EMP-005")).json()
    update_payload = employee_payload("EMP-005")
    update_payload["row_version"] = base64.b64encode(b"stale").decode("ascii")
    response = client.put(f"/api/v1/employees/{created['employee_id']}", json=update_payload)
    assert response.status_code == 409
