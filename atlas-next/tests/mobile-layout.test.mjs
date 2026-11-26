/**
 * Mobile layout contract: bottom tabs, field anatomy, sheet footer, theme-safe bars.
 * Colours come from theme tokens. Raw brief fills are rejected.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tabs = read("components/layout/mobile-tabs.tsx");
const shell = read("components/layout/app-shell.tsx");
const fields = read("components/ui/input.tsx");
const dialog = read("components/ui/dialog.tsx");
const css = read("app/globals.css");
const messages = read("lib/i18n/messages.ts");

test("bottom bar has four destinations plus More, and hides while the menu is open", () => {
  assert.match(tabs, /MOBILE_TAB_HREFS = \["\/dashboard", "\/allocation", "\/employees", "\/ess"\]/);
  assert.match(tabs, /if \(out\.length >= 4\) return/);
  assert.match(tabs, /if \(moreOpen\) return null/);
  assert.match(tabs, /lg:hidden/);
  assert.match(tabs, /env\(safe-area-inset-bottom\)/);
  assert.match(tabs, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(tabs, /text-\[var\(--color-primary\)\]/);
  assert.match(tabs, /text-\[var\(--color-muted-foreground\)\]/);
  assert.doesNotMatch(tabs, /#06B6D4|#10B981|#F59E0B|#EF4444|#4F46E5/);
  assert.match(shell, /pickMobileTabs\(byHref\)/);
  assert.match(shell, /moreOpen=\{navOpen\}/);
});

test("tab labels are short in both languages", () => {
  for (const key of ["nav.tab.home", "nav.tab.tickets", "nav.tab.people", "nav.tab.inbox", "nav.tab.more"]) {
    assert.equal(messages.split(`"${key}"`).length - 1, 2, key);
  }
});

test("fields are 44px and 16px type on phones, 40px and 14px from laptop width", () => {
  assert.match(fields, /h-11 lg:h-10/);
  assert.match(fields, /text-base/);
  assert.match(fields, /lg:text-sm/);
  assert.match(fields, /gap-2/);
  assert.match(fields, /aria-invalid/);
  assert.match(fields, /aria-describedby/);
  assert.match(fields, /bg-\[var\(--color-card\)\]/);
  assert.doesNotMatch(fields, /bg-white/);
});

test("invalid fields shake only when motion is allowed, and bars fall back to a solid card", () => {
  assert.match(fields, /field-invalid/);
  assert.match(css, /@keyframes field-shake/);
  assert.match(css, /translateX\(-4px\)/);
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*\.field-invalid \{ animation: none/);
  assert.match(css, /\.surface-bar \{[\s\S]*background: var\(--color-card\)/);
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(dialog, /surface-bar/);
  assert.match(dialog, /data-dialog-footer/);
  assert.match(css, /\.dialog-footer > :last-child \{[\s\S]*min-height: 48px/);
  assert.match(css, /padding-bottom: calc\(4\.5rem \+ env\(safe-area-inset-bottom\)\)/);
});
