/** Dashboard rows open one record: the ticket document, the employee, or the loan. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

test("record links point at one ticket document, employee, or loan", () => {
  const links = read("lib/record-links.ts");
  assert.match(links, /\/allocation\?ticket=\$\{encodeURIComponent\(ticketId\)\}&view=documents/);
  assert.match(links, /\/employees\?edit=/);
  assert.match(links, /\/loans\?loan=/);
  assert.match(links, /\/ess\?request=/);
});

test("upcoming travel and recent tickets use the ticket document link", () => {
  const widgets = read("components/dashboard/insight-widgets.tsx");
  const page = read("app/(app)/dashboard/page.tsx");
  assert.match(widgets, /ticketDocumentPath\(trip\.id\)/);
  assert.match(widgets, /employeeRecordPath\(item\.employee_id\)/);
  assert.match(widgets, /loanRecordPath\(loan\.id\)/);
  assert.match(page, /ticketDocumentPath\(ticket\.id\)/);
  assert.match(read("app/(app)/allocation/page.tsx"), /deepView !== "documents"/);
  assert.match(read("app/(app)/loans/page.tsx"), /searchParams\.get\("loan"\)/);
});
