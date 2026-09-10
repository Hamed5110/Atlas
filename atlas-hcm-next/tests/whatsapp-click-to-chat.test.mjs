/**
 * Unit tests — WhatsApp click-to-chat helpers (wa.me only, not Evolution).
 */
import assert from "node:assert/strict";
import {
  buildWhatsAppUrl,
  formatWhatsAppDisplayNumber,
  normalizeWhatsAppNumber,
} from "../lib/whatsapp-click-to-chat.ts";

assert.equal(normalizeWhatsAppNumber("+973 33 33 4444"), "97333334444");
assert.equal(normalizeWhatsAppNumber("1"), "", "too short must fail-closed");
assert.equal(normalizeWhatsAppNumber(""), "");
assert.equal(normalizeWhatsAppNumber("1234567890123456"), "", "too long must fail-closed");
assert.equal(normalizeWhatsAppNumber("97333334444"), "97333334444");

const url = buildWhatsAppUrl("+973-3333-4444", "Hello *world* & test");
assert.match(url, /^https:\/\/wa\.me\/97333334444\?text=/);
assert.ok(url.includes(encodeURIComponent("Hello *world* & test")));
assert.equal(buildWhatsAppUrl("12", "x"), "");

assert.equal(formatWhatsAppDisplayNumber("97333334444"), "+97333334444");
assert.equal(formatWhatsAppDisplayNumber("99"), "-");

console.log("whatsapp-click-to-chat unit tests: PASS");
