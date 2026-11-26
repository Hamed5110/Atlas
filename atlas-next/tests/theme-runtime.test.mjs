/**
 * Runtime color themes: every generated preset is selectable at runtime, the
 * catalog matches the theme files, and the choice persists via the MSSQL-backed
 * preferences API (localStorage is only a paint-time cache).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const themeIds = readdirSync(join(root, "app/themes"))
  .filter((f) => f.endsWith(".css"))
  .map((f) => f.replace(/\.css$/, ""))
  .sort();
const runtime = read("app/theme-runtime.css");
const catalog = read("lib/theme-catalog.ts");

test("every theme file has a runtime preset and a catalog entry", () => {
  const catalogIds = [...catalog.matchAll(/"id":\s*"([\w-]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(catalogIds, themeIds);
  for (const id of themeIds) {
    assert.ok(runtime.includes(`[data-theme="${id}"] {`), `runtime preset missing for ${id}`);
  }
  assert.ok(themeIds.length >= 6, "expected at least 6 selectable themes");
});

test("default theme is consistent: catalog default, compiled import, first picker option", () => {
  const defaultId = catalog.match(/DEFAULT_THEME_ID = "([\w-]+)"/)[1];
  assert.ok(themeIds.includes(defaultId), `default ${defaultId} has no theme file`);
  const imported = read("app/globals.css").match(/@import\s+"\.\/themes\/([\w-]+)\.css";/)[1];
  assert.equal(imported, defaultId, "globals.css must compile the default theme (paint before preferences load)");
  const listed = [...catalog.matchAll(/"id":\s*"([\w-]+)"/g)].map((m) => m[1]);
  assert.equal(listed[0], defaultId, "default theme must be listed first in the picker");
  assert.deepEqual(listed.slice(0, 4), [defaultId, "enterprise-vibrant", "honey-cream", "lavender-lime"]);
  assert.match(catalog, /\(default\)/);
  assert.equal(catalog.match(/\(default\)/g).length, 1, "exactly one theme is labelled default");
});

test("runtime presets define the same tokens as their theme files", () => {
  for (const id of themeIds) {
    const file = read(`app/themes/${id}.css`);
    const block = runtime.split(`[data-theme="${id}"] {`)[1].split("\n}")[0];
    const tokens = (text) =>
      Object.fromEntries([...text.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    assert.deepEqual(tokens(block), tokens(file), `${id}: runtime preset drifted from theme file`);
  }
});

test("globals imports the runtime presets; layout applies cached theme before paint", () => {
  assert.match(read("app/globals.css"), /@import\s+"\.\/theme-runtime\.css";/);
  const layout = read("app/layout.tsx");
  assert.match(layout, /THEME_BOOT_SCRIPT/);
  assert.match(read("lib/theme-boot.ts"), /\/\^\[a-z0-9-\]\+\$\/\.test\(t\)/);
});

test("generator audit passes WCAG AA for every theme, including light sidebars", () => {
  const run = spawnSync(process.execPath, [join(root, "scripts/generate-theme.mjs"), "--audit"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /ALL THEMES PASS WCAG 2\.1 AA/);
});

test("light-sidebar theme uses dark sidebar text and the login panel follows the tokens", () => {
  const honey = read("app/themes/honey-cream.css");
  const lightness = (token) => Number(honey.match(new RegExp(`--${token}: hsl\\([\\d.]+ [\\d.]+% ([\\d.]+)%`))[1]);
  assert.ok(lightness("color-sidebar") > 85, "honey sidebar is light");
  assert.ok(lightness("color-sidebar-active") < 30, "selected text is dark on the light sidebar");
  assert.ok(lightness("color-sidebar-foreground") < 50, "menu text is dark on the light sidebar");
  const login = read("app/login/page.tsx");
  const panel = login.split('data-testid="login-brand-panel"')[1].split('<div className="flex flex-1')[0];
  assert.doesNotMatch(panel, /text-white">(ATLAS HCM|\s*\{t\("login\.hero"\)\})/);
  assert.match(panel, /text-\[var\(--color-sidebar-active\)\]/);
});

test("enterprise vibrant keeps text off the raw accent fills and survives a theme upgrade", () => {
  const css = read("app/themes/enterprise-vibrant.css");
  const motion = read("app/enterprise-vibrant.css");
  const sidebar = css.match(/--color-sidebar: hsl\([\d.]+ [\d.]+% ([\d.]+)%/)[1];
  assert.ok(Number(sidebar) > 90, "sidebar stays a light slate, not a dark panel");
  const brand = css.match(/--brand-500: hsl\(([\d.]+)/)[1];
  assert.ok(Number(brand) > 220 && Number(brand) < 280, "primary stays in the indigo-blue family");
  for (const raw of ["#06B6D4", "#10B981", "#F59E0B", "#EF4444", "#4F46E5", "#fff", "#FFF", "#ffffff"]) {
    assert.equal(css.includes(raw), false, `${raw} must not be pasted in; contrast is solved`);
    assert.equal(motion.includes(raw), false, `${raw} must not be pasted into the motion layer`);
  }
  assert.equal(motion.includes("color-mix(in srgb, white"), false, "white glass fails on dark themes");
  assert.match(motion, /\[data-surface="card"\]/);
  assert.doesNotMatch(motion, /\[data-theme="enterprise-vibrant"\]/, "the feel layer applies to every theme");
  assert.match(motion, /var\(--color-primary\)/);
  assert.match(motion, /var\(--color-card\)/);
  assert.match(motion, /prefers-reduced-motion/);
  assert.match(motion, /prefers-reduced-transparency/);
  assert.match(motion, /hover: hover\) and \(prefers-reduced-motion: no-preference\)/);
  assert.match(read("lib/theme.ts"), /preference_key: THEME_PREFERENCE_KEY/);
  assert.match(read("lib/theme.ts"), /DEFAULT_THEME_ID/);
});

test("theme choice is saved through the preferences API (MSSQL), not only the browser", () => {
  const lib = read("lib/theme.ts");
  assert.match(lib, /"\/preferences\/me"/);
  assert.match(lib, /"\/preferences\/effective"/);
  assert.match(lib, /preference_key: THEME_PREFERENCE_KEY/);
  assert.match(lib, /cancelQueries/);
  assert.match(lib, /setQueryData/);
  assert.match(lib, /normalizeThemeId/);
  const picker = read("components/theme-picker.tsx");
  assert.match(picker, /role="radiogroup"/);
  assert.match(picker, /aria-checked=\{active\}/);
  assert.match(picker, /data-theme=\{theme\.id\}/);
  assert.match(read("components/layout/app-shell.tsx"), /<ThemePicker \/>/);
});
