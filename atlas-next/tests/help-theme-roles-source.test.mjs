import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Help & Guide is in the main menu for every user and uses the help API", () => {
  const shell = read("components/layout/app-shell.tsx");
  const nav = shell.slice(shell.indexOf("const NAV = ["), shell.indexOf("const HR_NAV"));
  assert.match(nav, /href: "\/help", labelKey: "nav\.help"/);
  const page = read("app/(app)/help/page.tsx");
  assert.match(page, /"\/help\/guide"/);
  assert.match(page, /"\/help\/ask"/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
  assert.match(page, /rel="noopener noreferrer"/);
});

test("theme picker is a labeled sidebar button and a Settings card", () => {
  const shell = read("components/layout/app-shell.tsx");
  const footer = shell.slice(shell.indexOf('data-testid="nav-user-footer"'));
  assert.match(footer, /<LanguageSwitcher[^>]*\/>\s*<ThemePicker \/>/);
  assert.match(read("components/theme-picker.tsx"), /data-testid="text-current-theme"/);
  const settings = read("app/(app)/settings/page.tsx");
  assert.match(settings, /data-testid="card-appearance"/);
  assert.match(settings, /<ThemeOptions columns=\{3\} \/>/);
});

test("new users must get at least one role and see what each role allows", () => {
  const page = read("app/(app)/users/page.tsx");
  for (const role of ["SYSTEM_ADMIN", "HR_MANAGER", "FINANCE_MANAGER", "EMPLOYEE"]) {
    assert.match(page, new RegExp(`id: "${role}",\\s*label: "[^"]+",\\s*description: "[^"]+"`));
  }
  assert.match(page, /form\.roles\.size === 0 \? "at least one role"/);
  assert.match(page, /aria-pressed=\{selected\}/);
  assert.match(page, /data-testid="text-user-missing"/);
});
