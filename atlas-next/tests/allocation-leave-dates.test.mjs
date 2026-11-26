import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("allocation shows leave start/end dates for round trip only", () => {
  const src = read("app/(app)/allocation/page.tsx");
  // Round-trip gated panel with both date inputs.
  assert.match(src, /tripType === "ROUND_TRIP"/);
  assert.match(src, /panel-leave-dates/);
  assert.match(src, /Leave start date/);
  assert.match(src, /Leave end date/);
  assert.match(src, /input-leave-start-date/);
  assert.match(src, /input-leave-end-date/);
  // Switching back to round trip prefills the window from the travel date.
  assert.match(src, /setLeaveStart\(\(cur\) => cur \|\| travelDate\)/);
});

test("allocation issue validates and maps the leave window to the API payload", () => {
  const src = read("app/(app)/allocation/page.tsx");
  // Required-together + ordering guards before issuing.
  assert.match(src, /Leave dates required/);
  assert.match(src, /Leave end date cannot be before the leave start date/);
  // Payload mapping to the backend fields.
  assert.match(src, /leave_start_date: leaveStartVal \|\| undefined/);
  assert.match(src, /leave_end_date: leaveEndVal \|\| undefined/);
});

test("ticket edit dialog round-trips the leave window", () => {
  const src = read("app/(app)/allocation/page.tsx");
  assert.match(src, /leave_start_date: ticket\.leave_start_date/);
  assert.match(src, /leave_end_date: ticket\.leave_end_date/);
  assert.match(src, /input-edit-leave-start-date/);
  assert.match(src, /input-edit-leave-end-date/);
  assert.match(src, /leave_start_date: leaveStart \|\| null/);
  assert.match(src, /leave_end_date: leaveEnd \|\| null/);
});

test("ticket register and print sheet surface the stored leave window", () => {
  const page = read("app/(app)/allocation/page.tsx");
  // Register row meta line shows employee · ticket · travel date; the stored leave
  // window surfaces on the print sheet and the Dashboard Leave Tracker.
  assert.match(page, /fmtDate\([^)]*travel_date\)/);
  const sheet = read("components/allocation-print-sheet.tsx");
  assert.match(sheet, /Leave Dates/);
  assert.match(sheet, /ticket\.leave_start_date/);
  assert.match(sheet, /ticket\.leave_end_date/);
});

test("Ticket type carries optional leave window fields", () => {
  const types = read("lib/types.ts");
  assert.match(types, /leave_start_date\?: string \| null/);
  assert.match(types, /leave_end_date\?: string \| null/);
});
