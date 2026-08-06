const assert = require("assert");

const baseUrl = process.env.ATLAS_LIVE_API_BASE || "http://127.0.0.1:3356/api";
const username = process.env.ATLAS_E2E_USERNAME;
const password = process.env.ATLAS_E2E_PASSWORD;
const companyId = process.env.ATLAS_E2E_COMPANY_ID || "";
const employeeId = process.env.ATLAS_E2E_EMPLOYEE_ID || "";
const asOfDate = process.env.ATLAS_E2E_AS_OF_DATE || `${new Date().getFullYear()}-12-31`;

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

(async () => {
  if (!username || !password) {
    console.log("Skipped live API test: set ATLAS_E2E_USERNAME and ATLAS_E2E_PASSWORD to run against a live ATLAS server.");
    return;
  }

  const versionResponse = await fetch(`${baseUrl}/version`);
  assert.ok(versionResponse.ok, `/api/version must respond: ${versionResponse.status}`);
  const version = await readJson(versionResponse);
  assert.ok(version.features, "/api/version must expose feature flags");

  const loginResponse = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  assert.ok(loginResponse.ok, `login must succeed: ${loginResponse.status}`);
  const session = await readJson(loginResponse);
  assert.ok(session.token, "login must return token");

  const params = new URLSearchParams({ asOfDate });
  if (companyId) params.set("companyId", companyId);
  if (employeeId) params.set("employeeId", employeeId);
  const balanceResponse = await fetch(`${baseUrl}/airfare/entitlement/balance?${params}`, {
    headers: { Authorization: `Bearer ${session.token}`, "X-Session-Id": session.sessionId || "live-api-test" }
  });
  const balance = await readJson(balanceResponse);
  if (version.features.continuousAirfareEntitlement) {
    assert.ok(balanceResponse.ok, `balance endpoint must succeed when flag is on: ${JSON.stringify(balance)}`);
    assert.equal(balance.mode, "continuous-readonly");
    assert.ok(Array.isArray(balance.rows));
  } else {
    assert.equal(balanceResponse.status, 404, "balance endpoint must be hidden when feature is off");
    assert.equal(balance.code, "FEATURE_DISABLED");
  }

  console.log("Live airfare entitlement API smoke passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
