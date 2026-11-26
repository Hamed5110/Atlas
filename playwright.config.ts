import { defineConfig, devices } from "@playwright/test";

/**
 * ATLAS HCM — modern open-source E2E stack (Playwright).
 * Maps commercial capabilities:
 *   Mabl / testRigor  → agentic API checks + plain-language prompt coverage via AI Data Agent
 *   Applitools        → --project=visual screenshot baselines
 *   Katalon           → this Playwright project (web + API in one runner)
 */
const baseURL = process.env.ATLAS_E2E_BASE_URL || "http://127.0.0.1:3389";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 20_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    },
  },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "test-reports/playwright" }],
    ["./tests/reporters/agent-reporter.ts"],
    ...(process.env.CI ? [["github"] as const] : []),
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      testMatch: /\.spec\.ts$/,
      testIgnore: /atlas-visual-baselines\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "visual",
      testMatch: /atlas-visual-baselines\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
