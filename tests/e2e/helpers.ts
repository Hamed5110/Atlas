import { expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const username = process.env.ATLAS_E2E_USERNAME || "admin";
const password = process.env.ATLAS_E2E_PASSWORD || "";
const authSeedPath =
  process.env.ATLAS_E2E_AUTH_SEED || join(process.cwd(), "tests", "e2e", ".auth.json");

function loadAuthSeed(): Record<string, unknown> | null {
  if (!existsSync(authSeedPath)) return null;
  try {
    return JSON.parse(readFileSync(authSeedPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Shared login helper for atlas-next static export served by FastAPI. */
export async function signIn(page: Page): Promise<void> {
  const seed = loadAuthSeed();
  if (seed?.access_token) {
    await page.goto("/login/", { waitUntil: "domcontentloaded" });
    await page.evaluate((session) => {
      sessionStorage.setItem("atlas.hcm.session", JSON.stringify(session));
    }, seed);
    await page.goto("/dashboard/", { waitUntil: "domcontentloaded" });
    // Wait for shell, not only URL — expired seeds bounce back to /login/.
    await expect(page.getByTestId("nav-main")).toBeVisible({ timeout: 30_000 });
    if (/login/i.test(page.url())) {
      throw new Error("Auth seed rejected — re-run: python C:\\HCM Airfare\\tests\\write_e2e_auth_seed.py");
    }
    return;
  }

  if (!password) {
    throw new Error(
      "Set ATLAS_E2E_PASSWORD or run: python C:\\HCM Airfare\\tests\\write_e2e_auth_seed.py"
    );
  }

  await page.goto("/login/", { waitUntil: "domcontentloaded" });
  if (page.url().includes("/dashboard")) return;

  await expect(page.getByRole("heading", { name: /Welcome back/i })).toBeVisible();
  await page.getByLabel(/Username/i).fill(username);
  await page.getByLabel(/Password/i).fill(password);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await expect(page.getByTestId("nav-main")).toBeVisible({ timeout: 30_000 });
}
