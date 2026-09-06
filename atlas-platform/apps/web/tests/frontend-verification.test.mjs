import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(source, /function validateAllocationTicketForm\(/, "allocation form should have a client-side validator");
assert.match(source, /function validateSelfServiceTicketForm\(/, "self-service ticket form should have a client-side validator");
assert.match(source, /function InlineFieldError\([\s\S]*role="alert"/, "inline errors should announce validation feedback");
assert.match(source, /aria-invalid[\s\S]*aria-describedby/, "invalid fields should link controls to inline errors");
assert.match(source, /function syncWorkspaceThemeDom\(themeMode: ThemeMode, themeAccent: ThemeAccent, uiDensity: UiDensity, customAccent = "#0b63f6"\)/, "theme engine should centralize DOM dataset synchronization with custom accent support");
assert.match(source, /document\.documentElement[\s\S]*dataset\.theme\s*=\s*themeMode[\s\S]*dataset\.themeRevision/, "theme changes should force root DOM dataset updates");
assert.match(source, /atlas:theme-preference-change/, "theme mutations should emit a local UI telemetry event");
assert.match(source, /void atlasHealth\(\)\.catch\(\(\) => undefined\)/, "theme preference mutations should ping the existing backend service path");
assert.match(source, /themeTelemetryTimerRef[\s\S]*setTimeout[\s\S]*1200[\s\S]*atlasHealth/, "theme preference health pings should be debounced to avoid API bursts");
assert.match(source, /data-theme=\{themeMode\}[\s\S]*data-accent=\{themeAccent\}[\s\S]*data-density=\{uiDensity\}/, "root shell should expose active theme state as data attributes");

const allocationSubmit = source.match(/async function handleCreateAllocation\(\)[\s\S]*?const allocation = await atlasMutation<Allocation>/)?.[0] || "";
assert.match(allocationSubmit, /validateAllocationTicketForm\(/, "allocation validation should run before saving");
assert.match(allocationSubmit, /Object\.keys\(errors\)\.length[\s\S]*return/, "allocation validation should stop invalid saves before the network call");

const selfServiceSubmit = source.match(/async function submitSelfServiceRequest\(event: React\.FormEvent\)[\s\S]*?await atlasMutation<EmployeeAllowanceRequest>/)?.[0] || "";
assert.match(selfServiceSubmit, /validateSelfServiceTicketForm\(/, "self-service validation should run before submitting");
assert.match(selfServiceSubmit, /Object\.keys\(errors\)\.length[\s\S]*return/, "self-service validation should stop invalid requests before the network call");

assert.match(css, /@media \(min-width:\s*1800px\)[\s\S]*\.airfare-layout\.recent-open/, "HD desktop layout should have an explicit 1800px breakpoint");
assert.match(css, /@media \(min-width:\s*2400px\)[\s\S]*\.airfare-layout\.recent-open/, "2K and 4K layout should have an explicit wide breakpoint");
assert.match(css, /--shell-max:\s*2560px/, "shell should be constrained for HD and 4K workspaces");
assert.match(css, /--control-h:\s*42px/, "controls should share a compact operations-console height token");
assert.match(css, /\[data-theme="light"\][\s\S]*--surface-glass:[\s\S]*--shadow-extruded:[\s\S]*--bg-app:/, "light theme should compile the design token contract");
assert.match(css, /\[data-theme="dark"\][\s\S]*--surface-glass:[\s\S]*--shadow-extruded:[\s\S]*--bg-app:/, "dark theme should compile the same design token contract");
assert.match(css, /\[data-theme="contrast"\][\s\S]*--surface-glass:[\s\S]*--shadow-extruded:[\s\S]*--bg-app:/, "high contrast theme should compile the same design token contract");
assert.match(source, /THEME_PRESETS[\s\S]*Light Professional[\s\S]*Dark Professional[\s\S]*Ocean Blue[\s\S]*Forest Green[\s\S]*Sunset Orange[\s\S]*High Contrast/, "theme selector should expose six saved workspace theme options");
assert.match(css, /\.glass-panel\s*{[\s\S]*transform-style:\s*flat/, "app panels should use a flatter operations-console visual layer");
assert.match(css, /\.shine-button:active\s*{[\s\S]*transform:\s*none/, "primary buttons should avoid old 3D compression");
assert.match(css, /\.icon-button:hover svg,[\s\S]*transform:\s*scale\(1\.08\)\s*rotate\(-5deg\)/, "SVG icons should animate with scale and rotation on hover");
assert.match(css, /\.airfare-layout\.recent-open\s*{[\s\S]*grid-template-columns:\s*minmax\(300px,\s*clamp\(330px,\s*21vw,\s*400px\)\)\s*minmax\(0,\s*1fr\)/, "recent allocations should stay as a compact left drawer with a stable form column");
assert.match(css, /\.form-grid input\[aria-invalid="true"\][\s\S]*border-color:\s*rgba\(220,38,38,\.62\)/, "invalid controls should have visible error styling");
assert.match(css, /\.field-error\s*{[\s\S]*display:\s*inline-flex[\s\S]*line-height:\s*1\.35/, "inline errors should remain compact and aligned");
assert.match(css, /\[dir="rtl"\] \.airport-search-toggle\s*{[\s\S]*left:\s*8px[\s\S]*right:\s*auto/, "RTL airport search controls should mirror toggle placement");
assert.match(css, /\[dir="rtl"\] \.nav-item:hover,[\s\S]*transform:\s*translateX\(-2px\)/, "RTL nav motion should mirror LTR motion");
assert.match(css, /font-family:\s*Inter,\s*Cairo,\s*Amiri/, "font stack should include Cairo and Amiri for Arabic text");
assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*transition-duration:\s*\.001ms/, "motion system should honor reduced-motion preferences");
assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.topbar\s*{[\s\S]*position:\s*static/, "mobile topbar should stay in document flow instead of crowding content");
assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.allocation-ticket-form,[\s\S]*\.self-service-ticket-form,[\s\S]*grid-template-columns:\s*1fr/, "ticket forms should stack cleanly on mobile");

assert.doesNotMatch(source, /fetch\(["']http:\/\/127\.0\.0\.1:3366|fetch\(["']http:\/\/127\.0\.0\.1:3355/, "frontend should keep using existing API helpers instead of hard-coded local ports");

console.log("Frontend verification passed: layout, responsive breakpoints, accessible validation, and pre-network guards are present.");
