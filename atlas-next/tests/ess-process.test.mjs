import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  addDaysIso,
  describeEssWhatsApp,
  essActor,
  essDeleteNeedsReason,
  essDetailsChanged,
  essFormChecks,
  essLockReason,
  essNotesOnlyReason,
  splitEssNotes,
  essStepIndex,
  essSteps,
  inclusiveLeaveDays,
  isTravelRequest,
} from "../lib/ess-process.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("leave days count both ends and reject reversed or partial windows", () => {
  assert.equal(inclusiveLeaveDays("2026-07-01", "2026-07-30"), 30);
  assert.equal(inclusiveLeaveDays("2026-07-01", "2026-07-01"), 1);
  assert.equal(inclusiveLeaveDays("2026-02-27", "2026-03-02"), 4);
  assert.equal(inclusiveLeaveDays("2026-03-28", "2026-03-30"), 3);
  assert.equal(inclusiveLeaveDays("2026-07-30", "2026-07-01"), null);
  assert.equal(inclusiveLeaveDays("2026-07-01", ""), null);
  assert.equal(inclusiveLeaveDays(null, "2026-07-01"), null);
});

test("process steps: travel requests pass through ticket allocation, loans skip it", () => {
  assert.deepEqual(essSteps("airfare").map((s) => s.key), ["submitted", "approved", "allocated", "paid"]);
  assert.deepEqual(essSteps("loan").map((s) => s.key), ["submitted", "approved", "paid"]);
  assert.equal(essStepIndex("allocated", "ticket"), 2);
  assert.equal(essStepIndex("paid", "loan"), 2);
  assert.equal(essStepIndex("rejected", "airfare"), -1);
  assert.ok(isTravelRequest("ticket"));
  assert.ok(!isTravelRequest("loan"));
});

test("WhatsApp outcomes are explained in plain words for approver and employee", () => {
  assert.equal(describeEssWhatsApp(null), null);
  assert.deepEqual(describeEssWhatsApp({ sent: true, audience: "approver" }), {
    tone: "success",
    text: "WhatsApp sent to the approver.",
  });
  assert.match(describeEssWhatsApp({ queued: true, audience: "employee" }).text, /queued/);
  assert.match(
    describeEssWhatsApp({ sent: false, skipped: "no_number", audience: "employee" }).text,
    /employee has no WhatsApp number/
  );
  assert.match(
    describeEssWhatsApp({ sent: false, skipped: "no_number", audience: "approver" }).text,
    /reporting-officer or HR WhatsApp/
  );
});

test("ESS queue rejects inline with a reason and has no pop-up dialogs", () => {
  const ess = read("app/(app)/ess/page.tsx");
  assert.match(ess, /notify_whatsapp: notifyEmployee/);
  assert.match(ess, /"ess-reject-reason"/);
  assert.match(ess, /disabled=\{statusMutation\.isPending \|\| !panelReason\.trim\(\)\}/);
  assert.match(ess, /\/whatsapp-notify`/);
  assert.doesNotMatch(ess, /next: "rejected" \}\)/);
  assert.doesNotMatch(ess, /<Dialog/);
  assert.match(ess, /href="\/ess\/new"/);
  assert.match(ess, /href=\{`\/allocation\?ess=\$\{encodeURIComponent\(r\.id\)\}`\}/);
  assert.match(ess, /md:grid-cols-2 xl:grid-cols-3/);
  assert.doesNotMatch(ess, /\|\| "Employee"\}/);
});

test("graded locks mirror the API: HR always edits (notes only once decided), paid delete is admin-only", () => {
  const hr = { staff: true };
  const admin = { staff: true, admin: true };
  for (const status of ["submitted", "approved", "allocated", "paid", "rejected"]) {
    assert.equal(essLockReason({ status }, "edit", hr), null, status);
  }
  assert.equal(essNotesOnlyReason({ status: "submitted" }), null);
  assert.equal(essNotesOnlyReason({ status: "approved" }), null);
  assert.match(essNotesOnlyReason({ status: "approved", ticket_id: "t1" }), /Airfare Allocation/);
  assert.match(essNotesOnlyReason({ status: "paid" }), /only the notes/);
  assert.match(essNotesOnlyReason({ status: "rejected" }), /new request/);
  assert.match(essLockReason({ status: "allocated", ticket_id: "t1" }, "delete", admin), /Delete the ticket/);
  assert.match(essLockReason({ status: "paid" }, "delete", hr), /System Admin/);
  assert.equal(essLockReason({ status: "paid", ticket_id: "t1" }, "delete", admin), null);
  assert.equal(essLockReason({ status: "rejected" }, "delete", hr), null);
  assert.ok(essDeleteNeedsReason("approved") && essDeleteNeedsReason("paid"));
  assert.ok(!essDeleteNeedsReason("submitted"));
  assert.ok(essActor({ roles: ["admin"] }).admin && !essActor({ roles: ["hr"] }).admin);
});

test("only HR staff change any request; employees their own pending ones; finance and auditor only view", () => {
  const hr = essActor({ roles: ["HR_MANAGER"] });
  const auditor = essActor({ roles: ["auditor", "finance"] });
  const self = essActor({ roles: ["EMPLOYEE"], employee_id: "e1" });
  assert.ok(hr.staff && !auditor.staff && !self.staff);
  const mine = { status: "submitted", employee_id: "e1" };
  assert.equal(essLockReason(mine, "edit", hr), null);
  assert.match(essLockReason(mine, "delete", auditor), /view ESS requests but not change/);
  assert.equal(essLockReason(mine, "delete", self), null);
  assert.match(essLockReason({ ...mine, employee_id: "e2" }, "edit", self), /only your own/);
  assert.match(essLockReason({ ...mine, status: "approved" }, "edit", self), /only HR/);
});

test("history lines stay out of the editable notes; detail changes are told apart from notes", () => {
  const notes = "Window seat\nApproved by admin on 22-10-2026: Cover arranged\nEdited by hr on 23-10-2026 (route was BAH-KHI, now BAH-DXB).";
  assert.deepEqual(splitEssNotes(notes), {
    text: "Window seat",
    history: [
      "Approved by admin on 22-10-2026: Cover arranged",
      "Edited by hr on 23-10-2026 (route was BAH-KHI, now BAH-DXB).",
    ],
  });
  assert.equal(splitEssNotes("Approved, thanks").history.length, 0);
  const base = {
    request_type: "airfare", trip_type: "ROUND_TRIP", leave_start_date: "2026-12-01", leave_end_date: "2026-12-14",
    travel_date: "2026-12-01", return_date: "2026-12-14", origin_code: "BAH", destination_code: "KHI",
  };
  assert.ok(!essDetailsChanged(base, { ...base, origin_code: "bah" }));
  assert.ok(!essDetailsChanged({ ...base, trip_type: "ONE_WAY" }, { ...base, trip_type: "ONE_WAY", return_date: "" }));
  assert.ok(essDetailsChanged(base, { ...base, destination_code: "DXB" }));
});

test("queue cards offer edit and delete with an inline confirm; edit page reuses the form", () => {
  const ess = read("app/(app)/ess/page.tsx");
  assert.match(ess, /href=\{`\/ess\/edit\?id=\$\{encodeURIComponent\(r\.id\)\}`\}/);
  assert.match(ess, /data-testid="ess-delete-confirm"/);
  assert.match(ess, /method: "DELETE"/);
  assert.match(ess, /deleteMutation\.isPending \|\| \(reasonRequired && !panelReason\.trim\(\)\)/);
  const edit = read("app/(app)/ess/edit/page.tsx");
  assert.match(edit, /<EssRequestForm key=\{`\$\{request\.data\.id\}-\$\{request\.data\.version\}`\} existing=\{request\.data\} \/>/);
  assert.match(edit, /essLockReason\(request\.data, "edit", actor\)/);
  const form = read("components/ess-request-form.tsx");
  assert.match(form, /method: existing \? "PUT" : "POST"/);
  assert.match(form, /"If-Match": String\(existing\.version\)/);
  assert.match(form, /data-testid="ess-reapproval-banner"/);
  assert.match(form, /r\.id !== existing\?\.id/);
});

test("new request is a full page with leave, return ticket, checks and entitlement", () => {
  assert.match(read("components/layout/app-shell.tsx"), /FULL_WIDTH_PATHS = \["\/commissions", "\/ess"\]/);
  assert.match(read("app/(app)/ess/new/page.tsx"), /<EssRequestForm initialEmployeeId=/);
  const page = read("components/ess-request-form.tsx");
  for (const field of ["leave_start_date", "leave_end_date", "return_date", "trip_type"]) {
    assert.ok(page.includes(field), `new request sends ${field}`);
  }
  assert.doesNotMatch(page, /<Dialog/);
  assert.match(page, /notify_whatsapp: notifyApprover/);
  assert.match(page, /data-testid="ess-leave-days"/);
  assert.match(page, /data-testid="ess-checks"/);
  assert.match(page, /"\/allocations\/preview"/);
  assert.match(page, /xl:grid-cols-\[minmax\(0,1fr\)_400px\]/);
  assert.match(page, /router\.push\("\/ess"\)/);
});

const BASE = {
  employee_id: "e1",
  request_type: "airfare",
  trip_type: "ROUND_TRIP",
  leave_start_date: "2026-12-01",
  leave_end_date: "2026-12-30",
  travel_date: "2026-12-01",
  return_date: "2026-12-30",
  origin_code: "BAH",
  destination_code: "KHI",
};
const TODAY_ISO = "2026-10-22";

test("addDaysIso moves across month and year ends", () => {
  assert.equal(addDaysIso("2026-12-25", 13), "2027-01-07");
  assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysIso("", 3), "");
});

test("form checks: a clean request passes; missing pieces are blocking errors", () => {
  assert.deepEqual(essFormChecks(BASE, { today: TODAY_ISO, employeeHasWhatsApp: true }), []);
  const errs = essFormChecks(
    { ...BASE, employee_id: "", leave_end_date: "", origin_code: "", destination_code: "" },
    { today: TODAY_ISO }
  ).filter((c) => c.level === "error");
  assert.deepEqual(
    errs.map((c) => c.field),
    ["employee_id", "leave_end_date", "origin_code", "destination_code"]
  );
  const same = essFormChecks({ ...BASE, destination_code: "BAH" }, { today: TODAY_ISO });
  assert.ok(same.some((c) => c.level === "error" && /must differ/.test(c.text)));
  const backwards = essFormChecks({ ...BASE, return_date: "2026-11-20" }, { today: TODAY_ISO });
  assert.ok(backwards.some((c) => c.field === "return_date" && c.level === "error"));
});

test("form checks: overlap blocks, travel outside leave and short notice warn", () => {
  const overlap = essFormChecks(BASE, {
    today: TODAY_ISO,
    otherRequests: [
      { leave_start_date: "2026-12-20", leave_end_date: "2027-01-05", status: "approved" },
      { leave_start_date: "2026-12-01", leave_end_date: "2026-12-30", status: "rejected" },
    ],
  });
  assert.equal(overlap.filter((c) => c.level === "error").length, 1);
  assert.match(overlap[0].text, /Overlaps another approved request/);

  const lateReturn = essFormChecks({ ...BASE, return_date: "2027-01-02" }, { today: TODAY_ISO });
  assert.ok(lateReturn.some((c) => c.level === "warning" && /after the leave ends/.test(c.text)));
  const earlyDepart = essFormChecks({ ...BASE, travel_date: "2026-11-25" }, { today: TODAY_ISO });
  assert.ok(earlyDepart.some((c) => c.level === "warning" && /outside the leave window/.test(c.text)));
  const dayBefore = essFormChecks({ ...BASE, travel_date: "2026-11-30" }, { today: TODAY_ISO });
  assert.ok(!dayBefore.some((c) => /outside the leave window/.test(c.text)));

  const soon = essFormChecks(
    { ...BASE, leave_start_date: "2026-10-25", leave_end_date: "2026-11-05", travel_date: "2026-10-25", return_date: "2026-11-05" },
    { today: TODAY_ISO }
  );
  assert.ok(soon.some((c) => c.level === "warning" && /Short notice/.test(c.text)));
  const noWa = essFormChecks(BASE, { today: TODAY_ISO, employeeHasWhatsApp: false });
  assert.ok(noWa.some((c) => /no WhatsApp number/.test(c.text)));
});

test("allocation page prefills from ?ess= and links the issued ticket", () => {
  const alloc = read("app/(app)/allocation/page.tsx");
  assert.match(alloc, /searchParams\.get\("ess"\)/);
  assert.match(alloc, /api<EssRequest>\(`\/ess\/requests\/\$\{essId\}`\)/);
  assert.match(alloc, /ess_request_id:/);
  assert.match(alloc, /data-testid="ess-allocation-banner"/);
  assert.match(alloc, /<Suspense fallback=\{<CardGridSkeleton \/>\}>/);
});
