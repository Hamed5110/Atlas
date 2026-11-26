/**
 * Live check: tickets+leave produce leave-focused register (no fare amounts).
 * Run: node scripts/verify-ticket-register-leave.mjs
 */
import assert from "node:assert/strict";

const base = process.env.AIRFARE_BASE || "http://127.0.0.1:3389";

async function login() {
  // Prefer env; fall back to reading bootstrap from a tiny health-only path is impossible —
  // this script expects AIRFARE_USER / AIRFARE_PASS or uses probe via existing cookie-less login.
  const user = process.env.AIRFARE_USER || "admin";
  const pass = process.env.AIRFARE_PASS;
  if (!pass) {
    console.log("SKIP_LOGIN_NO_PASS set AIRFARE_PASS to verify live");
    return null;
  }
  const r = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const body = await r.text();
  assert.equal(r.status, 200, body);
  return JSON.parse(body).access_token;
}

function remaining(start, end, returnedOn, asOf) {
  if (!start || !end) return { status: "", days: "" };
  if (returnedOn) return { status: "returned", days: 0 };
  const endDate = new Date(`${end}T00:00:00`);
  const asOfDate = new Date(`${asOf}T00:00:00`);
  const startDate = new Date(`${start}T00:00:00`);
  const due = new Date(endDate);
  due.setDate(due.getDate() + 1);
  const days = Math.round((due - asOfDate) / 86400000);
  if (asOfDate < startDate) return { status: "upcoming", days };
  if (asOfDate <= endDate) return { status: "on_leave", days };
  return { status: "overdue", days };
}

const EXPECTED = [
  "Sub Section",
  "Emp Code",
  "Employee Name",
  "Trip type",
  "Travel date",
  "Leave end date",
  "Duration",
  "Leave status",
  "Return / cancel on",
  "Application status",
];

async function main() {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../app/(app)/reports/page.tsx", import.meta.url), "utf8")
  );
  assert.match(src, /\/reports\/detail\/\$\{selected\}/);
  assert.match(src, /live MSSQL via \/reports\/detail/);
  assert.match(src, /name: "travel-summary"/);
  assert.match(src, /name: "ticket-cost"/);
  assert.match(src, /name: "ticket-standard"/);
  assert.doesNotMatch(src, /return fetchTicketRegisterLeaveFocused/);
  console.log("SOURCE_OK travel registers use MSSQL /reports/detail");

  const tok = await login();
  if (!tok) return;
  const h = { Authorization: `Bearer ${tok}` };
  for (const name of ["ticket-register", "travel-summary", "ticket-cost", "ticket-standard"]) {
    const detail = await fetch(`${base}/v1/reports/detail/${name}`, { headers: h }).then((r) => {
      assert.equal(r.status, 200, `${name} status`);
      return r.json();
    });
    assert.ok(Array.isArray(detail.columns), `${name} columns`);
    assert.ok(Array.isArray(detail.rows), `${name} rows`);
    if (name === "ticket-register") {
      assert.deepEqual(detail.columns, EXPECTED);
    }
    console.log("LIVE_OK", {
      report: name,
      count: detail.count ?? detail.rows.length,
      columns: detail.columns,
      sample: detail.rows[0] || null,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
