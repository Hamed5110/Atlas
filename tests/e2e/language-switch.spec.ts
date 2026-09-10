import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("EN / AR language switch", () => {
  test("login switcher sets Arabic RTL", async ({ page }) => {
    await page.goto("/login/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      try {
        localStorage.removeItem("atlas.locale");
      } catch {
        /* ignore */
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("language-switcher")).toBeVisible();
    await page.getByTestId("lang-ar").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.getByTestId("btn-sign-in")).toHaveText("دخول");
    await expect(page.getByLabel("اسم المستخدم")).toBeVisible();
  });

  test("sidebar nav and page header translate after Arabic switch", async ({ page }) => {
    await page.goto("/login/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      try {
        localStorage.removeItem("atlas.locale");
      } catch {
        /* ignore */
      }
    });
    await signIn(page);
    await expect(page.getByTestId("language-switcher")).toBeVisible();
    await page.getByTestId("lang-ar").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("nav-dashboard")).toContainText("لوحة التحكم");
    await expect(page.getByTestId("nav-ess")).toContainText("طلبات الخدمة الذاتية");
    await page.goto("/dashboard/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "لوحة التحكم" })).toBeVisible();
    await page.getByTestId("lang-en").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByTestId("nav-dashboard")).toContainText("Dashboard");
  });
});
