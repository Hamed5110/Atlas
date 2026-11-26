/** parseWhatsAppNumbers / normalize — multi-recipient helpers. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatWhatsAppDisplayList,
  normalizeWhatsAppNumber,
  parseWhatsAppNumbers,
  WhatsAppClickToChatLimits,
} from "../lib/whatsapp-click-to-chat.ts";

test("normalizeWhatsAppNumber strips and gates length", () => {
  assert.equal(normalizeWhatsAppNumber("+973 3500-0001"), "97335000001");
  assert.equal(normalizeWhatsAppNumber("123"), "");
});

test("parseWhatsAppNumbers accepts multiline and comma lists", () => {
  const nums = parseWhatsAppNumbers("97335000001\n97335000002, 97335000001");
  assert.deepEqual(nums, ["97335000001", "97335000002"]);
});

test("parseWhatsAppNumbers caps at MAX_RECIPIENTS", () => {
  const raw = Array.from({ length: 8 }, (_, i) => `9733500000${i}`).join("\n");
  assert.equal(parseWhatsAppNumbers(raw).length, WhatsAppClickToChatLimits.MAX_RECIPIENTS);
});

test("formatWhatsAppDisplayList", () => {
  assert.equal(formatWhatsAppDisplayList("97335000001;97335000002"), "+97335000001, +97335000002");
});
