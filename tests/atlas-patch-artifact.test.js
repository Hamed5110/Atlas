const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const deployText = fs.readFileSync(path.join(root, 'installer', 'bootstrapper', 'deploy.ps1'), 'utf8');
const bundleText = fs.readFileSync(path.join(root, 'installer', 'bootstrapper', 'Bundle.wxs'), 'utf8');
const msiBuildText = fs.readFileSync(path.join(root, 'installer', 'Build-ATLAS-MSI.ps1'), 'utf8');
const serverText = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert.match(deployText, /function New-AtlasPatchDependencyReport/, 'patch dependency relationship report is missing');
assert.match(deployText, /relationships = @\([\s\S]*ATLAS update EXE[\s\S]*Backend service[\s\S]*Frontend UI[\s\S]*Database repair/, 'dependency map should describe supporting relationships');
assert.match(deployText, /function Invoke-PatchPayloadReplacementAudit/, 'patch file replacement audit is missing');
assert.match(deployText, /patch-file-replacement-audit-\$stamp\.csv/, 'patch should write a per-file copy/replace audit CSV');
assert.match(deployText, /verified_after_copy_or_replace/, 'patch audit should verify installed files after overwrite');
assert.match(deployText, /PatchPayloadFilesVerified/, 'update finalize report should include verified payload counts');
assert.match(deployText, /Save-UpdatePreservedConfig[\s\S]*Restore-UpdatePreservedConfig/, 'update patch must preserve existing app and database configuration');
assert.match(deployText, /Test-AtlasHealth -PortNumber \$effectivePort/, 'update patch must verify the existing configured port after replacement');
assert.match(deployText, /RequireSelfServicePatch/, 'update patch must verify the Employee Self-Service workflow marker');
assert.match(serverText, /payableReportSource:\s*'mssql-procedure-payable-bhd'/, 'backend must expose the payable-report health contract');
assert.match(deployText, /function Assert-PayableReportPatchInstalled[\s\S]*?\$serverText -notmatch[\s\S]{0,120}payableReportSource[\s\S]{0,120}mssql-procedure-payable-bhd/, 'update finalizer must verify the current payable-report health contract');
assert.doesNotMatch(deployText, /serverText -notmatch "payableFromProcedure"/, 'update finalizer must not require an obsolete source-text marker');

assert.match(bundleText, /UpdateOnly[\s\S]*ATLAS Airfare Allowance Update Patch/, 'bundle should support update-only patch mode');
assert.match(bundleText, /Copying patched ATLAS application files/, 'bundle should show application file copy/replace progress');
assert.match(bundleText, /Restarting ATLAS and verifying update/, 'bundle should show finalize verification progress');
assert.match(bundleText, /Condition="ATLASAPPINSTALLED OR WixBundleInstalled"/, 'update patch should require an existing installation');
assert.match(bundleText, /<\?ifndef UpdateOnly \?>\s*<Payload SourceFile="\$\(var\.SqlExpressSetupExe\)" Name="tools\\SQLEXPR_x64_ENU\.exe" \/>\s*<\?endif \?>/, 'update patch must omit SQL Express media while the full installer retains it');

assert.match(msiBuildText, /atlas-payload-manifest\.json/, 'MSI payload manifest generation is required for cross-machine verification');
assert.match(msiBuildText, /Get-FileHash -Algorithm SHA256/, 'MSI manifest should include SHA256 hashes');
assert.match(msiBuildText, /Copying application files into MSI payload/, 'MSI build should stage all application files before packaging');

console.log('ATLAS patch artifact source checks passed');
