from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import base64
import io
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("ATLAS_PYTHON_PORT", "3367")
os.environ.setdefault("ATLAS_PYTHON_DB_SERVER", "localhost")
os.environ.setdefault("ATLAS_PYTHON_DB_PORT", "1433")
os.environ.setdefault("ATLAS_PYTHON_DB_USER", "sa")
os.environ.setdefault("ATLAS_PYTHON_DB_PASSWORD", "Atlas@25")
os.environ.setdefault("ATLAS_PYTHON_DB_NAME", "AtlasPythonCoreTest")

from app import config, db  # noqa: E402


def test_database_repository_contract() -> None:
    proof = db.initialize()
    assert proof["databaseName"] == config.DB_NAME
    assert proof["objects"]["employees"] is True
    assert proof["objects"]["entitlementEvents"] is True
    assert proof["objects"]["airfareAllocations"] is True

    summary = db.summary("2026-12-31")
    assert summary["repository"] == "mssql-python-core"
    assert summary["employees"]["active"] >= 1
    assert summary["entitlement"]["balance"] >= 0

    employees = db.list_employees()
    assert any(row["employeeNumber"] == "5110" for row in employees)

    balances = db.entitlement_balance("2026-12-31")
    assert any(row["employeeNumber"] == "5110" for row in balances)

    rules = db.list_entitlement_rules()
    assert any(row["ruleCode"] == "GLOBAL-150" for row in rules)

    employee = db.create_employee({
        "employeeNumber": f"PY-{uuid.uuid4().hex[:8]}",
        "displayName": "Python Verified User",
        "legalName": "Python Verified Legal User",
        "hireDate": "2026-03-01",
        "terminationDate": "",
        "department": "QA",
        "jobTitle": "Verifier",
        "employmentType": "full_time",
        "payGroup": "Monthly",
        "workEmail": "verified@example.com",
        "phoneNumber": "+97300000000",
        "nationality": "Bahraini",
        "passportNumber": "P12345",
        "cprNumber": "900000000",
        "bankName": "ATLAS Bank",
        "iban": "BH00ATLAS000000000000",
        "basicSalary": "500.000",
        "eligibleForAirfare": "true",
        "homeAirportCode": "BAH",
        "destinationAirportCode": "COK",
    })
    created_rows = [row for row in db.list_employees() if row["employeeId"] == employee["employeeId"]]
    assert created_rows[0]["cprNumber"] == "900000000"
    assert created_rows[0]["payGroup"] == "Monthly"
    assert created_rows[0]["homeAirportCode"] == "BAH"
    event = db.post_entitlement_event({
        "employeeId": employee["employeeId"],
        "eventDate": "2026-03-01",
        "eventType": "seed",
        "amount": "100.000",
    })
    assert event["amount"] == 100.0

    allocation = db.create_allocation({
        "employeeId": employee["employeeId"],
        "allocationDate": "2026-03-15",
        "travelDate": "2026-04-01",
        "originAirportCode": "BAH",
        "destinationAirportCode": "COK",
        "airlineName": "Gulf Air",
        "ticketNumber": "GF-TEST-1",
        "paymentMode": "mixed",
        "ticketCost": "40.000",
    })
    assert allocation["entitlementApplied"] == 40.0
    assert allocation["companyPaid"] == 0.0
    assert allocation["destinationAirportCode"] == "COK"

    loan = db.create_loan({
        "employeeId": employee["employeeId"],
        "loanType": "airfare",
        "principalAmount": "250.000",
        "emiAmount": "25.000",
        "tenureMonths": "10",
        "outstandingAmount": "250.000",
        "loanDate": "2026-03-25",
        "startDate": "2026-04-01",
        "notes": "test recovery",
    })
    assert loan["statusCode"] == "active"
    assert loan["tenureMonths"] == 10

    reconciliation = db.reconciliation("2026-12-31")
    assert reconciliation["status"] in {"balanced", "review"}
    assert "not payroll posting" in reconciliation["note"]

    request = db.create_self_service_request({
        "employeeId": employee["employeeId"],
        "requestType": "airfare_request",
        "requestDate": "2026-05-01",
        "amount": "30.000",
        "notes": "test request",
    })
    assert request["statusCode"] == "submitted"
    assert db.transition_self_service_request(request["requestId"], "approved")["statusCode"] == "approved"

    assert db.login({"username": "admin", "password": "Admin123!"})["user"]["roleCode"] == "admin"
    assert db.reports_airfare_payable("2026-12-31")["employeeCount"] >= 1
    assert db.reports_employee_summary()["total"] >= 1
    assert db.get_preferences()["preferences"]["theme"] in {"system", "light", "dark"}
    assert db.save_preferences({"theme": "dark", "density": "compact"})["preferences"]["theme"] == "dark"
    assert db.list_users()[0]["username"] == "admin"
    assert db.import_preview("employees", [{"employeeNumber": "X", "displayName": "Y", "hireDate": "2026-01-01", "homeAirportCode": "BAH"}, {"employeeNumber": ""}])["invalidRows"]
    assert db.export_module("employees")["rows"]
    assert db.diagnostics()["status"] == "ok"
    assert db.support_info()["supportMode"] == "local-greenfield"
    assert db.system_maintenance()["database"] == config.DB_NAME
    attachment = db.create_attachment({
        "moduleCode": "allocations",
        "ownerId": employee["employeeId"],
        "fileName": "evidence.txt",
        "contentType": "text/plain; charset=utf-8",
        "contentBase64": base64.b64encode(b"airfare evidence").decode("ascii"),
    })
    assert attachment["viewUrl"].endswith("/view")
    assert db.get_attachment_content(attachment["attachmentId"])["content"] == b"airfare evidence"

    airports = db.search_airports("BAH")["rows"]
    assert airports[0]["code"] == "BAH"
    assert airports[0]["score"] == 100

    backup = db.create_backup()
    assert Path(backup["backupFile"]).exists()
    restore = db.restore_backup({"backupFile": backup["backupFile"]})
    assert restore["status"] == "completed"

    excel_payload = make_employee_workbook_base64(f"XL-{uuid.uuid4().hex[:8]}")
    preview = db.excel_import_preview({"moduleCode": "employees", "contentBase64": excel_payload})
    assert len(preview["validRows"]) == 1
    executed = db.excel_import_execute({"moduleCode": "employees", "contentBase64": excel_payload})
    assert len(executed["createdRows"]) == 1


def test_http_contract() -> None:
    from app.server import Handler
    from http.server import ThreadingHTTPServer

    server = ThreadingHTTPServer(("127.0.0.1", config.PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        wait_for(f"http://127.0.0.1:{config.PORT}/api/health")
        health = get_json(f"http://127.0.0.1:{config.PORT}/api/health")
        assert health["status"] == "ok"
        assert health["repository"] == "mssql-python-core"
        assert health["annualCloseProcess"] is False
        assert health["database"]["databaseName"] == config.DB_NAME

        for route, marker in {
            "/": "One clean system",
            "/employees": "Complete master record",
            "/employee-import": "Excel import with validation",
            "/airfare": "Rules, accruals, allocation usage",
            "/loans": "Recovery setup",
            "/reports": "AIRFARE PAYABLE",
            "/admin": "Companies, users, preferences",
            "/support": "Diagnostics",
        }.items():
            assert marker in get_text(f"http://127.0.0.1:{config.PORT}{route}")

        summary = get_json(f"http://127.0.0.1:{config.PORT}/api/summary?asOfDate=2026-12-31")
        assert summary["database"] == config.DB_NAME
        assert summary["repository"] == "mssql-python-core"
        assert "allocations" in summary

        assert get_json(f"http://127.0.0.1:{config.PORT}/api/companies")["rows"]
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/entitlement/rules")["rows"]
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/entitlement/events")["rows"]
        assert "rows" in get_json(f"http://127.0.0.1:{config.PORT}/api/allocations")
        assert "rows" in get_json(f"http://127.0.0.1:{config.PORT}/api/loans")
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/entitlement/reconciliation?asOfDate=2026-12-31")["status"] in {"balanced", "review"}
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/self-service/requests")["rows"]
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/reports/airfare-payable?asOfDate=2026-12-31")["employeeCount"] >= 1
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/reports/employees")["total"] >= 1
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/preferences")["preferences"]
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/users")["rows"]
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/diagnostics")["status"] == "ok"
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/support")["supportMode"] == "local-greenfield"
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/system-maintenance")["database"] == config.DB_NAME
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/airports/search?q=BAH")["rows"][0]["code"] == "BAH"
        attachment_rows = get_json(f"http://127.0.0.1:{config.PORT}/api/attachments")["rows"]
        assert attachment_rows
        attachment_body = get_text(f"http://127.0.0.1:{config.PORT}{attachment_rows[0]['viewUrl']}")
        assert attachment_body
        backup = post_json(f"http://127.0.0.1:{config.PORT}/api/admin/backup", {})
        assert Path(backup["backupFile"]).exists()
        assert get_json(f"http://127.0.0.1:{config.PORT}/api/admin/backups")["rows"]
        excel_payload = make_employee_workbook_base64(f"HTTP-XL-{uuid.uuid4().hex[:8]}")
        excel_result = post_json(f"http://127.0.0.1:{config.PORT}/api/import-excel/execute", {"moduleCode": "employees", "contentBase64": excel_payload})
        assert len(excel_result["createdRows"]) == 1

        try:
            get_json(f"http://127.0.0.1:{config.PORT}/api/summary")
        except urllib.error.HTTPError as exc:
            assert exc.code == 400
        else:
            raise AssertionError("missing asOfDate must fail with 400")
    finally:
        server.shutdown()
        server.server_close()


def wait_for(url: str) -> None:
    deadline = time.time() + 15
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            get_json(url)
            return
        except Exception as exc:
            last_error = exc
            time.sleep(0.2)
    raise AssertionError(f"server did not become ready: {last_error}")


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def get_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=10) as response:
        return response.read().decode("utf-8")


def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def make_employee_workbook_base64(employee_number: str) -> str:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append([
        "employeeNumber",
        "displayName",
        "legalName",
        "hireDate",
        "department",
        "jobTitle",
        "employmentType",
        "payGroup",
        "workEmail",
        "phoneNumber",
        "nationality",
        "passportNumber",
        "CPR",
        "bankName",
        "IBAN",
        "basicSalary",
        "eligibleForAirfare",
        "homeAirportCode",
        "destinationAirportCode",
    ])
    sheet.append([
        employee_number,
        "Excel Imported User",
        "Excel Imported Legal User",
        "2026-06-01",
        "Import",
        "Imported Employee",
        "full_time",
        "Monthly",
        "excel@example.com",
        "+97311111111",
        "Indian",
        "PXLSAMPLE",
        "911111111",
        "Import Bank",
        "BH00IMPORT000000000",
        350,
        "yes",
        "BAH",
        "DEL",
    ])
    buffer = io.BytesIO()
    workbook.save(buffer)
    return base64.b64encode(buffer.getvalue()).decode("ascii")
