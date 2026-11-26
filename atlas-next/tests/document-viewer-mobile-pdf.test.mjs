import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("document viewer draws PDFs with pdf.js where the browser cannot embed them", () => {
  const src = read("components/document-viewer.tsx");
  // Only fine-pointer browsers with a built-in PDF viewer get the iframe.
  assert.match(src, /pdfViewerEnabled === true && !window\.matchMedia\("\(pointer: coarse\)"\)\.matches/);
  assert.match(src, /const drawnPdf = kind === "pdf" && !embedPdf/);
  assert.match(src, /loaded && drawnPdf \?[\s\S]{0,200}<PdfPages/);
  // Drawn PDFs get zoom/rotate and a print path that does not depend on an iframe PDF.
  assert.match(src, /const zoomable = kind === "image" \|\| drawnPdf/);
  assert.match(src, /pdfPageImages\(loaded\.blob\)/);
});

test("allocation documents open on one merged PDF, then the slip, then each upload", () => {
  const src = read("app/(app)/allocation/page.tsx");
  assert.match(src, /getBlob\(`\/allocations\/\$\{ticket\.id\}\/documents\.pdf`\)/);
  assert.match(
    src,
    /mergedDoc\(viewerTicket, viewerAttachments\.data \?\? \[\]\),\s*allocationDoc\(viewerTicket\),\s*\.\.\.toViewerDocs/
  );
  // The merged file must rebuild when uploads change, so its cache key carries the attachment ids.
  assert.match(src, /key: `merged-\$\{ticket\.id\}-\$\{ticket\.version\}-\$\{rows\.map/);
  assert.match(src, /found >= 0 \? found \+ LEADING_DOCS : 0/);
  const messages = read("lib/i18n/messages.ts");
  assert.equal(messages.match(/"alloc\.docs\.merged":/g)?.length, 2, "English and Arabic labels");
});

test("pdf.js uses the legacy build, a bundled worker and capped canvases", () => {
  const src = read("components/pdf-pages.tsx");
  assert.match(src, /import\("pdfjs-dist\/legacy\/build\/pdf\.mjs"\)/);
  assert.match(src, /new Worker\(\s*new URL\("pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs", import\.meta\.url\)/);
  assert.match(src, /MAX_CANVAS_PIXELS/);
  assert.match(src, /IntersectionObserver/);
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies["pdfjs-dist"], "pdfjs-dist must be a runtime dependency");
});
