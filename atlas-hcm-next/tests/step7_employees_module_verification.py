from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "artifacts" / "step7-employees-module"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

API_BASE = os.environ.get("ATLAS_TEST_BASE_URL", "http://127.0.0.1:3355/api")
UI_BASE = os.environ.get("ATLAS_V2_TEST_URL", "http://127.0.0.1:3361/v2/")
USERNAME = os.environ.get("ATLAS_TEST_USERNAME", "sa")
PASSWORD = os.environ.get("ATLAS_TEST_PASSWORD", "Atlas@25")

VIEWPORTS = [
    ("desktop", {"width": 1440, "height": 900}),
    ("mobile", {"width": 390, "height": 844}),
]


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
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def login():
    return api_request("/auth/login", method="POST", body={"username": USERNAME, "password": PASSWORD})


def to_employee_lifecycle_status(value: str | None):
    normalized = str(value or "").strip().lower()
    if not normalized:
        return "Active"
    if normalized == "inactive":
        return "Inactive"
    if normalized == "terminated":
        return "Terminated"
    if normalized == "termination":
        return "Terminated"
    if normalized == "probation":
        return "Probation"
    if normalized == "resign":
        return "Resign"
    if normalized == "resigned":
        return "Resigned"
    if normalized == "separated":
        return "Separated"
    return "Active"


def is_airfare_eligible_employee_status(value: str | None):
    return to_employee_lifecycle_status(value) == "Active"


def normalize_ui_text(value: str) -> str:
    return " ".join(str(value).replace("\xa0", " ").split())


def run():
    login_result = login()
    token = login_result["token"]
    session_id = login_result["sessionId"]
    employees = api_request("/employees?scope=all", token=token, session_id=session_id)
    total_count = len(employees)
    active_count = sum(1 for employee in employees if is_airfare_eligible_employee_status(employee.get("Status")))
    inactive_count = total_count - active_count

    sample_employee = next((employee for employee in employees if is_airfare_eligible_employee_status(employee.get("Status"))), employees[0] if employees else None)
    sample_search = sample_employee.get("EmployeeCode") if sample_employee else ""

    session_payload = json.dumps(
        {
            "session": login_result,
            "companyId": "",
            "expiresAt": 4102444800000,
        }
    )

    report = {
        "apiBase": API_BASE,
        "uiBase": UI_BASE,
        "expected": {
            "total": total_count,
            "active": active_count,
            "inactive": inactive_count,
            "sampleSearch": sample_search,
        },
        "viewports": {},
        "consoleErrors": [],
    }

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for name, viewport in VIEWPORTS:
            context = browser.new_context(viewport=viewport)
            context.add_init_script(
                f"""
                window.localStorage.setItem('atlas.session', {json.dumps(session_payload)});
                window.localStorage.setItem('atlas.v2.theme', 'light-professional');
                """
            )
            page = context.new_page()
            page.on("console", lambda message: report["consoleErrors"].append(f"{name}:{message.type}:{message.text}"))
            page.goto(UI_BASE, wait_until="domcontentloaded")
            page.wait_for_timeout(1200)

            if viewport["width"] <= 1120:
                page.get_by_role("button", name="Navigation").click()
                page.locator('[data-nav-surface="mobile"][data-nav-key="employees"]').click()
            else:
                page.locator('[data-nav-surface="desktop"][data-nav-key="employees"]').click()
            page.wait_for_timeout(1500)

            total_text = normalize_ui_text(page.locator('[data-testid="employees-total"] strong').inner_text())
            active_text = normalize_ui_text(page.locator('[data-testid="employees-active"] strong').inner_text())
            inactive_text = normalize_ui_text(page.locator('[data-testid="employees-inactive"] strong').inner_text())
            selected_text_before = normalize_ui_text(page.locator('[data-testid="employees-selected"] strong').inner_text())

            notifications_button = page.get_by_role("button", name="Open notifications")
            notifications_button.click()
            notifications_visible = page.get_by_label("Notification center", exact=True).is_visible()

            search = page.locator('[data-testid="employees-search"]')
            status_filter = page.locator('[data-testid="employees-status-filter"]')
            select_all = page.locator('[data-testid="employees-select-all"]')

            search.fill(sample_search)
            page.wait_for_timeout(300)
            filtered_rows = page.locator('[data-testid="employee-row"]').count()

            search.fill("")
            status_filter.select_option("inactive")
            page.wait_for_timeout(300)
            inactive_rows = page.locator('[data-testid="employee-row"]').count()

            status_filter.select_option("active")
            page.wait_for_timeout(300)
            select_all.check()
            page.wait_for_timeout(300)
            selected_text_after = normalize_ui_text(page.locator('[data-testid="employees-selected"] strong').inner_text())

            refresh_button = page.get_by_role("button", name="Refresh employee data")
            refresh_button.focus()
            page.keyboard.press("Enter")
            page.wait_for_timeout(900)

            heading_text = page.locator("h1").inner_text().strip()
            overflow_ok = page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")

            screenshot_path = ARTIFACT_DIR / f"{name}.png"
            page.screenshot(path=str(screenshot_path), full_page=False)

            report["viewports"][name] = {
                "viewport": viewport,
                "rendered": {
                    "total": total_text,
                    "active": active_text,
                    "inactive": inactive_text,
                    "selectedBefore": selected_text_before,
                    "selectedAfter": selected_text_after,
                },
                "matchesExpected": {
                    "total": total_text == str(total_count),
                    "active": active_text == str(active_count),
                    "inactive": inactive_text == str(inactive_count),
                },
                "notificationsVisible": notifications_visible,
                "searchFilteredRows": filtered_rows,
                "inactiveRows": inactive_rows,
                "heading": heading_text,
                "noHorizontalOverflow": overflow_ok,
                "screenshot": str(screenshot_path),
            }

            context.close()

        browser.close()

    return report


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
