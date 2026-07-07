import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(source, /function validateAllocationTicketForm\(/, "allocation form should have a client-side validator");
assert.match(source, /function validateSelfServiceTicketForm\(/, "self-service ticket form should have a client-side validator");
assert.match(source, /function InlineFieldError\([\s\S]*role="alert"/, "inline errors should announce validation feedback");
assert.match(source, /aria-invalid[\s\S]*aria-describedby/, "invalid fields should link controls to inline errors");

const allocationSubmit = source.match(/async function handleCreateAllocation\(\)[\s\S]*?const allocation = await atlasMutation<Allocation>/)?.[0] || "";
assert.match(allocationSubmit, /validateAllocationTicketForm\(/, "allocation validation should run before saving");
assert.match(allocationSubmit, /Object\.keys\(errors\)\.length[\s\S]*return/, "allocation validation should stop invalid saves before the network call");

const selfServiceSubmit = source.match(/async function submitSelfServiceRequest\(event: React\.FormEvent\)[\s\S]*?await atlasMutation<EmployeeAllowanceRequest>/)?.[0] || "";
assert.match(selfServiceSubmit, /validateSelfServiceTicketForm\(/, "self-service validation should run before submitting");
assert.match(selfServiceSubmit, /Object\.keys\(errors\)\.length[\s\S]*return/, "self-service validation should stop invalid requests before the network call");

assert.match(css, /@media \(min-width:\s*1800px\)[\s\S]*\.airfare-layout\.recent-open/, "HD desktop layout should have an explicit 1800px breakpoint");
assert.match(css, /@media \(min-width:\s*2400px\)[\s\S]*\.airfare-layout\.recent-open/, "2K and 4K layout should have an explicit wide breakpoint");
assert.match(css, /--shell-max:\s*2560px/, "shell should be constrained for HD and 4K workspaces");
assert.match(css, /--control-h:\s*54px/, "controls should share a stable HD height token");
assert.match(css, /\.airfare-layout\.recent-open\s*{[\s\S]*grid-template-columns:\s*minmax\(340px,\s*clamp\(380px,\s*24vw,\s*460px\)\)\s*minmax\(0,\s*1fr\)/, "recent allocations should stay as a left drawer with a stable form column");
assert.match(css, /\.form-grid input\[aria-invalid="true"\][\s\S]*border-color:\s*rgba\(220,38,38,\.62\)/, "invalid controls should have visible error styling");
assert.match(css, /\.field-error\s*{[\s\S]*display:\s*inline-flex[\s\S]*line-height:\s*1\.35/, "inline errors should remain compact and aligned");
assert.match(css, /\[dir="rtl"\] \.airport-search-toggle\s*{[\s\S]*left:\s*8px[\s\S]*right:\s*auto/, "RTL airport search controls should mirror toggle placement");
assert.match(css, /\[dir="rtl"\] \.nav-item:hover,[\s\S]*transform:\s*translateX\(-2px\)/, "RTL nav motion should mirror LTR motion");
assert.match(css, /font-family:\s*Inter,\s*Cairo,\s*Amiri/, "font stack should include Cairo and Amiri for Arabic text");
assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.topbar\s*{[\s\S]*position:\s*static/, "mobile topbar should stay in document flow instead of crowding content");
assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.allocation-ticket-form,[\s\S]*\.self-service-ticket-form,[\s\S]*grid-template-columns:\s*1fr/, "ticket forms should stack cleanly on mobile");

assert.doesNotMatch(source, /fetch\(["']http:\/\/127\.0\.0\.1:3366|fetch\(["']http:\/\/127\.0\.0\.1:3355/, "frontend should keep using existing API helpers instead of hard-coded local ports");

console.log("Frontend verification passed: layout, responsive breakpoints, accessible validation, and pre-network guards are present.");
