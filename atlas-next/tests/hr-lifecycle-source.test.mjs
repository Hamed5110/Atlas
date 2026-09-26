/**
 * HR Document Lifecycle — nav + studio source contract.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

test("HR nav exposes lifecycle letters + form builder", () => {
  const shell = read("components/layout/app-shell.tsx");
  for (const token of [
    "nav-warning-letters",
    "nav-salary-revisions",
    "nav-experience-certs",
    "nav-relieving-certs",
    "nav-hr-forms",
    "nav-mistake-fines",
    "/warning-letters",
    "/salary-revisions",
    "/mistake-fines",
    "/hr-forms",
  ]) {
    assert.match(shell, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("lifecycle studio posts to /hr-lifecycle endpoints", () => {
  const src = read("components/hr-lifecycle-studio.tsx");
  assert.match(src, /\/hr-lifecycle\/preview/);
  assert.match(src, /\/hr-lifecycle\/documents/);
  assert.match(src, /warning_letter/);
  assert.match(src, /salary_increment/);
  assert.match(src, /mistake_with_fine/);
});

test("lifecycle studio sends PDF via Evolution WhatsApp", () => {
  const src = read("components/hr-lifecycle-studio.tsx");
  assert.match(src, /\/documents\/\$\{waSendTarget\.id\}\/whatsapp/);
  assert.match(src, /notify_whatsapp/);
  assert.match(src, /manager_whatsapp_numbers/);
  assert.match(src, /Send WhatsApp with PDF/);
  assert.match(src, /btn-lifecycle-send-whatsapp/);
});

test("mistake with fine convert-to-loan is wired", () => {
  const src = read("components/hr-lifecycle-studio.tsx");
  const page = read("app/(app)/mistake-fines/page.tsx");
  const shell = read("components/layout/app-shell.tsx");
  assert.match(src, /convert-to-loan/);
  assert.match(src, /btn-lifecycle-convert-loan/);
  assert.match(page, /mistake_with_fine/);
  assert.match(shell, /nav-mistake-fines/);
  assert.match(shell, /\/mistake-fines/);
});

test("form builder soft-deletes fields via DELETE .../fields/{key}", () => {
  const src = read("app/(app)/hr-forms/page.tsx");
  assert.match(src, /\/hr-lifecycle\/forms\/\$\{selected!\.id\}\/fields\/\$\{key\}/);
  assert.match(src, /Seed defaults/);
});

test("form builder asks for print layout placement on add", () => {
  const src = read("app/(app)/hr-forms/page.tsx");
  assert.match(src, /print_zone/);
  assert.match(src, /print_after/);
  assert.match(src, /print_align/);
  assert.match(src, /print_width/);
  assert.match(src, /print_label_pos/);
  assert.match(src, /print_format/);
  assert.match(src, /print_size/);
  assert.match(src, /print_vspace/);
  assert.match(src, /print_border/);
  assert.match(src, /print_italic/);
  assert.match(src, /print_indent/);
  assert.match(src, /print_label_width/);
  assert.match(src, /print_show_empty/);
  assert.match(src, /print_hline/);
  assert.match(src, /print_role/);
  assert.match(src, /print_color/);
  assert.match(src, /print_page_break/);
  assert.match(src, /print_static_text/);
  assert.match(src, /print_presets/);
  assert.match(src, /print_include/);
  assert.match(src, /print_empty_as/);
  assert.match(src, /print_label_bold/);
  assert.match(src, /print_keep_together/);
  assert.match(src, /percent/);
  assert.match(src, /PRINT FORMAT/);
  assert.match(src, /select-new-print-zone/);
  assert.match(src, /select-new-print-align/);
  assert.match(src, /select-new-print-role/);
  assert.match(src, /select-print-preset/);
  assert.match(src, /check-print-include/);
  assert.match(src, /Unsaved print layout/);
  assert.match(src, /Reset print/);
  assert.match(src, /Particulars \(main details table\)/);
  assert.match(src, /quarter/);
  assert.match(src, /justify/);
});
