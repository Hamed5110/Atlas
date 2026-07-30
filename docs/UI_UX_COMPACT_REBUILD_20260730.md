# UI/UX compact rebuild - 2026-07-30

## Problem

The application UI became too large after the previous Preferences redesign. Cards, header blocks, sidebars, controls, and shadows felt oversized for daily work.

## Design direction

Open-source dashboard research from Tremor, shadcn-style admin dashboards, and compact React admin templates points to:

- smaller control heights,
- flatter shadows,
- compact KPI cards,
- restrained hero sections,
- responsive grids that do not grow aggressively on wide screens,
- less decorative 3D motion.

## Changes

- Reduced global topbar height from 60px to 52px.
- Reduced default control height from 48/54px patterns to 42px.
- Reduced sidebar width and padding.
- Reduced card padding and large-screen growth.
- Flattened the old glass/3D interaction layer.
- Reduced hero, Preferences insight cards, buttons, calc summaries, and sticky panel sizes.
- Tightened Airfare split-panel layout so the left drawer does not become huge.
- Updated UI source tests to protect the compact operations-console baseline.

## Verification

- `npm run check` passed.
- `npm run test:company-admin` passed.
- `npm --prefix atlas-hcm-next test` passed.
- `npm --prefix atlas-hcm-next run build` passed.
- `npm run test:full` passed.

Full system report:

- `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730092127.md`
- `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730092127.json`
