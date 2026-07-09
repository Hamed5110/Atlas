from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "artifacts" / "step7-signin-module"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

UI_BASE = os.environ.get("ATLAS_V2_TEST_URL", "http://127.0.0.1:3362/v2/")
USERNAME = os.environ.get("ATLAS_TEST_USERNAME", "sa")
PASSWORD = os.environ.get("ATLAS_TEST_PASSWORD", "Atlas@25")

VIEWPORTS = [
    ("desktop", {"width": 1440, "height": 900}),
    ("mobile", {"width": 390, "height": 844}),
]


def run():
    report = {
        "uiBase": UI_BASE,
        "viewports": {},
        "consoleErrors": [],
    }

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for name, viewport in VIEWPORTS:
            context = browser.new_context(viewport=viewport)
            context.add_init_script(
                """
                window.localStorage.removeItem('atlas.session');
                window.localStorage.removeItem('atlas.v2.theme');
                """
            )
            page = context.new_page()
            page.on("console", lambda message: report["consoleErrors"].append(f"{name}:{message.type}:{message.text}"))
            page.goto(UI_BASE, wait_until="domcontentloaded")
            page.wait_for_timeout(1500)

            sign_in_heading = page.get_by_role("heading", name="Sign in to open the V2 workspace.").is_visible()

            theme_select = page.locator("select[aria-label='Theme selection']")
            theme_select.select_option("emerald-command")
            page.get_by_role("button", name="Save theme").click()
            page.wait_for_timeout(300)

            page.locator('[data-testid="v2-login-username"]').fill(USERNAME)
            page.locator('[data-testid="v2-login-password"]').fill(PASSWORD)
            page.locator('[data-testid="v2-login-submit"]').click()
            page.wait_for_timeout(2200)

            overview_heading = page.get_by_role("heading", name="Command metrics, clean decisions.").is_visible()
            theme_restored = page.locator("select[aria-label='Theme selection']").input_value()
            session_saved = page.evaluate("() => Boolean(window.localStorage.getItem('atlas.session'))")

            if viewport["width"] <= 1120:
                page.get_by_role("button", name="Navigation").click()
                page.locator('[data-nav-surface="mobile"][data-nav-key="employees"]').click()
            else:
                page.locator('[data-nav-surface="desktop"][data-nav-key="employees"]').click()
            page.wait_for_timeout(1500)

            employees_heading = page.get_by_role("heading", name="Employee workspace, now on live data.").is_visible()
            overflow_ok = page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")

            screenshot_path = ARTIFACT_DIR / f"{name}.png"
            page.screenshot(path=str(screenshot_path), full_page=False)

            report["viewports"][name] = {
                "viewport": viewport,
                "signinScreenVisible": sign_in_heading,
                "overviewLoadedAfterSignin": overview_heading,
                "employeesLoadedAfterSignin": employees_heading,
                "themeSavedValue": theme_restored,
                "sessionSaved": session_saved,
                "noHorizontalOverflow": overflow_ok,
                "screenshot": str(screenshot_path),
            }

            context.close()

        browser.close()

    return report


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
