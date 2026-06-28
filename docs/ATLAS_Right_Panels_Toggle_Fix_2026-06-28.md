# ATLAS Right Panels Toggle Fix

Date: 2026-06-28

## Issue

The topbar `Hide right panels` button appeared not to work on some screens.

## Root Cause

The global collapsed class was applied correctly:

```text
right-panels-collapsed
```

However, the Reports screen used a dedicated right panel:

```text
.report-check-panel
```

That panel was not included in the global hide rule, so clicking `Hide right panels` changed the grid to one column but left `Report checks` visible full-width.

## Fix

- Added Reports right panel to the global hide rule.
- Added an active visual state for the icon button.
- Added `aria-label` and `aria-pressed` so the button clearly reports its state.
- Added source regression tests for this exact behavior.

## Browser Verification

Before click on Reports:

```text
Report check panel display: block
Grid columns: two columns
Button state: Hide right panels / aria-pressed=false
```

After click:

```text
Report check panel display: none
Grid columns: one column
Button state: Show right panels / aria-pressed=true
```

Screenshot:

```text
test-reports/right-panels-toggle-reports-fixed.png
```

## Port Consolidation

Current active application port:

```text
0.0.0.0:3355
```

Proxy fallback:

```text
80
```

## Tests

- UI layout source test: passed
- Frontend production build: passed
- Backend syntax check: passed
- Smoke test: passed
- Acceptance regression: passed
- Full system test: passed
- Environment verification: passed
- Automatic verification model: passed
