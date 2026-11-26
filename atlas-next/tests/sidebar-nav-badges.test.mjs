/**
 * Sidebar notification badges: counts from GET /v1/nav/badges, tolerant of older APIs,
 * semantic tone colours, accessible hints, rail bubbles, section and mobile totals.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const shell = read("components/layout/app-shell.tsx");
const parts = read("components/layout/sidebar-nav.tsx");
const hook = read("lib/nav-badges.ts");
const messages = read("lib/i18n/messages.ts");

test("badge hook polls the counts endpoint and never breaks the menu", () => {
  assert.match(hook, /api<\{ badges\?: NavBadges \}>\("\/nav\/badges"\)/);
  assert.match(hook, /catch \{[\s\S]*?return \{\};/);
  assert.match(hook, /refetchInterval: 60_000/);
  assert.match(hook, /refetchOnWindowFocus: true/);
  assert.match(hook, /retry: false/);
  assert.match(shell, /useNavBadges\(Boolean\(me\), pathname\)/);
});

test("counts cap at 99+ and group totals keep the most urgent tone", () => {
  assert.match(hook, /count > 99 \? "99\+"/);
  assert.match(hook, /TONE_RANK: Record<BadgeTone, number> = \{ info: 0, warning: 1, danger: 2 \}/);
});

test("badge colours come from semantic theme tokens", () => {
  for (const token of ["destructive", "warning", "info"]) {
    assert.match(parts, new RegExp(`bg-\\[var\\(--color-${token}\\)\\] text-\\[var\\(--color-${token}-foreground\\)\\]`));
  }
  assert.match(parts, /ring-2 ring-\[var\(--color-sidebar\)\]/, "rail bubble needs a cut-out ring");
});

test("badges are announced, not just shown", () => {
  assert.match(parts, /aria-hidden="true"\s+data-testid=\{testId\}\s+data-badge-tone=\{badge\.tone\}\s+data-badge-count=\{badge\.count\}/);
  assert.match(parts, /aria-label=\{rail \? \(spoken \? `\$\{label\}, \$\{spoken\}` : label\) : undefined\}/);
  assert.match(parts, /<span className="sr-only">, \{spoken\}<\/span>/);
  assert.match(parts, /role="tooltip"[\s\S]*?\{spoken \?/);
});

test("badges show on items, pinned copies, collapsed sections and the mobile Menu button", () => {
  assert.equal((shell.match(/\{\.\.\.badgeFor\(entry\)\}/g) ?? []).length, 3);
  assert.equal((shell.match(/badge=\{sumBadges\(badges,/g) ?? []).length, 2);
  assert.match(shell, /testId="badge-menu"/);
  assert.match(parts, /const showBadge = !open && badge/);
  assert.match(parts, /testId=\{`badge-section-\$\{id\}`\}/);
});

test("badge hints are translated in English and Arabic", () => {
  for (const key of ["attention", "essAction", "essOpen", "ticketsSubmitted", "documentsExpiring"]) {
    const hits = messages.match(new RegExp(`"badge\\.${key}":`, "g")) ?? [];
    assert.equal(hits.length, 2, `badge.${key} must exist in en + ar`);
  }
  for (const kind of ["ess_action", "ess_open", "tickets_submitted", "documents_expiring"]) {
    assert.match(hook, new RegExp(`${kind}: "badge\\.\\w+"`), `${kind} needs a hint key`);
  }
});
