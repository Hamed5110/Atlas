import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Dashboard surfaces airfare amount balance KPI", () => {
  const page = readFileSync(join(root, "app/(app)/dashboard/page.tsx"), "utf8");
  assert.match(page, /data-testid="dashboard-amount-balance"/);
  assert.match(page, /ins\.amountBalance/);
  assert.match(page, /airfare-amount-balance/);
  assert.match(page, /\/reports\/detail\/airfare-amount-balance/);
  assert.match(page, /Total Available Funds/);
});

test("Ticket register report greens returned leave rows", () => {
  const page = readFileSync(join(root, "app/(app)/reports/page.tsx"), "utf8");
  assert.match(page, /leaveReturned/);
  assert.match(page, /color-success-muted/);
  assert.match(page, /name: "travel-summary"/);
  assert.match(page, /name: "ticket-cost"/);
  assert.doesNotMatch(page, /"Leave start date"/);
  const cols = page.match(
    /const TICKET_REGISTER_LEAVE_COLUMNS = \[([\s\S]*?)\] as const/
  );
  assert.ok(cols, "TICKET_REGISTER_LEAVE_COLUMNS missing");
  // Classic Department and Emp. Department stay off the travel leave columns.
  assert.doesNotMatch(cols[1], /"Department"/);
  assert.doesNotMatch(cols[1], /"Emp\. Department"/);
  assert.match(page, /\/reports\/detail\/\$\{selected\}/);
  assert.match(page, /live MSSQL via \/reports\/detail/);
  assert.match(page, /"Duration"/);
  assert.doesNotMatch(page, /Days remaining \(back\)/);
  assert.match(page, /leaveEndDateCol/);
  assert.match(page, /color-destructive/);
  assert.match(page, /leaveStatusVariant/);
  assert.match(page, /Return \/ cancel on/);
  assert.match(page, /"Duration"/);
  assert.match(page, /"Sub Section"/);
  assert.match(page, /"Emp Code"/);
  assert.match(page, /Airfare balance deduction/);
  const ticketCostFilters = page.match(/"ticket-cost": \[([\s\S]*?)\],/);
  assert.ok(ticketCostFilters, "ticket-cost filter block missing");
  assert.doesNotMatch(ticketCostFilters[1], /empDepartments/);
  assert.doesNotMatch(ticketCostFilters[1], /"Emp\. Department"/);
  const order = cols[1];
  assert.ok(
    order.indexOf("Sub Section") < order.indexOf("Emp Code") &&
      order.indexOf("Emp Code") < order.indexOf("Employee Name"),
    "identity columns must lead: Sub Section → Emp Code → Employee Name"
  );
});

test("Dashboard insights type includes amount_balance", () => {
  const types = readFileSync(join(root, "lib/types.ts"), "utf8");
  assert.match(types, /amount_balance:\s*string/);
});
