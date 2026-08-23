import { test, expect } from "@playwright/test";

test("health live endpoint on port 3389", async ({ request }) => {
  const response = await request.get("/health/live");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "alive" });
});

test("metrics endpoint exposes prometheus payload", async ({ request }) => {
  const response = await request.get("/metrics");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
});
