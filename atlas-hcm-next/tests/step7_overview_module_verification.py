from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "artifacts" / "step7-overview-module"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

API_BASE = os.environ.get("ATLAS_TEST_BASE_URL", "http://127.0.0.1:3355/api")
UI_BASE = os.environ.get("ATLAS_V2_TEST_URL", "http://127.0.0.1:3361/v2/")
USERNAME = os.environ.get("ATLAS_TEST_USERNAME", "sa")
PASSWORD = os.environ.get("ATLAS_TEST_PASSWORD", "Atlas@25")
YEAR = int(os.environ.get("ATLAS_TEST_YEAR", "2026"))
AS_OF_DATE = os.environ.get("ATLAS_TEST_AS_OF", f"{YEAR}-07-09")

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


def money_format(amount: float) -> str:
    return f"BHD {amount:,.2f}"


def normalize_ui_text(value: str) -> str:
    return " ".join(str(value).replace("\xa0", " ").split())


def build_expected_metrics(token: str, session_id: str):
    loans = api_request("/loans/register", token=token, session_id=session_id)
    loan_summary = api_request("/loans/summary", token=token, session_id=session_id)
    allocations = api_request(f"/allocations?year={YEAR}", token=token, session_id=session_id)
    payable_rows = api_request(
        f"/reports/airfare-payable?year={YEAR}&asOfDate={AS_OF_DATE}",
        token=token,
        session_id=session_id,
    )
    verification = api_request("/intelligence/verification", token=token, session_id=session_id)

    payable_amount = sum(float(row.get("PayableBHD") or 0) for row in payable_rows)
    current_year_earned = sum(float(row.get("CurrentYearEarnedBHD") or 0) for row in payable_rows)
    employee_count = len(payable_rows)
    loan_balance = float(
        loan_summary.get("TotalOutstanding")
        if loan_summary and loan_summary.get("TotalOutstanding") is not None
        else sum(float(loan.get("RemainingBalance") or 0) for loan in loans if str(loan.get("Status") or "").lower() != "settled")
    )
    opening = sum(float(row.get("OpeningBalanceBHD") or 0) for row in payable_rows)
    company_paid = sum(float(item.get("CompanyPaid") or 0) for item in allocations)

    return {
        "payableAmount": payable_amount,
        "currentYearEarned": current_year_earned,
        "employeeCount": employee_count,
        "loanBalance": loan_balance,
        "opening": opening,
        "companyPaid": company_paid,
        "verificationStatus": verification.get("summary", {}).get("VerificationStatus", "Ready"),
    }


def extract_metric_text(page, test_id: str) -> str:
    return page.locator(f'[data-testid="{test_id}"] strong').inner_text().strip()


def run():
    login_result = login()
    token = login_result["token"]
    session_id = login_result["sessionId"]
    expected = build_expected_metrics(token, session_id)
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
        "year": YEAR,
        "expected": expected,
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
            page.wait_for_timeout(1800)

            payable_text = extract_metric_text(page, "metric-payable")
            current_text = extract_metric_text(page, "metric-current-earned")
            employees_text = extract_metric_text(page, "metric-employees")
            loans_text = extract_metric_text(page, "metric-loans")

            page.get_by_role("button", name="Open notifications").click()
            notifications_visible = page.get_by_label("Notification center", exact=True).is_visible()

            refresh_button = page.get_by_role("button", name="Refresh overview data")
            refresh_button.focus()
            page.keyboard.press("Enter")
            page.wait_for_timeout(900)

            if viewport["width"] <= 1120:
                page.get_by_role("button", name="Navigation").click()
                page.locator('[data-nav-surface="mobile"][data-nav-key="employees"]').click()
                heading_text = page.locator("h1").inner_text().strip()
                page.goto(UI_BASE, wait_until="domcontentloaded")
                page.wait_for_timeout(1800)
            else:
                page.locator('[data-nav-surface="desktop"][data-nav-key="employees"]').click()
                page.locator('[data-nav-surface="desktop"][data-nav-key="overview"]').click()
                page.wait_for_timeout(1800)
                heading_text = page.locator("h1").inner_text().strip()
            overflow_ok = page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")

            screenshot_path = ARTIFACT_DIR / f"{name}.png"
            page.screenshot(path=str(screenshot_path), full_page=False)

            report["viewports"][name] = {
                "viewport": viewport,
                "rendered": {
                    "payable": normalize_ui_text(payable_text),
                    "currentYearEarned": normalize_ui_text(current_text),
                    "employeeCount": normalize_ui_text(employees_text),
                    "loanBalance": normalize_ui_text(loans_text),
                },
                "matchesExpected": {
                    "payable": normalize_ui_text(payable_text) == money_format(expected["payableAmount"]),
                    "currentYearEarned": normalize_ui_text(current_text) == money_format(expected["currentYearEarned"]),
                    "employeeCount": normalize_ui_text(employees_text) == str(expected["employeeCount"]),
                    "loanBalance": normalize_ui_text(loans_text) == money_format(expected["loanBalance"]),
                },
                "notificationsVisible": notifications_visible,
                "headingAfterNavReturn": heading_text,
                "noHorizontalOverflow": overflow_ok,
                "screenshot": str(screenshot_path),
            }

            context.close()

        browser.close()

    return report


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
