/**
 * Design-system contract: palette tokens, skeleton system, a11y coverage,
 * and NUMERIC WCAG 2.1 AA contrast verification of the live theme tokens.
 *
 * Themes are swappable presets (app/themes/*.css) — every theme file must
 * define the full token contract and pass the SAME numeric contrast matrix.
 * The active theme is imported by app/globals.css; alternates are one-import
 * swaps, so a failing alternate must fail CI before anyone ships it.
 *
 * Refs: w3.org/TR/WCAG21 (1.4.3, 1.4.11, 2.4.7); NN/g skeleton screens;
 * ColorArchive token architecture; Apollo UX writing guide.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const css = read("app/globals.css");

const themeFiles = readdirSync(join(root, "app/themes"))
  .filter((f) => f.endsWith(".css"))
  .sort();
assert.ok(themeFiles.length >= 3, "expected the active theme + >= 2 alternates in app/themes");
const themes = Object.fromEntries(themeFiles.map((f) => [f.replace(/\.css$/, ""), read(`app/themes/${f}`)]));

/* ---------- WCAG math ---------- */
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
function luminance([r, g, b]) {
  const f = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

/* Parse `--name: hsl(h s% l%[/a])` and `--name: var(--other)` from a CSS text. */
function makeParser(cssText) {
  const raw = new Map();
  for (const m of cssText.matchAll(/--([\w-]+):\s*([^;]+);/g)) raw.set(m[1], m[2].trim());
  function resolve(name, seen = new Set()) {
    assert.ok(raw.has(name), `token --${name} missing from theme`);
    const v = raw.get(name);
    const ref = v.match(/^var\(--([\w-]+)\)$/);
    if (ref) {
      assert.ok(!seen.has(name), `circular token ref: ${name}`);
      seen.add(name);
      return resolve(ref[1], seen);
    }
    const hsl = v.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*[\d.]+%?)?\s*\)$/);
    assert.ok(hsl, `token --${name} is not a plain hsl(): ${v}`);
    return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  }
  return { raw, resolve, pair: (fg, bg) => contrast(resolve(fg), resolve(bg)) };
}

const TEXT_PAIRS = [
  ["color-foreground", "color-background"],
  ["color-foreground", "color-card"],
  ["color-muted-foreground", "color-card"],
  ["color-muted-foreground", "color-background"],
  ["color-primary", "color-card"],
  ["color-primary-foreground", "color-primary"],
  ["color-primary-foreground", "color-primary-hover"],
  ["color-secondary-foreground", "color-secondary"],
  ["color-secondary-foreground", "color-secondary-hover"],
  ["color-accent", "color-accent-muted"],
  ["color-accent-foreground", "color-accent"],
  ["color-success-foreground", "color-success"],
  ["color-success-foreground", "color-success-hover"],
  ["color-warning-foreground", "color-warning"],
  ["color-warning-foreground", "color-warning-hover"],
  ["color-destructive-foreground", "color-destructive"],
  ["color-destructive-foreground", "color-destructive-hover"],
  ["color-info-foreground", "color-info"],
  ["color-info-foreground", "color-info-hover"],
  ["color-success-emphasis", "color-success-muted"],
  ["color-warning-emphasis", "color-warning-muted"],
  ["color-destructive-emphasis", "color-destructive-muted"],
  ["color-info-emphasis", "color-info-muted"],
  ["color-primary-emphasis", "color-primary-muted"],
  ["color-sidebar-foreground", "color-sidebar"],
  ["color-sidebar-label", "color-sidebar"],
  ["color-sidebar-active", "color-sidebar"],
  ["color-sidebar-foreground", "color-sidebar-accent"],
  ["color-sidebar-active", "color-sidebar-active-bg"],
  ["color-sidebar-active", "color-sidebar-accent"],
];

const NAV_TONES = ["sky", "mint", "amber", "rose", "violet", "teal"];

for (const [themeName, themeCss] of Object.entries(themes)) {
  const { raw, resolve, pair } = makeParser(css + themeCss);

  test(`[${themeName}] three-tier token architecture: primitive scales exist`, () => {
    for (const name of [
      "brand-50", "brand-500", "brand-600", "brand-900",
      "neutral-0", "neutral-50", "neutral-200", "neutral-400", "neutral-500", "neutral-900", "neutral-950",
      "green-50", "green-600", "green-700", "green-800",
      "amber-50", "amber-600", "amber-700", "amber-800",
      "red-50", "red-600", "red-700", "red-800",
      "blue-50", "blue-600", "blue-700", "blue-800",
    ]) {
      assert.ok(raw.has(name), `missing primitive --${name}`);
    }
  });

  test(`[${themeName}] semantic role tokens exist for every semantic family`, () => {
    for (const fam of ["primary", "success", "warning", "destructive", "info"]) {
      for (const role of ["", "-foreground", "-hover", "-muted", "-emphasis"]) {
        assert.ok(raw.has(`color-${fam}${role}`), `missing --color-${fam}${role}`);
      }
    }
    for (const name of [
      "color-background", "color-foreground", "color-card", "color-border",
      "color-input", "color-input-hover", "color-ring", "color-sidebar", "color-sidebar-foreground",
      "color-sidebar-label", "color-sidebar-active-bg", "color-sidebar-indicator",
      ...NAV_TONES.map((tone) => `color-nav-${tone}`),
      "color-skeleton", "color-skeleton-shine",
      "color-chart-primary", "color-chart-secondary", "color-selection", "color-umbra",
      "gradient-hero", "gradient-sidebar",
    ]) {
      assert.ok(raw.has(name), `missing --${name}`);
    }
  });

  test(`[${themeName}] WCAG 1.4.3: text pairs meet 4.5:1`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const r = pair(fg, bg);
      assert.ok(r >= 4.5, `${fg} on ${bg} = ${r.toFixed(2)}:1 < 4.5:1`);
    }
  });

  test(`[${themeName}] WCAG 1.4.11: interactive boundaries + focus ring + chart meet 3:1`, () => {
    assert.ok(pair("color-input", "color-card") >= 3, `input border ${pair("color-input", "color-card").toFixed(2)}:1 < 3:1`);
    assert.ok(pair("color-ring", "color-card") >= 3, `focus ring ${pair("color-ring", "color-card").toFixed(2)}:1 < 3:1`);
    assert.ok(pair("color-chart-primary", "color-card") >= 3, `chart line ${pair("color-chart-primary", "color-card").toFixed(2)}:1 < 3:1`);
  });

  test(`[${themeName}] WCAG 1.4.11: sidebar indicator + nav icon tones meet 3:1 on sidebar and active row`, () => {
    for (const fg of ["color-sidebar-indicator", ...NAV_TONES.map((tone) => `color-nav-${tone}`)]) {
      for (const bg of ["color-sidebar", "color-sidebar-active-bg"]) {
        const r = pair(fg, bg);
        assert.ok(r >= 3, `${fg} on ${bg} = ${r.toFixed(2)}:1 < 3:1`);
      }
    }
  });

  test(`[${themeName}] input hover border is a visible affordance (>= 2.5:1, documented enhancement)`, () => {
    // 1.4.11 governs the resting state (neutral-400 >= 3:1, asserted above).
    // The hover border is an added cue; require it to be clearly perceptible.
    const r = pair("color-input-hover", "color-card");
    assert.ok(r >= 2.5, `input hover border ${r.toFixed(2)}:1 < 2.5:1`);
  });

  test(`[${themeName}] gradient-hero stops all keep white text >= 4.5:1`, () => {
    const grad = raw.get("gradient-hero");
    const stops = [...grad.matchAll(/hsl\(\s*[\d.]+\s+[\d.]+%\s+[\d.]+%\s*\)/g)].map((m) => m[0]);
    assert.ok(stops.length >= 2, "gradient-hero must have >= 2 stops");
    for (const stop of stops) {
      const m = stop.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
      const r = contrast(hslToRgb(0, 0, 100), hslToRgb(Number(m[1]), Number(m[2]), Number(m[3])));
      assert.ok(r >= 4.5, `white on hero stop ${stop} = ${r.toFixed(2)}:1 < 4.5:1`);
    }
  });

  test(`[${themeName}] gradient-sidebar stops keep sidebar text >= 4.5:1`, () => {
    const grad = raw.get("gradient-sidebar");
    const stops = [...grad.matchAll(/hsl\(\s*[\d.]+\s+[\d.]+%\s+[\d.]+%\s*\)/g)].map((m) => m[0]);
    assert.ok(stops.length >= 2, "gradient-sidebar must have >= 2 stops");
    for (const stop of stops) {
      const m = stop.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
      const r = contrast(resolve("color-sidebar-foreground"), hslToRgb(Number(m[1]), Number(m[2]), Number(m[3])));
      assert.ok(r >= 4.5, `sidebar text on ${stop} = ${r.toFixed(2)}:1 < 4.5:1`);
    }
  });
}

test("active theme import: globals.css imports exactly one theme preset", () => {
  const imports = [...css.matchAll(/@import\s+"\.\/themes\/([\w-]+)\.css";/g)].map((m) => m[1]);
  assert.equal(imports.length, 1, `expected exactly 1 active theme import, got ${imports.length}`);
  assert.ok(themeFiles.includes(`${imports[0]}.css`), `active theme ${imports[0]} missing from app/themes`);
});

test("dead legacy classes removed; shimmer + reduced-motion + focus-visible present", () => {
  assert.ok(!css.includes(".loading-skeleton"), "dead .loading-skeleton still present");
  assert.ok(!css.includes(".empty-state"), "dead .empty-state still present");
  assert.ok(!css.includes(".text-gradient"), "dead .text-gradient still present");
  assert.match(css, /\.skeleton-shimmer/);
  assert.match(css, /@keyframes skeleton-shimmer/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible\s*\{/);
});

test("skeleton component: shimmer, aria-hidden blocks, role=status, layout variants", () => {
  const src = read("components/ui/skeleton.tsx");
  assert.match(src, /skeleton-shimmer/);
  assert.match(src, /aria-hidden="true"/);
  assert.match(src, /role="status"/);
  assert.match(src, /sr-only/);
  for (const variant of ["TableSkeleton", "CardsSkeleton", "ChartSkeleton", "ListSkeleton", "FormSkeleton", "CardGridSkeleton"]) {
    assert.match(src, new RegExp(`export function ${variant}`), `missing ${variant}`);
  }
});

test("key screens wire layout-matched skeletons", () => {
  const expectations = {
    "app/(app)/dashboard/page.tsx": ["CardsSkeleton", "ChartSkeleton", "ListSkeleton"],
    "app/(app)/employees/page.tsx": ["TableSkeleton"],
    "app/(app)/reports/page.tsx": ["TableSkeleton"],
    "app/(app)/commissions/page.tsx": ["TableSkeleton"],
    "app/(app)/allocation/page.tsx": ["CardGridSkeleton"],
    "app/(app)/time-tracking/page.tsx": ["TableSkeleton"],
  };
  for (const [file, names] of Object.entries(expectations)) {
    const src = read(file);
    for (const n of names) assert.match(src, new RegExp(n), `${file} missing ${n}`);
  }
});

test("icon-only buttons expose accessible names (aria-label)", () => {
  const toast = read("components/ui/toast.tsx");
  assert.match(toast, /aria-label="Dismiss notification"/);
  const dialog = read("components/ui/dialog.tsx");
  assert.match(dialog, /aria-label=\{t\("action\.dismiss"\)\}/);
  for (const page of ["app/(app)/users/page.tsx", "app/(app)/lookups/page.tsx", "app/(app)/rates/page.tsx"]) {
    const src = read(page);
    const iconBtns = src.match(/size="icon"/g) ?? [];
    const labels = src.match(/aria-label=/g) ?? [];
    assert.ok(labels.length >= iconBtns.length, `${page}: ${iconBtns.length} icon buttons vs ${labels.length} aria-labels`);
  }
});

test("microcopy: shared state/empty/action keys exist in EN and AR", () => {
  const src = read("lib/i18n/messages.ts");
  for (const key of [
    "state.loading", "state.saving", "state.working",
    "action.clearSearch", "action.clearFilters", "action.dismiss",
    "empty.employees.title", "empty.employees.message",
    "empty.noResults.title", "empty.noResults.message",
    "empty.vouchers.title", "empty.vouchers.message",
    "page.employees.addAction", "login.signingIn",
    "page.dashboard.recentTickets", "page.dashboard.noTickets", "page.dashboard.noForecast",
  ]) {
    const occurrences = src.split(`"${key}"`).length - 1;
    assert.ok(occurrences >= 2, `${key} must exist in both EN and AR dicts`);
  }
});

test("microcopy: no shouting-case button labels in i18n dicts", () => {
  const src = read("lib/i18n/messages.ts");
  const en = src.match(/const en: Dict = \{([\s\S]*?)\n\};/)[1];
  for (const m of en.matchAll(/"([^"]+)":\s*"([^"]+)"/g)) {
    const [, key, value] = m;
    if (/^(action\.|comm\.(save|savePrint|clear|addLine|removeLine))/.test(key)) {
      assert.ok(!/^[A-Z&\s]{3,}$/.test(value), `${key}="${value}" is ALL-CAPS — use sentence case`);
    }
  }
});
