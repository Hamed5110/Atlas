// Writes public/BUILD_STAMP.txt before `next build` so the static export
// carries a deployment marker. Without this file the SPA host's index.html
// fallback answers GET /BUILD_STAMP.txt with a full HTML document (HTTP 200),
// which then leaks raw "<!DOCTYPE html>..." text into the UI.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let appVersion = "3.0.15";
try {
  appVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version || appVersion;
} catch {
  /* keep default */
}
if (process.env.ATLAS_VERSION) appVersion = process.env.ATLAS_VERSION;

let git = "";
try {
  git = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {
  git = "";
}

const stamp = [appVersion, new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), git].filter(Boolean).join(" ");
mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public", "BUILD_STAMP.txt"), `${stamp}\n`, "utf8");
writeFileSync(join(root, "public", "ATLAS_VERSION.txt"), `${appVersion}\n`, "utf8");
console.log(`BUILD_STAMP.txt: ${stamp}`);
