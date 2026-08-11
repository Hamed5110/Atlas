import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..");
const version = "0.3.0";
const outDir = join(repoRoot, "artifacts", "greenfield-core-mssql-0.3.0");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const folder of ["src", "web", "schema", "docs", "tests"]) {
  cpSync(join(root, folder), join(outDir, folder), { recursive: true });
}
copyFileSync(join(root, "package.json"), join(outDir, "package.json"));
copyFileSync(join(root, ".gitignore"), join(outDir, ".gitignore"));

const manifest = {
  product: "ATLAS Greenfield Core",
  version,
  buildTimestampUtc: new Date().toISOString(),
  entrypoint: "src/server.js",
  defaultPort: 3356,
  oldRuntimeLinked: false,
  packagingBoundary: "independent-greenfield-artifact-not-attached-to-legacy-installer",
  repositoryModes: ["mssql-core"],
  defaultRepositoryMode: "mssql",
  database: {
    defaultName: "AtlasGreenfieldCore",
    schema: "core",
    schemaContract: "schema/mssql/001_foundation.sql"
  },
  modules: ["companies", "employees", "openingSeeds", "entitlements", "allocations", "loans"],
  schemaContract: "schema/mssql/001_foundation.sql",
  hashes: {
    server: sha256(join(outDir, "src", "server.js")),
    ui: sha256(join(outDir, "web", "index.html")),
    schema: sha256(join(outDir, "schema", "mssql", "001_foundation.sql")),
    tests: sha256(join(outDir, "tests", "employee-requirements.test.js"))
  }
};

writeFileSync(join(outDir, "greenfield-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`ATLAS greenfield artifact built: ${outDir}`);

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
