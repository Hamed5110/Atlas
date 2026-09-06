import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const route = read("app/(dashboard)/preferences/page.tsx");
const shell = read("features/preferences/components/PreferencesShell.tsx");
const schema = read("features/preferences/preferences.schema.ts");
const store = read("features/preferences/preferences.store.tsx");
const hook = read("features/preferences/usePreferences.ts");
const api = read("lib/api/preferences.ts");

assert.match(route, /PreferencesShell/, "Preferences must render through the route-based shell");
assert.match(schema, /z\.object/, "Preferences schema must be Zod-backed");
assert.match(schema, /schemaVersion:\s*z\.literal\(ATLAS_PREFERENCES_SCHEMA_VERSION\)/, "Schema version must be explicit");
assert.match(schema, /migrateLegacyAtlasPreferences/, "Legacy local preferences must have a migration path");

for (const section of ["appearance", "workspace", "dataSafety", "keyboard", "notifications", "admin"]) {
  assert.match(schema, new RegExp(section), `Missing schema section: ${section}`);
  assert.match(shell, new RegExp(section), `Missing rendered section: ${section}`);
}

assert.match(store, /hasUnsavedChanges/, "Store must track unsaved changes");
assert.match(store, /currentSection/, "Store must track active settings section");
assert.match(hook, /SAVE_DEBOUNCE_MS\s*=\s*1000/, "Preferences saves must be debounced");
assert.match(hook, /idempotencyKey/, "Preferences saves must send idempotency keys");
assert.match(hook, /atlas\.ui\.preferences/, "Hook must migrate old local preference storage");
assert.match(api, /PUT/, "Typed API client must support saving preferences");
assert.match(api, /\/preferences/, "Typed API client must use the preferences endpoint");

assert.match(shell, /Mute all warnings\?/, "Mute-all warnings must require confirmation");
assert.match(shell, /Reset all preferences\?/, "Reset must require confirmation");
assert.match(shell, /Import preferences JSON\?/, "Import must require confirmation");
assert.match(shell, /Live preview/, "Appearance section must include live preview");
assert.match(shell, /Shortcut list is read-only/, "Keyboard section must expose read-only shortcut registry");

console.log("modern preferences module source checks passed");
