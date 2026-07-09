from __future__ import annotations

import json
import os
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "artifacts" / "step7-employee-actions"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

API_BASE = os.environ.get("ATLAS_TEST_BASE_URL", "http://127.0.0.1:3355/api")
UI_BASE = os.environ.get("ATLAS_V2_TEST_URL", "http://127.0.0.1:3362/v2/")
USERNAME = os.environ.get("ATLAS_TEST_USERNAME", "sa")
PASSWORD = os.environ.get("ATLAS_TEST_PASSWORD", "Atlas@25")


def api_request(path: str, method: str = "GET", token: str | None = None, session_id: str | None = None, body: dict | None = None):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if session_id:
        headers["X-Session-Id"] = session_id
    request = urllib.request.Request(f"{API_BASE}{path}", method=method, headers=headers, data=data)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def login():
    return api_request("/auth/login", method="POST", body={"username": USERNAME, "password": PASSWORD})


def employee_payload(code: str, name: str):
    return {
        "code": code,
        "name": name,
        "joinDate": "2026-01-01",
        "nationality": "India",
        "branch": "Hamalah",
        "department": "Quality Assurance",
        "designation": "Verification User",
        "status": "Active",
        "whatsappNumber": "97330000000",
        "openingDays": 0,
        "openingBhd": 0,
        "currentAirfare2024": 0,
        "airfarePaidDays": 0,
        "remainingBalance2024": 0,
        "maximumPayout": 150,
        "totalAirfare2024": 0,
        "totalWorkingDays": 360,
        "jan": 30,
        "feb": 30,
        "mar": 30,
        "apr": 30,
        "may": 30,
        "jun": 30,
        "jul": 30,
        "aug": 30,
        "sep": 30,
        "oct": 30,
        "nov": 30,
        "dec": 30,
    }


def list_employees(token: str, session_id: str):
    return api_request("/employees?scope=all", token=token, session_id=session_id)


def find_employee(employees: list[dict], code: str):
    for employee in employees:
        if str(employee.get("EmployeeCode")) == code:
            return employee
    return None


def cleanup_employees(token: str, session_id: str, codes: list[str]):
    employees = list_employees(token, session_id)
    ids = [int(employee["EmployeeID"]) for employee in employees if str(employee.get("EmployeeCode")) in codes]
    if not ids:
        return
    try:
        api_request("/employees/bulk-delete", method="POST", token=token, session_id=session_id, body={"employeeIds": ids})
    except Exception:
        for employee_id in ids:
            try:
                api_request(f"/employees/{employee_id}", method="DELETE", token=token, session_id=session_id)
            except Exception:
                pass


def run():
    login_result = login()
    token = login_result["token"]
    session_id = login_result["sessionId"]

    stamp = str(int(time.time()))
    code_a = f"ZZV2{stamp}A"
    code_b = f"ZZV2{stamp}B"
    codes = [code_a, code_b]
    updated_whatsapp = "97339998888"

    cleanup_employees(token, session_id, codes)
    api_request("/employees", method="POST", token=token, session_id=session_id, body=employee_payload(code_a, f"V2 Action Test {stamp} A"))
    api_request("/employees", method="POST", token=token, session_id=session_id, body=employee_payload(code_b, f"V2 Action Test {stamp} B"))

    session_payload = json.dumps(
        {
            "session": login_result,
            "companyId": "",
            "expiresAt": 4102444800000,
        }
    )

    report = {
        "uiBase": UI_BASE,
        "codes": codes,
        "updatedWhatsapp": updated_whatsapp,
        "desktop": {},
        "mobile": {},
        "consoleErrors": [],
    }

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()

            desktop = browser.new_context(viewport={"width": 1440, "height": 900})
            desktop.add_init_script(
                f"""
                window.localStorage.setItem('atlas.session', {json.dumps(session_payload)});
                window.localStorage.setItem('atlas.v2.theme', 'light-professional');
                """
            )
            page = desktop.new_page()
            page.on("console", lambda message: report["consoleErrors"].append(f"desktop:{message.type}:{message.text}"))
            page.on("dialog", lambda dialog: dialog.accept(code_a) if "Type the employee code" in dialog.message else dialog.accept())
            page.goto(UI_BASE, wait_until="domcontentloaded")
            page.wait_for_timeout(1500)
            page.locator('[data-nav-surface="desktop"][data-nav-key="employees"]').click()
            page.wait_for_timeout(1200)

            search = page.locator('[data-testid="employees-search"]')
            search.fill(code_a)
            page.wait_for_timeout(400)
            edit_button = page.locator(f'[data-testid="employee-edit-"]')
            row_edit_button = page.locator(f'[data-testid="employee-edit-{find_employee(list_employees(token, session_id), code_a)["EmployeeID"]}"]')
            row_edit_button.click()
            page.wait_for_selector('[data-testid="employee-edit-modal"]')
            page.locator('[data-testid="employee-edit-whatsapp"]').fill(updated_whatsapp)
            page.locator('[data-testid="employee-edit-save"]').click()
            page.wait_for_timeout(1600)

            employees_after_edit = list_employees(token, session_id)
            edited_employee = find_employee(employees_after_edit, code_a)

            search.fill(f"ZZV2{stamp}")
            page.wait_for_timeout(400)
            page.locator('[data-testid="employees-select-all"]').check()
            page.wait_for_timeout(300)
            bulk_delete_button = page.locator('[data-testid="employees-bulk-delete"]')
            bulk_delete_label = " ".join(bulk_delete_button.inner_text().split())
            bulk_delete_button.click()
            page.wait_for_timeout(1800)

            employees_after_delete = list_employees(token, session_id)
            remaining_codes = [str(employee.get("EmployeeCode")) for employee in employees_after_delete if str(employee.get("EmployeeCode")) in codes]

            desktop_shot = ARTIFACT_DIR / "desktop.png"
            page.screenshot(path=str(desktop_shot), full_page=False)

            report["desktop"] = {
                "editModalOpened": True,
                "whatsappUpdated": edited_employee is not None and str(edited_employee.get("WhatsAppNumber") or "") == updated_whatsapp,
                "bulkDeleteLabel": bulk_delete_label,
                "deletedFromApi": len(remaining_codes) == 0,
                "noHorizontalOverflow": page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"),
                "screenshot": str(desktop_shot),
            }
            desktop.close()

            mobile = browser.new_context(viewport={"width": 390, "height": 844})
            mobile.add_init_script(
                f"""
                window.localStorage.setItem('atlas.session', {json.dumps(session_payload)});
                window.localStorage.setItem('atlas.v2.theme', 'light-professional');
                """
            )
            mobile_page = mobile.new_page()
            mobile_page.on("console", lambda message: report["consoleErrors"].append(f"mobile:{message.type}:{message.text}"))
            mobile_page.goto(UI_BASE, wait_until="domcontentloaded")
            mobile_page.wait_for_timeout(1500)
            mobile_page.get_by_role("button", name="Navigation").click()
            mobile_page.locator('[data-nav-surface="mobile"][data-nav-key="employees"]').click()
            mobile_page.wait_for_timeout(1200)
            mobile_page.locator('[data-testid="employees-search"]').fill("HARNEK")
            mobile_page.wait_for_timeout(300)
            mobile_edit_visible = mobile_page.locator('[data-testid^="employee-edit-"]').first.is_visible()

            mobile_shot = ARTIFACT_DIR / "mobile.png"
            mobile_page.screenshot(path=str(mobile_shot), full_page=False)
            report["mobile"] = {
                "editButtonVisible": mobile_edit_visible,
                "noHorizontalOverflow": mobile_page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"),
                "screenshot": str(mobile_shot),
            }
            mobile.close()

            browser.close()
    finally:
        cleanup_employees(token, session_id, codes)

    return report


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
