# ATLAS Frontend Alignment Audit

Date: 2026-06-28

## User Issue

Frontend alignment was wrong across the display, especially on narrow screens. The earlier Support-only fix did not address the shared layout causes.

## Research Sources Used

- W3Schools CSS grid and responsive layout references.
- GitHub Primer design system layout and spacing concepts.
- Bootstrap responsive grid and alignment documentation.
- Tailwind flex/grid/min-width alignment utilities.
- W3C/WCAG text spacing guidance.

## Root Cause Found

The browser audit found shared layout rules that still forced desktop-sized columns inside narrow containers:

- `preferences-policy-card .form-grid.one` used `minmax(260px, 1fr)` columns.
- `preferences-policy-card .calc-result` used fixed minimum columns.
- Opening Balance reused that policy card class, causing a 532px internal grid inside a 366px mobile container.
- Report fit mode did not fully switch to a fixed, viewport-safe table layout.

## Fix Applied

- Replaced fixed minimum form columns with `minmax(0, 1fr)`.
- Replaced fixed minimum summary columns with shrinkable columns.
- Added mobile single-column rules for:
  - `.form-grid.one`
  - `.form-grid.two`
  - `.preferences-policy-card .form-grid.one`
  - `.preferences-policy-card .calc-result`
  - `.preferences-policy-card .policy-rule-picker`
  - `.policy-rule-picker`
- Added safe mobile card sizing for `.form-card`, `.table-card`, and `.hcm-card`.
- Updated report fit mode to use `table-layout: fixed`, `min-width: 0`, and wrapped cell text.
- Preserved intentional horizontal scroll only for wide report mode.

## Browser Audit Result

Measured with Playwright against `http://<server-name>/`.

Viewports:

- Desktop: 1440 x 1000
- Tablet: 900 x 1000
- Mobile: 390 x 900

Screens checked:

- Overview
- Employees
- Opening Balance
- Airfare
- Loans
- Year End
- Reports
- Companies
- Preferences
- AI Insights
- Security
- Support

Final result:

```text
Desktop: 0 overflow / 0 offenders
Tablet: 0 overflow / 0 offenders
Mobile: 0 overflow / 0 offenders
```

## Screenshot Artifacts

Representative fixed screenshots were saved under:

```text
test-reports/ui-fixed-opening-balance-mobile.png
test-reports/ui-fixed-reports-mobile.png
test-reports/ui-fixed-preferences-mobile.png
test-reports/ui-fixed-ai-insights-mobile.png
test-reports/ui-fixed-support-mobile.png
```

Full audit screenshots are also available under:

```text
test-reports/ui-audit-*-desktop.png
test-reports/ui-audit-*-tablet.png
test-reports/ui-audit-*-mobile.png
```

## Regression Guardrails

`atlas-hcm-next/tests/ui-layout-source.test.mjs` now checks:

- Shrinkable opening balance/preferences form columns.
- Mobile single-column collapse for policy/opening balance cards.
- Report fit mode fixed layout.
- Wide report mode keeps intentional table-only horizontal scroll.
