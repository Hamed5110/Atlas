from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import Locator, sync_playwright


BASE_URL = "http://127.0.0.1:3361/v2/"
ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "artifacts" / "step6-v2-shell"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

VIEWPORTS = [
    ("desktop", {"width": 1440, "height": 900}),
    ("tablet", {"width": 1024, "height": 768}),
    ("mobile", {"width": 390, "height": 844}),
]


def inspect_control(locator: Locator, label: str) -> dict:
    count = locator.count()
    if count != 1:
        return {
            "label": label,
            "count": count,
            "clickable": False,
            "reason": f"expected 1 match, found {count}",
        }

    result = locator.evaluate(
        """(element) => {
          const rect = element.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const top = document.elementFromPoint(cx, cy);
          const style = getComputedStyle(element);
          return {
            tag: element.tagName,
            text: (element.textContent || '').trim(),
            pointerEvents: style.pointerEvents,
            zIndex: style.zIndex,
            width: rect.width,
            height: rect.height,
            hitMatches: !!top && (top === element || element.contains(top) || top.contains(element)),
          };
        }"""
    )
    result["label"] = label
    result["count"] = count
    result["clickable"] = (
        result["pointerEvents"] == "auto"
        and result["width"] > 0
        and result["height"] > 0
        and result["hitMatches"]
    )
    return result


def no_horizontal_overflow(page) -> bool:
    return page.evaluate(
        "() => document.documentElement.scrollWidth <= window.innerWidth + 1"
    )


def run() -> dict:
    report: dict[str, object] = {
        "baseUrl": BASE_URL,
        "viewports": {},
        "themePersistence": {},
        "consoleErrors": [],
    }

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        page.on("console", lambda message: report["consoleErrors"].append(f"{message.type}: {message.text}"))
        page.goto(BASE_URL, wait_until="domcontentloaded")

        for name, viewport in VIEWPORTS:
            page.set_viewport_size(viewport)
            page.goto(BASE_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(300)
            page.evaluate(
                """() => {
                  window.localStorage.setItem('atlas.v2.theme', 'light-professional');
                }"""
            )
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(300)

            sidebar_toggle = page.locator(
                'button[aria-label="Collapse sidebar"], button[aria-label="Expand sidebar"]'
            )
            search = page.get_by_placeholder("Search modules, actions, or workflow names")
            theme_select = page.get_by_label("Theme selection", exact=True)
            save_theme = page.get_by_role("button", name="Save theme")
            notifications = page.get_by_role("button", name="Open notifications")

            controls = [
                inspect_control(sidebar_toggle, "sidebar toggle"),
                inspect_control(search, "global search"),
                inspect_control(theme_select, "theme select"),
                inspect_control(save_theme, "save theme"),
                inspect_control(notifications, "notifications"),
            ]

            if viewport["width"] <= 1120:
                controls.append(inspect_control(page.get_by_role("button", name="Navigation"), "mobile navigation"))
            else:
                controls.append(inspect_control(page.get_by_role("button", name="Overview"), "desktop navigation"))

            search.fill("")
            search.fill(f"{name} search")
            search_value = search.input_value()

            theme_select.select_option("dark-professional")
            save_theme.click()
            saved_theme = page.locator('[data-theme="dark-professional"]').count() == 1

            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(500)
            persisted_theme = page.locator('[data-theme="dark-professional"]').count() == 1
            persisted_select = page.get_by_label("Theme selection", exact=True).input_value()

            page.get_by_role("button", name="Open notifications").click()
            notifications_visible = page.get_by_label("Notification center", exact=True).is_visible()

            if viewport["width"] <= 1120:
                page.get_by_role("button", name="Navigation").click()
                page.get_by_role("button", name="Employees").click()
            else:
                page.get_by_role("button", name="Employees").click()

            heading_text = page.locator("h1").inner_text()
            keyboard_focus_ok = False
            save_theme.focus()
            try:
                page.keyboard.press("Enter")
                keyboard_focus_ok = True
            except Exception:
                keyboard_focus_ok = False

            screenshot_path = ARTIFACT_DIR / f"{name}.png"
            page.screenshot(path=str(screenshot_path), full_page=False)

            report["viewports"][name] = {
                "viewport": viewport,
                "noHorizontalOverflow": no_horizontal_overflow(page),
                "controls": controls,
                "searchValue": search_value,
                "themeAppliedAfterSave": saved_theme,
                "themePersistedAfterReload": persisted_theme,
                "themeSelectValueAfterReload": persisted_select,
                "notificationsVisible": notifications_visible,
                "navigationHeading": heading_text,
                "keyboardEnterOnSaveTheme": keyboard_focus_ok,
                "screenshot": str(screenshot_path),
            }

        browser.close()

    return report


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
