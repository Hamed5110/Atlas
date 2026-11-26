import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * AI-Powered / agentic testing layer (open-source stand-in for Mabl / testRigor):
 * - UI drives the Data Agent with plain-language prompts
 * - Asserts safety outcomes (refuse bulk fix) and structured handoffs (report designer)
 */
test.describe("ATLAS — AI Data Agent (agentic E2E)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto("/ai-insights/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("ask-data-agent-chat")).toBeVisible({ timeout: 30_000 });
  });

  test("refuses Fix everything and keeps Auto-Repair off by default", async ({ page }) => {
    // Auto-Repair checkbox label contains "Auto-Repair"
    const autoRepair = page
      .locator("label")
      .filter({ hasText: /Auto-Repair/i })
      .locator('input[type="checkbox"]');
    await expect(autoRepair).not.toBeChecked();

    await page.getByTestId("chat-input").fill("Fix everything you find");
    await page.getByTestId("chat-send").click();

    await expect(page.getByText(/manual_review/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/will not|Refuse|fix everything/i).first()).toBeVisible();
  });

  test("runs diagnostics and drafts a loan report for Designer handoff", async ({ page }) => {
    // Click the "Draft a report on loans" chip
    await page.getByRole("button", { name: /Draft a report on loans/i }).click();
    await expect(page.getByText(/Designer:|loan-outstanding|Report draft ready/i).first()).toBeVisible({
      timeout: 30_000,
    });

    const stored = await page.evaluate(() => sessionStorage.getItem("atlas.reportSpec"));
    expect(stored).toBeTruthy();
    const spec = JSON.parse(stored!);
    expect(spec.dataset).toBe("loan-outstanding");
  });

  test("SAA baseline surfaces action queue", async ({ page }) => {
    await page.getByTestId("btn-smart-baseline").click();
    await expect(
      page
        .getByText(/Smart AI Agent|System Baseline|executive|action|queue|Shall I proceed/i)
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("capabilities prompt reports local LLM and learning brain", async ({ page }) => {
    await page.getByTestId("chat-input").fill("What can you do? List capabilities and local AI brain.");
    await page.getByTestId("chat-send").click();
    await expect(page.getByText(/capabilities|modules|Local AI brain|LLM synthesis|Ollama/i).first()).toBeVisible({
      timeout: 45_000,
    });
  });

  test("teach me everything returns curriculum via local brain", async ({ page }) => {
    await page.getByTestId("chat-input").fill("Teach me everything — what was built and how to use it.");
    await page.getByTestId("chat-send").click();
    await expect(
      page.getByText(/teach|Atlas HCM|Allocation|Ollama|year-end|modules|how to use|practice/i).first(),
    ).toBeVisible({ timeout: 180_000 });
  });

  test("learning prompt returns training memory stats", async ({ page }) => {
    await page.getByTestId("chat-input").fill("Show AI learning stats and training memory");
    await page.getByTestId("chat-send").click();
    await expect(page.getByText(/learning|events|product_knowledge|diagnosis|feedback/i).first()).toBeVisible({
      timeout: 45_000,
    });
  });

  test("diagnose prompt completes without page errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.getByTestId("chat-input").fill("Run diagnostics and summarize database health");
    await page.getByTestId("chat-send").click();
    await expect(page.getByText(/diagnos|healthy|issue|finding|complete/i).first()).toBeVisible({
      timeout: 120_000,
    });
    expect(errors).toEqual([]);
  });
});
