import assert from "node:assert/strict";

process.env.PORT ||= "3356";
process.env.ATLAS_GREENFIELD_REPOSITORY ||= "mssql";
process.env.DB_SERVER ||= "localhost";
process.env.DB_PORT ||= "1433";
process.env.DB_NAME ||= "AtlasGreenfieldCoreApiTest";

const { start } = await import("../src/server.js");
const server = start();
const baseUrl = `http://127.0.0.1:${process.env.PORT}`;

try {
  await waitForHealth(baseUrl);

  const health = await getJson(`${baseUrl}/api/health`);
  assert.equal(health.status, "ok", "health must be ok");
  assert.equal(health.version, "0.3.0", "live API must expose fresh build version");
  assert.equal(health.repository, "mssql-core", "live API must be backed by MSSQL core repository");
  assert.equal(health.oldRuntimeLinked, false, "live API must not link old runtime");
  assert.equal(health.storage.database, process.env.DB_NAME, "live API must report the active SQL database");

  const summary = await getJson(`${baseUrl}/api/summary?tenantId=11111111-1111-4111-8111-111111111111&companyId=22222222-2222-4222-8222-222222222222&asOfDate=2026-12-31`);
  assert.equal(summary.repository, "mssql-core", "summary must use MSSQL core");
  assert.equal(summary.employees.active >= 1, true, "summary must include seeded employees");
  assert.equal(typeof summary.entitlement.totalBalance, "number", "summary must compute entitlement balance");

  console.log("LIVE MSSQL API TEST PASSED");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await getJson(`${baseUrl}/api/health`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error("Server did not become healthy.");
}

async function getJson(url) {
  const response = await fetch(url);
  const body = await response.text();
  assert.equal(response.ok, true, `${url} failed with ${response.status}: ${body}`);
  return JSON.parse(body);
}
