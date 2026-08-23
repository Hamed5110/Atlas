import { test as base, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

type StorageEntry = { name: string; value: string };

const authPath = path.resolve(__dirname, "../auth.json");
const authState = fs.existsSync(authPath)
  ? JSON.parse(fs.readFileSync(authPath, "utf8"))
  : { origins: [] };
const originState = authState.origins?.[0] || {
  sessionStorage: [] as StorageEntry[],
  localStorage: [] as StorageEntry[],
};

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((payload) => {
      for (const entry of payload.sessionStorage || []) {
        window.sessionStorage.setItem(entry.name, entry.value);
      }
      for (const entry of payload.localStorage || []) {
        window.localStorage.setItem(entry.name, entry.value);
      }
    }, {
      sessionStorage: originState.sessionStorage || [],
      localStorage: originState.localStorage || [],
    });
    await use(page);
  },
});

export { expect };
