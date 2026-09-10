import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("smart actions panel is visible and interactive", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("nav-ai-insights").click();
  await expect(page.getByTestId("ai-insights-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("panel-local-ollama")).toBeVisible();
  await expect(page.getByTestId("badge-ollama-status")).toBeVisible();
  await expect(page.getByTestId("btn-check-ollama")).toBeVisible();
  await expect(page.getByTestId("btn-ollama-teach")).toBeVisible();
  await expect(page.getByTestId("section-smart-actions")).toBeVisible();
  await expect(page.getByTestId("btn-smart-baseline")).toBeVisible();
  await expect(page.getByTestId("ask-data-agent-chat")).toBeVisible();
  await expect(page.getByTestId("panel-entitlement-reconciliation")).toBeVisible();
});

test("local Ollama status check reports online or help text", async ({ page }) => {
  await signIn(page);
  await page.goto("/ai-insights/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("panel-local-ollama")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("btn-check-ollama").click();
  const status = page.getByTestId("badge-ollama-status");
  await expect(status).toBeVisible();
  // Either Online (preferred) or Offline with install hint
  const text = (await status.textContent()) || "";
  if (/online/i.test(text)) {
    await expect(page.getByTestId("badge-ollama-model")).toContainText(/qwen|deepseek|llama|model/i);
  } else {
    await expect(page.getByTestId("text-ollama-help")).toBeVisible();
    await expect(page.getByTestId("text-ollama-help")).toContainText(/qwen2\.5:3b-instruct/i);
  }
});
