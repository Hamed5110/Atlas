# ATLAS Preferences Module Rebuild - 2026-08-01

## Chosen pattern

ATLAS now uses a route-based settings module at `/preferences/` with a sticky left settings rail and a focused form/card column. This follows the durable pattern seen in `satnaing/shadcn-admin` settings pages, Origin UI settings forms, and shadcn sheet/dialog examples: categories stay visible, each section owns its own controls, and destructive actions require explicit confirmation.

Tabs were rejected for this module because ATLAS has six categories plus safety/import actions. Tabs would hide operational context and encourage another oversized form.

## File layout

```text
atlas-hcm-next/
  app/(dashboard)/preferences/page.tsx
  features/preferences/
    preferences.schema.ts
    preferences.store.tsx
    usePreferences.ts
    components/
      PreferencesShell.tsx
      PreferencesShell.module.css
  lib/api/preferences.ts
  tests/preferences-modern-source.test.mjs

server.js
tests/preferences-api-contract.test.js
```

## Architecture decisions

- Schema: Zod schema in `features/preferences/preferences.schema.ts`.
- State: small React reducer/context in `preferences.store.tsx`; no global app context.
- Persistence: `usePreferences.ts` writes local draft immediately and batches backend saves after 1 second.
- API client: `lib/api/preferences.ts` is the only frontend path for `GET /api/preferences` and `PUT /api/preferences`.
- Backend: `server.js` stores the full schema document in `UserPreferences.PreferencesJSON` and keeps legacy split columns populated.
- Idempotency: each save sends an `idempotencyKey`; the backend caches recent save results per user/year/key.

## Migration stance

- Old embedded Preferences inside `app/page.tsx` is frozen as legacy fallback code.
- Normal navigation now routes users to `/preferences/`.
- No new Preferences features should be added to `app/page.tsx`.
- Old local storage key `atlas.ui.preferences` is migrated into schema v2 and saved as `atlas.preferences.v2`.

## Safety rules

- Appearance/workspace toggles may save through debounce.
- Import, reset, and mute-all warnings require confirmation dialogs.
- JSON import must validate/migrate before save.
- Backend payloads must be validated before SQL writes.
- SQL writes must be upserts, not blind inserts.
- 429/409/422/500 errors must be shown in the page status banner, not swallowed.

## Test coverage

- Frontend source contract: route exists, schema exists, sections render, debounce/idempotency exists, destructive dialogs exist.
- Backend source contract: endpoints exist, `PreferencesJSON` is stored, legacy columns remain populated, upsert/idempotency/conflict handling exists.
- Build check: `npm --prefix atlas-hcm-next run build`.

## Rollout guardrail

Do not delete the old Preferences JSX until:

1. `/preferences/` is included in the exported MSI/EXE frontend.
2. `GET /api/preferences` and `PUT /api/preferences` pass against a real SQL database.
3. At least one installed machine migrates `atlas.ui.preferences` to schema v2 successfully.
4. Support confirms no installer cache is serving the old build by checking `/api/version`.
