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
assert.match(css, /\.airfare-layout\.recent-open\s*{[\s\S]*grid-template-columns:\s*minmax\(320px,\s*clamp\(360px,\s*24vw,\s*430px\)\)\s*minmax\(0,\s*1fr\)/, "recent allocations should stay as a left drawer with a stable form column");
assert.match(css, /\.form-grid input\[aria-invalid="true"\][\s\S]*border-color:\s*rgba\(220,38,38,\.62\)/, "invalid controls should have visible error styling");
assert.match(css, /\.field-error\s*{[\s\S]*display:\s*inline-flex[\s\S]*line-height:\s*1\.35/, "inline errors should remain compact and aligned");
assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.allocation-ticket-form,[\s\S]*\.self-service-ticket-form,[\s\S]*grid-template-columns:\s*1fr/, "ticket forms should stack cleanly on mobile");

console.log("Frontend verification passed: layout, responsive breakpoints, accessible validation, and pre-network guards are present.");
