from __future__ import annotations

import csv
import io
import os
import time
import uuid

import httpx
import pytest


BASE_URL = os.getenv("ATLAS_LIVE_3388_BASE_URL", "http://127.0.0.1:3388")


def live_enabled() -> bool:
    return os.getenv("ATLAS_RUN_LIVE_3388_TESTS", "").lower() in {"1", "true", "yes"}


pytestmark = pytest.mark.skipif(not live_enabled(), reason="Set ATLAS_RUN_LIVE_3388_TESTS=true to run live Port 3388 integration tests.")


def employee_payload(code: str) -> dict:
    return {
        "employee_code": code,
        "punch_machine_id": f"PM-{code}",
        "full_name": "Live Validation Employee",
        "first_name": "Live",
        "middle_name": None,
        "last_name": "Employee",
        "passport_name": "Live Validation Employee",
        "gender": "Male",
        "date_of_birth": "1990-01-01",
        "nationality": "Bahraini",
        "religion": None,
        "marital_status": "Single",
        "joining_date": "2026-01-01",
        "probation_end_date": "2026-04-01",
        "confirmation_date": "2026-04-02",
        "department_id": None,
        "designation": "Validation Officer",
        "grade_level": "G1",
        "branch_id": None,
        "employment_type": "Permanent",
        "status": "Active",
        "direct_manager_id": None,
        "personal_email": f"{code.lower()}@personal.example",
        "work_email": f"{code.lower()}@work.example",
        "mobile_number": "+97300000000",
        "emergency_contact_name": "Emergency",
        "emergency_contact_phone": "+97311111111",
        "emergency_contact_relationship": "Sibling",
        "local_address": "Bahrain",
        "home_country_address": "Home",
        "passport_number": f"P-{code}",
        "passport_expiry": "2030-01-01",
        "civil_id": f"C-{code}",
        "civil_id_expiry": "2030-01-01",
        "visa_number": f"V-{code}",
        "visa_type": "Work",
        "visa_expiry": "2030-01-01",
        "labour_card_number": f"L-{code}",
        "labour_card_expiry": "2030-01-01",
        "basic_salary": "500.000",
        "housing_allowance": "100.000",
        "transport_allowance": "50.000",
        "other_fixed_allowances": "25.000",
        "payment_mode": "Bank",
        "bank_name": "ATLAS Bank",
        "iban_account_number": f"BH00{code.replace('-', '')}000000",
        "swift_code": "ATLASBH",
        "resignation_date": None,
        "last_working_day": None,
        "reason_for_leaving": None,
        "rehire_eligible": True,
    }


def assert_ok(response: httpx.Response) -> dict:
    assert response.status_code < 400, response.text
    if response.content:
        return response.json()
    return {}


def test_live_port_3388_all_modules() -> None:
    code = f"LIVE-{uuid.uuid4().hex[:8].upper()}"
    with httpx.Client(base_url=BASE_URL, timeout=30.0) as client:
        health = assert_ok(client.get("/api/v1/health"))
        assert health["port"] == 3388
        assert health["continuousModelOnly"] is True
        assert health["runtimeIsolated"] is True

        created = assert_ok(client.post("/api/v1/employees", json=employee_payload(code)))
        emp_id = created["employee_id"]
        assert created["employee_code"] == code

        fetched = assert_ok(client.get(f"/api/v1/employees/{emp_id}"))
        assert fetched["employee_id"] == emp_id

        update = employee_payload(code)
        update["full_name"] = "Live Updated Employee"
        update["row_version"] = fetched["row_version"]
        updated = assert_ok(client.put(f"/api/v1/employees/{emp_id}", json=update))
        assert updated["full_name"] == "Live Updated Employee"

        listing = assert_ok(client.get("/api/v1/employees", params={"search": code, "status": "Active"}))
        assert listing["total"] >= 1

        csv_payload = io.StringIO()
        writer = csv.DictWriter(csv_payload, fieldnames=["EmployeeCode", "FullName", "FirstName", "LastName", "Gender", "DateOfBirth", "Nationality", "JoiningDate", "Designation", "EmploymentType", "PaymentMode", "IBANAccountNumber"])
        writer.writeheader()
        writer.writerow({"EmployeeCode": f"IMP-{code}", "FullName": "Import Employee", "FirstName": "Import", "LastName": "Employee", "Gender": "Female", "DateOfBirth": "1992-01-01", "Nationality": "Bahraini", "JoiningDate": "2026-01-01", "Designation": "Importer", "EmploymentType": "Permanent", "PaymentMode": "Bank", "IBANAccountNumber": "BH00IMPORT0000"})
        import_response = assert_ok(client.post("/api/v1/imports/employees/preview", files={"file": ("employees.csv", csv_payload.getvalue(), "text/csv")}))
        assert import_response["valid"] == 1

        verified = assert_ok(client.post("/api/v1/import/verify-preview", files={"file": ("employees.csv", csv_payload.getvalue(), "text/csv")}))
        assert verified["totalRows"] == 1
        assert verified["validRowsCount"] == 1
        assert verified["errorRowsCount"] == 0
        committed = assert_ok(client.post("/api/v1/import/commit", json={"previewToken": verified["previewToken"]}))
        assert committed["insertedRows"] == 1

        entitlement = assert_ok(client.get(f"/api/v1/airfare/entitlement/{emp_id}", params={"target_date": "2026-12-31"}))
        assert entitlement["employeeId"] == emp_id
        assert entitlement["model"] == "continuous-accrual-elapsed-service-days"
        assert float(entitlement["availableBalance"]) >= 0

        claim = assert_ok(client.post("/api/v1/airfare/claims", json={"employee_id": emp_id, "claim_date": "2026-03-01", "sector_code": "INDIA", "claim_type": "Ticket", "claim_amount": "100.000", "accrued_balance": "150.000", "notes": "live validation"}))
        assert claim["status"] == "Submitted"
        approved = assert_ok(client.post(f"/api/v1/airfare/claims/{claim['claimId']}/approve"))
        assert approved["status"] == "Approved"

        amortization = assert_ok(client.post("/api/v1/loans/amortization", json={"employee_id": emp_id, "principal_amount": "120.000", "terms_months": 12, "annual_interest_rate": "0.000", "disbursement_date": "2026-03-01"}))
        assert len(amortization["schedule"]) == 12
        loan = assert_ok(client.post("/api/v1/loans", json={"employee_id": emp_id, "principal_amount": "120.000", "terms_months": 12, "annual_interest_rate": "0.000", "disbursement_date": "2026-03-01"}))
        assert loan["status"] == "Active"

        document = assert_ok(client.post("/api/v1/attachments/metadata", params={"file_name": f"{code}.pdf", "employee_id": emp_id, "document_type": "Passport"}))
        assert document["status"] == "Pending"

        self_service = assert_ok(client.post("/api/v1/me/requests", json={"employee_id": emp_id, "request_type": "PayslipView", "payload": {"period": "2026-03"}}))
        assert self_service["status"] == "Submitted"

        report = assert_ok(client.post("/api/v1/reports/run", json={"report_code": "PayrollSummary", "date_from": "2026-01-01", "date_to": "2026-12-31", "export_format": "json"}))
        assert report["status"] == "Completed"

        airports = assert_ok(client.get("/api/v1/airports", params={"q": "BAH"}))
        assert airports[0]["iata_code"] == "BAH"

        backup = assert_ok(client.post("/api/v1/admin/backups"))
        assert backup["status"] == "Queued"

        deleted = client.delete(f"/api/v1/employees/{emp_id}")
        assert deleted.status_code == 204


