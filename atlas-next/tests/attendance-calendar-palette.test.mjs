/**
 * Attendance calendar: every status the API sends has a label and its own colour token,
 * fixed status hues stay readable as white-on-solid (WCAG 4.5:1), and the reports page
 * wires the calendar for the date-wise time reports.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const css = read("app/globals.css");
const cal = read("components/reports/attendance-calendar.tsx");
const page = read("app/(app)/reports/page.tsx");

const API_KINDS = [
  "present", "late", "half_day", "missing_punch", "absent", "on_duty",
  "not_started", "weekly_off", "holiday", "leave", "no_shift",
];

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const lum = (rgb) =>
  rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrastWithWhite = (rgb) => 1.05 / (lum(rgb) + 0.05);

const statusBlock = cal.split("const STATUS")[1].split("};")[0];
const tokenOf = (kind) => new RegExp(`${kind}: \\{[^}]*token: "(--[\\w-]+)"`).exec(statusBlock)?.[1];

test("every API status kind has a label and a colour token", () => {
  for (const kind of API_KINDS) {
    assert.ok(tokenOf(kind), `calendar has no status entry for ${kind}`);
  }
});

test("statuses that need attention never share a colour", () => {
  const coloured = ["present", "late", "half_day", "missing_punch", "absent", "on_duty", "holiday", "leave"];
  const tokens = coloured.map(tokenOf);
  assert.equal(new Set(tokens).size, coloured.length, `shared tokens: ${tokens.join(", ")}`);
});

test("calendar tokens are defined and fixed hues pass 4.5:1 with white text", () => {
  for (const m of cal.matchAll(/"(--att-[\w-]+)"/g)) {
    assert.ok(css.includes(`${m[1]}:`), `${m[1]} is not defined in globals.css`);
  }
  for (const m of css.matchAll(/--(att-[\w-]+):\s*hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/g)) {
    const ratio = contrastWithWhite(hslToRgb(Number(m[2]), Number(m[3]), Number(m[4])));
    assert.ok(ratio >= 4.5, `--${m[1]} only ${ratio.toFixed(2)}:1 against white`);
  }
});

test("reports page opens week / month time reports as the calendar", () => {
  assert.match(page, /import \{ AttendanceCalendar/);
  assert.match(page, /const CALENDAR_REPORTS = new Set/);
  for (const name of ["hcm-attendance", "tt-latecomers", "tt-early-out", "tt-absences", "tt-missing-punch", "tt-overtime"]) {
    assert.ok(page.split("const CALENDAR_REPORTS")[1].split("]);")[0].includes(`"${name}"`), `${name} not in CALENDAR_REPORTS`);
  }
  assert.match(page, /<AttendanceCalendar data=\{calendarData\}/);
  assert.match(cal, /export function visibleCalendarRows/);
  assert.match(page, /shownCalendar.length/);
});
