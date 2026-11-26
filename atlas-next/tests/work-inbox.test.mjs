import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("dashboard shows the work inbox above the leave tracker", () => {
  const page = read("app/(app)/dashboard/page.tsx");
  const inbox = page.indexOf("<WorkInbox");
  const leave = page.indexOf("<LeaveTracker");
  assert.ok(inbox > 0 && leave > inbox);
  assert.match(page, /from "@\/components\/dashboard\/work-inbox"/);
});

test("inbox items open the screen that can act on them", () => {
  const source = read("components/dashboard/work-inbox.tsx");
  assert.match(source, /api<WorkInboxResult>\("\/work"\)/);
  for (const kind of [
    "document_expired",
    "ess_review",
    "ess_ready",
    "ticket_review",
    "leave_overdue",
    "loan_overdue",
  ]) {
    assert.match(source, new RegExp(kind));
  }
  assert.match(source, /router\.push\(openHref\(item\.href\)\)/);
  assert.match(source, /status === 404\) return null/);
});

test("leave tracker can be opened from an inbox link", () => {
  assert.match(read("components/dashboard/leave-tracker.tsx"), /id="leave-tracker"/);
});

test("ESS accepts the same ?q= deep link as employees and loans", () => {
  assert.match(read("app/(app)/ess/page.tsx"), /searchParams\.get\("q"\)/);
  assert.match(read("app/(app)/ess/page.tsx"), /searchParams\.get\("request"\)/);
  assert.match(read("app/(app)/ess/page.tsx"), /setSearch\(deepQuery\)/);
});
