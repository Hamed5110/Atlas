import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = () => readFileSync(join(root, "app/(app)/allocation/page.tsx"), "utf8");
const css = () => readFileSync(join(root, "app/globals.css"), "utf8");
const pkg = () => readFileSync(join(root, "package.json"), "utf8");
const table = () =>
  readFileSync(join(root, "components", "allocation-register-table.tsx"), "utf8");

const esc = (token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("prebuild writes public/BUILD_STAMP.txt into the static export", () => {
  assert.match(pkg(), /"prebuild": "node scripts\/write-build-stamp\.mjs"/);
  const script = readFileSync(join(root, "scripts/write-build-stamp.mjs"), "utf8");
  assert.match(script, /BUILD_STAMP\.txt/);
  assert.match(script, /public/);
});

test("register uses fixed-column ticket-register grid (no header drift)", () => {
  const src = table();
  const styles = css();
  assert.match(src, /className="table-cards ticket-register/);
  assert.match(src, /<colgroup>/);
  assert.match(styles, /\.ticket-register\s*\{/);
  assert.match(styles, /table-layout:\s*fixed/);
});

test("register money columns carry full mobile data-labels (table-cards pattern)", () => {
  const src = table();
  for (const token of [
    'data-label="Ticket amount"',
    'data-label="Total available funds"',
    'data-label="Payment option"',
    'data-label="Loan"',
    'data-label="Company pays"',
    'data-label="Employee pays"',
    'data-label="Airfare balance deduction"',
    'data-label="Net amount"',
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
  assert.doesNotMatch(src, /data-label="Route"/);
  assert.match(src, /origin_code\}→\{t\.destination_code\}/);
});

test("ticket-register CSS fits without wide H-scroll", () => {
  const styles = css();
  assert.match(styles, /min-width:\s*56rem/);
  assert.match(styles, /position:\s*sticky/);
});

test("page uses classic register table only (no Soft UI cards toggle)", () => {
  const src = page();
  assert.match(src, /AllocationRegisterTable/);
  assert.doesNotMatch(src, /AllocationPowerCards/);
  assert.doesNotMatch(src, /register-view-toggle/);
  assert.doesNotMatch(src, /registerView/);
});

test("WhatsApp attach is simple: A4 always on, optional ticket/leave files only", () => {
  const src = page();
  assert.match(src, /wa_include_slip:\s*true/);
  assert.match(src, /wa_include_ticket_doc:\s*Boolean\(pendingTicketDoc\)/);
  assert.match(src, /wa_include_leave_doc:\s*Boolean\(pendingLeaveDoc\)/);
  assert.doesNotMatch(src, /setWaPackSlip/);
  assert.doesNotMatch(src, /wa-pack-slip/);
  assert.match(src, /data-testid="panel-issue-attachments"/);
  assert.match(src, /Attach documents \(optional\)/);
});

test("money cells keep tabular-nums end alignment via desk-num", () => {
  const src = table();
  const deskNums = src.split("desk-num").length - 1;
  assert.ok(deskNums >= 7, `expected >= 7 desk-num cells, got ${deskNums}`);
});

test("approval desk defaults match title (submitted + approval)", () => {
  const src = page();
  assert.match(src, /useState\("submitted"\)/);
  assert.match(src, /useState<"approval" \| "payment" \| "all">\("approval"\)/);
});

test("register actions stay Submit/Re-open only — Approve/Reject live on Dashboard", () => {
  const src = page();
  const workflow = src.slice(src.indexOf("const WORKFLOW"), src.indexOf("function paymentOptionLabel"));
  assert.doesNotMatch(workflow, /next: "approved"/);
  assert.doesNotMatch(workflow, /next: "rejected"/);
  assert.match(workflow, /submitted: \[\]/);
  assert.match(workflow, /approved: \[\]/);
});
