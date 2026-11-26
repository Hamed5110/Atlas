/**
 * Sidebar navigation features: menu search (Ctrl/Cmd+K, "/", synonyms, arrow keys),
 * recent pages, per-user pinned favourites, icon rail with tooltips, all accessible.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const shell = read("components/layout/app-shell.tsx");
const parts = read("components/layout/sidebar-nav.tsx");
const prefs = read("lib/nav-prefs.ts");
const messages = read("lib/i18n/messages.ts");

test("every nav entry carries search keywords", () => {
  for (const block of [shell.slice(shell.indexOf("const NAV = ["), shell.indexOf("const ADMIN_ONLY"))]) {
    const entries = block.match(/testId: "nav-[\w-]+"/g) ?? [];
    const keywords = block.match(/keywords: "[^"]+"/g) ?? [];
    assert.ok(entries.length >= 30, `expected >= 30 nav entries, got ${entries.length}`);
    assert.equal(keywords.length, entries.length, "each nav entry needs keywords");
  }
});

test("menu search is an accessible combobox with keyboard support", () => {
  assert.match(parts, /role="combobox"/);
  assert.match(parts, /aria-activedescendant=\{activeId\}/);
  assert.match(parts, /aria-controls="nav-main"/);
  assert.match(shell, /id="nav-main"/);
  assert.match(shell, /event\.key === "ArrowDown"/);
  assert.match(shell, /event\.key === "Enter"/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /aria-live="polite"/);
});

test("global shortcuts: Ctrl/Cmd+K and / open search, [ toggles the rail, ignored while typing", () => {
  assert.match(shell, /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key\.toLowerCase\(\) === "k"/);
  assert.match(shell, /event\.key === "\/"/);
  assert.match(shell, /event\.key === "\[" && isDesktop/);
  assert.match(shell, /isTyping\(event\.target\)/);
});

test("matching folds case and diacritics and ranks label prefixes first", () => {
  assert.match(parts, /normalize\("NFD"\)/);
  assert.match(parts, /if \(name\.startsWith\(q\)\) return 3;/);
});

test("pins and recents are per user, capped, persisted without hydration mismatch", () => {
  assert.match(prefs, /pins: Record<string, string\[\]>/);
  assert.match(prefs, /recent: Record<string, string\[\]>/);
  assert.match(prefs, /export const MAX_PINS = 8;/);
  assert.match(prefs, /skipHydration: true/);
  assert.match(shell, /useNavPrefs\.persist\.rehydrate\(\)/);
  assert.match(shell, /toast\.warning\(t\("nav\.pinLimit"\)\)/);
});

test("pin control is a separate button (no button nested in a link) with aria-pressed", () => {
  assert.match(parts, /aria-pressed=\{pinned\}/);
  const link = parts.slice(parts.indexOf("<Link"), parts.indexOf("</Link>"));
  assert.doesNotMatch(link, /<button/);
});

test("pinned and recent copies use prefixed test ids so originals stay unique", () => {
  assert.match(shell, /idPrefix="pinned-"/);
  assert.match(shell, /idPrefix="recent-"/);
  assert.match(parts, /data-testid=\{`\$\{idPrefix\}\$\{entry\.testId\}`\}/);
});

test("rail mode: toggle button, tooltips, labels kept for screen readers", () => {
  assert.match(shell, /data-testid="nav-rail-toggle"/);
  assert.match(shell, /aria-expanded=\{!rail\}/);
  assert.match(shell, /rail \? "lg:ms-\[76px\]" : "lg:ms-64"/);
  assert.match(parts, /role="tooltip"/);
  assert.match(parts, /aria-label=\{rail \? \(spoken \? `\$\{label\}, \$\{spoken\}` : label\) : undefined\}/);
});

test("rail toggle shows the action it will take and stands off any page colour", () => {
  const toggle = shell.slice(shell.indexOf('data-testid="nav-rail-toggle"'), shell.indexOf("</button>", shell.indexOf('data-testid="nav-rail-toggle"')));
  assert.match(toggle, /\{rail \? \(\s*<PanelLeftOpen[\s\S]*:\s*\(\s*<PanelLeftClose/);
  assert.match(toggle, /ring-\[var\(--color-background\)\]/, "ring separates the button from cream or dark pages");
  assert.match(toggle, /focus-visible:ring-\[var\(--color-ring\)\]/);
  assert.match(toggle, /rtl:-scale-x-100/, "icon mirrors when the sidebar is on the right");
  assert.doesNotMatch(toggle.replace(/motion-safe:[^\s"]+/g, ""), /(scale-1|translate-x)/, "movement only when motion is allowed");
});

test("new nav strings exist in EN and AR", () => {
  for (const key of ["nav.search", "nav.searchEmpty", "nav.pages", "nav.pinned", "nav.recent", "nav.pin", "nav.unpin", "nav.pinLimit", "nav.collapse", "nav.expand"]) {
    assert.equal(messages.split(`"${key}"`).length - 1, 2, `${key} must exist in EN and AR`);
  }
});
