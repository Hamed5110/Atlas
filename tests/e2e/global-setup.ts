import fs from "fs";
import path from "path";
import type { FullConfig } from "@playwright/test";

function loadDotEnv() {
  const envPath = path.resolve(__dirname, "../../.env");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function waitForHealth(baseURL: string, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseURL}/health/live`);
      if (response.ok) return;
    } catch (_error) {
      // Server still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`API did not become healthy at ${baseURL}/health/live`);
}

async function globalSetup(config: FullConfig) {
  loadDotEnv();
  const baseURL = config.projects[0]?.use?.baseURL || "http://127.0.0.1:3389";
  const password =
    process.env.AIRFARE_BOOTSTRAP_ADMIN_PASSWORD || "StrongPassword!2026";
  await waitForHealth(baseURL);
  const response = await fetch(`${baseURL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Playwright auth setup failed (${response.status}): ${detail}`);
  }
  const tokens = await response.json();
  const authState = {
    cookies: [],
    origins: [
      {
        origin: baseURL,
        localStorage: [{ name: "airfare_theme", value: "light" }],
        sessionStorage: [
          { name: "airfare_access_token", value: tokens.access_token },
          { name: "airfare_refresh_token", value: tokens.refresh_token },
        ],
      },
    ],
  };
  fs.writeFileSync(path.resolve(__dirname, "auth.json"), JSON.stringify(authState, null, 2));
}

export default globalSetup;
