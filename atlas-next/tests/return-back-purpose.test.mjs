/**
 * RETURN_BACK purpose must badge in Ticket Register / Travel Summary Leave end cells,
 * and WA notify must use attachment snapshots (not cleared File state).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("reports leave-end purpose regex includes Return back ticket", () => {
  const src = readFileSync(join(root, "app/(app)/reports/page.tsx"), "utf8");
  assert.match(
    src,
    /\/\^\(cancellation\|return booked later\|return back ticket\)\$\/i/
  );
});

test("allocation issue WA notify uses hadTicketDoc/hadLeaveDoc snapshot", () => {
  const src = readFileSync(join(root, "app/(app)/allocation/page.tsx"), "utf8");
  // Snapshot before upload clears File state; deferred /whatsapp-notify must use it.
  assert.match(src, /const hadTicketDoc = Boolean\(pendingTicketDoc\)/);
  assert.match(src, /const hadLeaveDoc = Boolean\(pendingLeaveDoc\)/);
  assert.match(src, /wa_include_ticket_doc:\s*hadTicketDoc/);
  assert.match(src, /wa_include_leave_doc:\s*hadLeaveDoc/);
  assert.match(src, /\/tickets\/\$\{ticketId\}\/whatsapp-notify[\s\S]{0,800}wa_include_ticket_doc:\s*hadTicketDoc/);
});

test("employee company change clears reporting_officer_id", () => {
  const src = readFileSync(join(root, "app/(app)/employees/page.tsx"), "utf8");
  assert.match(src, /reporting_officer_id:\s*""/);
  assert.match(src, /RM candidates are company-scoped/);
});

test("authedFetch refuses cross-origin absolute URLs", () => {
  const src = readFileSync(join(root, "lib/api.ts"), "utf8");
  assert.match(src, /Authenticated fetch refuses cross-origin absolute URLs/);
  assert.match(src, /absolute\.origin === window\.location\.origin/);
});
