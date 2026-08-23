import { defineConfig, devices } from "@playwright/test";
import path from "path";

const skipWebServer = !!process.env.PLAYWRIGHT_SKIP_WEBSERVER;
const isCi = !!process.env.CI;
const repoRoot = path.resolve(__dirname, "../..");

/** Cross-platform API boot: uvicorn in CI/Linux; start-api.ps1 on local Windows. */
function webServerCommand(): string {
  if (process.env.PLAYWRIGHT_WEBSERVER_COMMAND) {
    return process.env.PLAYWRIGHT_WEBSERVER_COMMAND;
  }
  if (isCi || process.platform !== "win32") {
    return "python -m uvicorn airfare_management.api.main:app --host 127.0.0.1 --port 3389";
  }
  return "powershell -NoProfile -ExecutionPolicy Bypass -File .\\start-api.ps1";
}

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: isCi ? 1 : undefined,
  globalSetup: require.resolve("./global-setup.ts"),
  reporter: isCi
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:3389",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    storageState: "auth.json",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // Visual baselines are OS-specific (captured on Windows); skip in Linux CI.
      testIgnore: isCi ? ["**/ui/**/*.visual.spec.ts"] : undefined,
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: webServerCommand(),
        cwd: repoRoot,
        url: "http://127.0.0.1:3389/health/live",
        reuseExistingServer: !isCi,
        timeout: 180_000,
        env: {
          ...process.env,
          PYTHONPATH: path.join(repoRoot, "src"),
          AIRFARE_ENVIRONMENT: process.env.AIRFARE_ENVIRONMENT || "test",
          AIRFARE_DATABASE_URL:
            process.env.AIRFARE_DATABASE_URL || "sqlite+pysqlite:///./var/e2e.db",
          AIRFARE_JWT_SECRET:
            process.env.AIRFARE_JWT_SECRET || "ci-e2e-jwt-secret-minimum-32-chars!!",
          AIRFARE_BOOTSTRAP_ADMIN_PASSWORD:
            process.env.AIRFARE_BOOTSTRAP_ADMIN_PASSWORD || "StrongPassword!2026",
        },
      },
});
