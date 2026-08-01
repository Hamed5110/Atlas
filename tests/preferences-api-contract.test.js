const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const serverText = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert.match(serverText, /app\.get\('\/api\/preferences'/, 'GET /api/preferences endpoint is required');
assert.match(serverText, /app\.put\('\/api\/preferences'/, 'PUT /api/preferences endpoint is required');
assert.match(serverText, /ensureUserPreferencesStorage/, 'Preferences API must ensure compatible SQL storage exists');
assert.match(serverText, /PreferencesJSON/, 'Preferences API must persist the full schema JSON document');
assert.match(serverText, /ThemeSettingsJSON[\s\S]*LayoutSettingsJSON[\s\S]*NavigationSettingsJSON/, 'Preferences API must keep legacy split columns populated');
assert.match(serverText, /idempotencyKey[\s\S]*preferencesSaveCache/, 'Preferences save must use idempotency keys');
assert.match(serverText, /PREFERENCES_PAYLOAD_INVALID/, 'Preferences API must validate payloads before SQL writes');
assert.match(serverText, /PREFERENCES_CONFLICT/, 'Duplicate SQL conflicts must map to a non-500 conflict response');
assert.match(serverText, /PREFERENCES_JSON_INVALID/, 'Invalid JSON must map to a structured unprocessable response');
assert.match(serverText, /ISJSON\(@PreferencesJSON\)/, 'SQL layer must reject invalid preferences JSON');
assert.match(serverText, /MERGE dbo\.UserPreferences WITH \(HOLDLOCK\)/, 'Preferences writes must use an atomic upsert pattern');

console.log('preferences API contract checks passed');
