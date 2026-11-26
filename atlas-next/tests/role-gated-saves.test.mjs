/**
 * Save controls match the API's role check, so a role the API rejects never sees a working Save.
 * Settings PUT /v1/settings: admin. Global preference PUT /v1/preferences: admin, hr.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("rule settings save only for administrators; others get a read-only view", () => {
  const src = read("app/(app)/settings/page.tsx");
  assert.match(src, /const canSaveRules = isAdmin\(me\)/);
  assert.match(src, /\{canSaveRules \? \([\s\S]*btn-save-settings/);
  assert.match(src, /settings-read-only/);
  assert.match(src, /<fieldset disabled=\{!canSaveRules\}/);
});

test("WhatsApp default numbers save only for HR or administrators", () => {
  const src = read("components/whatsapp-connection-panel.tsx");
  assert.match(src, /canSaveDefaults = hasRole\(me, "admin", "system_admin", "hr", "hr_manager"\)/);
  assert.match(src, /\{canSaveDefaults \? \([\s\S]*btn-save-whatsapp-defaults/);
  assert.match(src, /readOnly=\{!canSaveDefaults\}/);
});

test("Settings WhatsApp panel persists canonical manager / HR / MD preference keys", () => {
  const src = read("components/whatsapp-connection-panel.tsx");
  assert.match(src, /whatsapp_manager_recipients/);
  assert.match(src, /whatsapp_hr_recipients/);
  assert.match(src, /whatsapp_md_recipients/);
  assert.match(src, /whatsapp_default_recipients/);
  assert.match(src, /prefListToText\(prefsQ\.data\.whatsapp_manager_recipients\)/);
});

test("Allocation save fixed defaults dual-writes manager + legacy default keys", () => {
  const src = read("app/(app)/allocation/page.tsx");
  assert.match(src, /whatsapp_manager_recipients/);
  assert.match(src, /whatsapp_default_recipients/);
  assert.match(src, /btn-save-wa-defaults/);
});

test("Allocation WhatsApp desk links to Settings instead of dead distribution editor", () => {
  const src = read("app/(app)/allocation/whatsapp/page.tsx");
  assert.match(src, /alloc-wa-settings-link/);
  assert.match(src, /settings\/#whatsapp-distribution-settings/);
  assert.doesNotMatch(src, /saveDistMut/);
  assert.doesNotMatch(src, /distDrafts/);
});
