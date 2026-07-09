from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "artifacts" / "step7-airfare-module"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

API_BASE = os.environ.get("ATLAS_TEST_BASE_URL", "http://127.0.0.1:3355/api")
UI_BASE = os.environ.get("ATLAS_V2_TEST_URL", "http://127.0.0.1:3362/v2/")
USERNAME = os.environ.get("ATLAS_TEST_USERNAME", "sa")
PASSWORD = os.environ.get("ATLAS_TEST_PASSWORD", "Atlas@25")
YEAR = int(os.environ.get("ATLAS_TEST_YEAR", "2026"))

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
    allocations = api_request(f"/allocations?year={YEAR}", token=token, session_id=session_id)
    total_ticket = sum(float(row.get("TicketCost") or 0) for row in allocations)
    company_paid = sum(float(row.get("CompanyPaid") or 0) for row in allocations)
    loan_backed = sum(1 for row in allocations if str(row.get("PaymentMode") or "").lower() == "loan")
    linked_self_service = sum(1 for row in allocations if int(row.get("SelfServiceRequestID") or 0) > 0)
    sample = allocations[0] if allocations else {}
    sample_search = sample.get("EmployeeCode") or sample.get("FullName") or ""
    return {
        "count": len(allocations),
        "ticketTotal": total_ticket,
        "companyPaidTotal": company_paid,
        "loanCount": loan_backed,
        "linkedSelfService": linked_self_service,
        "sampleSearch": sample_search,
    }


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
            page.wait_for_timeout(1600)

            if viewport["width"] <= 1120:
                page.get_by_role("button", name="Navigation").click()
                page.locator('[data-nav-surface="mobile"][data-nav-key="airfare"]').click()
            else:
                page.locator('[data-nav-surface="desktop"][data-nav-key="airfare"]').click()
            page.wait_for_timeout(1800)

            count_text = normalize_ui_text(page.locator('[data-testid="airfare-total-rows"] strong').inner_text())
            ticket_text = normalize_ui_text(page.locator('[data-testid="airfare-ticket-total"] strong').inner_text())
            company_paid_text = normalize_ui_text(page.locator('[data-testid="airfare-company-paid-total"] strong').inner_text())
            loan_text = normalize_ui_text(page.locator('[data-testid="airfare-loan-count"] strong').inner_text())

            search = page.locator('[data-testid="airfare-search"]')
            search.fill(expected["sampleSearch"])
            page.wait_for_timeout(400)
            filtered_rows = page.locator('[data-testid="airfare-row"]').count()

            search.fill("")
            page.locator('[data-testid="airfare-payment-filter"]').select_option("loan")
            page.wait_for_timeout(400)
            loan_rows = page.locator('[data-testid="airfare-row"]').count()

            page.locator('[data-testid="airfare-payment-filter"]').select_option("all")
            page.wait_for_timeout(300)

            refresh_button = page.get_by_role("button", name="Refresh allocation data")
            refresh_button.focus()
            page.keyboard.press("Enter")
            page.wait_for_timeout(900)

            overflow_ok = page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
            heading_text = page.locator("h1").inner_text().strip()

            screenshot_path = ARTIFACT_DIR / f"{name}.png"
            page.screenshot(path=str(screenshot_path), full_page=False)

            report["viewports"][name] = {
                "viewport": viewport,
                "rendered": {
                    "count": count_text,
                    "ticketTotal": ticket_text,
                    "companyPaidTotal": company_paid_text,
                    "loanCount": loan_text,
                },
                "matchesExpected": {
                    "count": count_text == str(expected["count"]),
                    "ticketTotal": ticket_text == money_format(expected["ticketTotal"]),
                    "companyPaidTotal": company_paid_text == money_format(expected["companyPaidTotal"]),
                    "loanCount": loan_text == str(expected["loanCount"]),
                },
                "searchFilteredRows": filtered_rows,
                "loanRowsAfterFilter": loan_rows,
                "heading": heading_text,
                "noHorizontalOverflow": overflow_ok,
                "screenshot": str(screenshot_path),
            }

            context.close()

        browser.close()

    return report


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
