/**
 * Red-team V&V for the design-system:
 *  1. Every var(--token) referenced in TSX/CSS must exist in globals.css or a theme file.
 *  2. No mojibake (encoding corruption) in any edited source file.
 *  3. No removed legacy classes referenced anywhere.
 *  4. No duplicate token definitions within globals.css or within any single theme file.
 *  5. No raw hsl()/hex color literals in TSX — all color flows through tokens,
 *     otherwise a theme swap (one import in globals.css) would silently miss screens.
 *  6. Active brand hue locked to the generated seed (brand drift guard).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "app/globals.css"), "utf8");
const themeDir = join(root, "app/themes");
const themeFiles = readdirSync(themeDir).filter((f) => f.endsWith(".css")).sort();
const themeTexts = themeFiles.map((f) => readFileSync(join(themeDir, f), "utf8"));

const defined = new Set();
for (const m of css.matchAll(/--([\w-]+):/g)) defined.add(m[1]);
for (const t of themeTexts) for (const m of t.matchAll(/--([\w-]+):/g)) defined.add(m[1]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", "out", ".git"].includes(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if ([".tsx", ".ts", ".css"].includes(extname(p))) yield p;
  }
}

const tailwindThemeGlobals = new Set([
  // Tailwind v4 default theme tokens that may legitimately appear
  "spacing", "breakpoint-md", "breakpoint-lg",
]);

test("no dangling var(--*) references in any source file", () => {
  const offenders = [];
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/var\(--([\w-]+)\)/g)) {
      const name = m[1];
      if (defined.has(name) || tailwindThemeGlobals.has(name)) continue;
      offenders.push(`${file.replace(root, "")}: --${name}`);
    }
  }
  assert.deepEqual([...new Set(offenders)], [], "dangling token references found");
});

test("no duplicate token definitions within globals.css or any single theme file", () => {
  for (const [label, text] of [["globals.css", css], ...themeFiles.map((f, i) => [`themes/${f}`, themeTexts[i]])]) {
    const counts = {};
    for (const m of text.matchAll(/--([\w-]+)\s*:/g)) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
    const dupes = Object.entries(counts).filter(([, n]) => n > 1).map(([k]) => `--${k} x${counts[k]}`);
    assert.deepEqual(dupes, [], `duplicate token definitions in ${label}`);
  }
});

test("no mojibake in source files (encoding integrity after edits)", () => {
  const bad = [];
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    if (/â€|Ã¤|Ã©|ï¿½/.test(src)) bad.push(file.replace(root, ""));
  }
  assert.deepEqual(bad, [], "mojibake detected");
});

test("removed legacy classes are not referenced anywhere", () => {
  for (const file of walk(root)) {
    if (file.endsWith("globals.css")) continue;
    const src = readFileSync(file, "utf8");
    for (const cls of ["loading-skeleton", "empty-state", "text-gradient"]) {
      assert.ok(!src.includes(cls), `${file} still references .${cls}`);
    }
  }
});

test("no raw color literals in TSX/TS — tokens only (theme-swap safety)", () => {
  const offenders = [];
  for (const file of walk(root)) {
    if (![".tsx", ".ts"].includes(extname(file))) continue;
    const src = readFileSync(file, "utf8");
    const hslHits = src.match(/hsl\(\s*\d/) ?? [];
    const hexHits = src.match(/#[0-9a-fA-F]{6}\b/) ?? [];
    if (hslHits.length || hexHits.length) {
      offenders.push(`${file.replace(root, "")}: hsl x${hslHits.length} hex x${hexHits.length}`);
    }
  }
  assert.deepEqual(offenders, [], "raw color literals bypass the theme tokens");
});

test("brand hue family preserved (199 arctic sky) — no accidental brand drift", () => {
  const active = css.match(/@import\s+"\.\/themes\/([\w-]+)\.css";/);
  assert.ok(active, "globals.css must import one active theme");
  assert.equal(active[1], "arctic-sky", "default theme changed — update this guard deliberately");
  const theme = themeTexts[themeFiles.indexOf(`${active[1]}.css`)];
  assert.ok(theme, `active theme ${active[1]}.css not found`);
  const m = theme.match(/--brand-500:\s*hsl\(\s*(\d+)/);
  assert.ok(m, "brand-500 missing");
  assert.equal(Number(m[1]), 199, "brand hue drifted from ATLAS Arctic Sky (regenerate via scripts/generate-theme.mjs)");
});
