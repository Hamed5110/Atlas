# Frontend architecture rebuild - 2026-07-30

## Red-team audit

The current ATLAS frontend still has a high-risk monolithic `app/page.tsx`. A literal one-shot replacement of every screen would risk payroll/airfare business regressions. The safe rebuild path is to extract durable systems first, then migrate screens into smaller modules.

Primary problems found:

- Old UI tokens were scattered across CSS and local component state.
- Preferences existed as narrow appearance flags instead of a durable settings system.
- No JSON schema-backed configuration import/export.
- No keybinding model.
- Notification and privacy controls were not granular.
- Wide-screen styling previously allowed panels/cards to grow too large.

## Research applied

- VS Code settings: schema-backed preferences, JSON export/import, searchable/settings-oriented mental model, keybindings as data.
- shadcn/Radix-style dashboards: accessible primitives, small owned components, simple cards, restrained spacing.
- Vercel/Supabase dashboard patterns: compact settings groups, clear destructive/sync actions, responsive density.

## Implemented architecture

- Added `atlas-hcm-next/lib/atlas-preferences.ts`.
- Added typed `AtlasUserPreferences`.
- Added `atlasPreferencesSchema`.
- Added `createDefaultAtlasPreferences`.
- Added `normalizeAtlasPreferences` for corruption-safe migration.
- Added `parseAtlasPreferencesJson` and `serializeAtlasPreferences`.
- Connected preferences to the existing UI shell without adding dependencies.

## Preferences matrix implemented

- Theme management:
  - Light
  - Dark
  - System
  - High contrast
  - Accent presets
  - Custom accent color
- Layout:
  - Compact / Standard / Comfortable density
  - Grid / List / Split view mode
  - Sidebar and right-panel persistence
- Keyboard shortcuts:
  - Typed keybinding model
  - Scopes: global, navigation, records, reports
  - Toggleable bindings
- Notifications:
  - In-app
  - Desktop
  - Email
  - Year-end
  - Installer
  - Loan
  - Self-service
  - Digest frequency
- Privacy:
  - Mask amounts in screenshots
  - Hide employee identifiers
  - Remember session
  - Health ping after preference changes
- Sync:
  - JSON export
  - JSON import
  - Schema preview

## Bloat decision

No new dependency was added. The project already includes React, Next.js, Headless UI, clsx, lucide-react, Framer Motion, and Recharts. Adding Zustand/Radix for this pass would increase bundle and migration complexity without improving reliability.

## Verification

- `npm run check` passed.
- `npm run test:company-admin` passed.
- `npm --prefix atlas-hcm-next test` passed.
- `npm --prefix atlas-hcm-next run build` passed.
- `npm run test:full` passed.

Full system report:

- `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730094207.md`
- `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730094207.json`
