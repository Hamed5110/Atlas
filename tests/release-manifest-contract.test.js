const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'release', 'atlas-release-manifest.json');
const buildScript = fs.readFileSync(path.join(root, 'installer', 'Build-ATLAS-Release.ps1'), 'utf8');
const patchScript = fs.readFileSync(path.join(root, 'installer', 'Invoke-ATLAS-ManifestPatch.ps1'), 'utf8');
const serverText = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const docsText = fs.readFileSync(path.join(root, 'docs', 'MSI_EXE_VERSIONED_PATCH_SYSTEM_20260801.md'), 'utf8');

assert.ok(fs.existsSync(manifestPath), 'release manifest must exist');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

for (const field of [
  'manifestSchemaVersion',
  'product',
  'productCode',
  'version',
  'gitCommit',
  'frontendBuildHash',
  'backendBuildHash',
  'databaseSchemaVersion',
  'service',
  'artifacts',
  'minimumUpgradeableVersion',
  'migrationPlan'
]) {
  assert.ok(manifest[field] !== undefined && manifest[field] !== null, `manifest missing ${field}`);
}

assert.equal(manifest.productCode, 'ATLAS_AIRFARE_ALLOWANCE');
assert.match(manifest.artifacts.msi.file, new RegExp(`${manifest.version.replace(/\./g, '\\.')}-x64\\.msi$`), 'MSI filename should include manifest version');
assert.match(manifest.artifacts.exe.file, new RegExp(`${manifest.version.replace(/\./g, '\\.')}-x64\\.exe$`), 'EXE filename should include manifest version');
assert.ok(Array.isArray(manifest.migrationPlan) && manifest.migrationPlan.length >= 2, 'migrationPlan should contain real upgrade steps');

for (const migration of manifest.migrationPlan) {
  for (const field of ['id', 'from', 'to', 'type', 'description', 'verify', 'rollback']) {
    assert.ok(migration[field] !== undefined && migration[field] !== null, `migration ${migration.id} missing ${field}`);
  }
}

assert.match(serverText, /app\.get\('\/api\/version'[\s\S]*frontendBuildHash[\s\S]*backendBuildHash[\s\S]*databaseSchemaVersion[\s\S]*artifact/s, '/api/version must expose runtime manifest identity');
assert.match(serverText, /publicApiPaths[\s\S]*\/api\/version/s, '/api/version must be public so installers can verify without login');
assert.match(serverText, /RELEASE_DIR[\s\S]*RELEASE_VERSION_PATH[\s\S]*version\.json/s, 'runtime should read release/version.json');
assert.match(serverText, /manifestHash[\s\S]*sha256FileIfExists/s, 'runtime version endpoint should expose a manifest hash');

assert.match(buildScript, /Build-ATLAS-MSI\.ps1[\s\S]*deploy\.ps1[\s\S]*-Mode Build[\s\S]*-UpdateOnly/s, 'release build should produce MSI and EXE from one script');
assert.match(buildScript, /frontendBuildHash[\s\S]*Get-DirectoryHash[\s\S]*atlas-hcm-next\\out/s, 'release build should hash frontend output');
assert.match(buildScript, /backendBuildHash[\s\S]*Get-BackendHash/s, 'release build should hash backend payload');
assert.match(buildScript, /Manifest version[\s\S]*does not match requested version/s, 'release build should block manifest/version mismatch');
assert.match(buildScript, /Git commit changed during release build/s, 'release build should block source changes during packaging');

assert.match(patchScript, /Get-InstalledState[\s\S]*registry[\s\S]*install-state[\s\S]*http[\s\S]*release-version-file/s, 'patch should detect installed state from registry, file, endpoint, and version file');
assert.match(patchScript, /Select-Migrations[\s\S]*Test-VersionRange/s, 'patch should select migrations from version ranges');
assert.match(patchScript, /pending-patch\.json/s, 'patch should write a rollback marker');
assert.match(patchScript, /patch-history\.json/s, 'patch should write patch history');
assert.match(patchScript, /Assert-RuntimeMatchesManifest[\s\S]*frontendBuildHash[\s\S]*backendBuildHash[\s\S]*databaseSchemaVersion/s, 'patch should verify runtime identity against manifest');
assert.match(patchScript, /Restore-RollbackFiles/s, 'patch should include rollback file restoration');
assert.match(patchScript, /HKLM:\\SOFTWARE\\ATLAS\\AirfareAllowance/s, 'patch should write canonical registry metadata');

assert.match(docsText, /Decision table/i, 'docs should include decision table');
assert.match(docsText, /Frontend hash mismatch failure/i, 'docs should include frontend mismatch failure behavior');
assert.match(docsText, /pending-patch\.json/i, 'docs should document rollback marker');

console.log('release manifest and MSI/EXE patch contract checks passed');
