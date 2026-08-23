import { test, expect } from "../fixtures/auth";

test("ticket kanban columns align", async ({ page }) => {
  await page.goto("/");
  await page.locator('nav .nav-button[data-module="tickets"]').click();
  await expect(page.locator("#topbar-title")).toHaveText("Tickets");
  await expect(page.locator(".ticket-board .board-column").first()).toBeVisible();
  await expect(page).toHaveScreenshot("ticket-kanban.png", { maxDiffPixelRatio: 0.02 });
});
