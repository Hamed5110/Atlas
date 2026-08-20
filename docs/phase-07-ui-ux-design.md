# Phase 7 — UI/UX Design

## Information architecture

```text
Sign in
└─ Workspace
   ├─ Dashboard
   ├─ Employees
   │  ├─ Employee register / detail
   │  └─ Import preview / export
   ├─ Entitlements
   │  ├─ Opening balances
   │  ├─ Calculator
   │  └─ Allocation ledger / year close
   ├─ Tickets
   │  ├─ My requests / team queue / finance queue
   │  └─ Ticket detail, approvals, evidence, payment
   ├─ Loans
   │  ├─ Recovery register / schedule / payments
   │  └─ Payroll reconciliation / deferments
   ├─ Reports
   ├─ Preferences
   └─ Administration (users, roles, policy, audit, integrations)
```

The current PySide6 shell at `desktop/main.py:243-293` exposes ten navigation entries, but most are read-only generic tables. Only Employees, Opening Balances, Tickets and Loans refresh; Entitlement calculates. Preferences, reports, ESS and administration are non-functional screen shells. The web client provides dashboard, four read tables, calculator, effective-preference JSON and one report download.

## Screen patterns and textual wireframes

```text
┌ Navigation ┬ Page title                 [Company] [User] ┐
│ Tickets    │ Filters: Status Employee Date Amount       │
│ Entitle... │ [New request] [Export]                      │
│ Loans      ├─────────────────────────────────────────────┤
│ Reports    │ □ Ref  Employee  Route  Amount Status Ver  │
│ Admin      │ □ ...                                      │
│            ├─────────────────────────────────────────────┤
│            │ 1–50 of N            ‹ Previous  Next ›    │
└────────────┴─────────────────────────────────────────────┘
```

```text
Ticket T-2026-0042  [Submitted]  Version 3
Employee / company / travel date / route
Cost | entitlement | company paid | excess
Evidence [scan status]        Approval timeline
Comments / rejection reason
[Return] [Reject] [Approve]   (actions shown by permission)
```

## User journeys

1. HR imports employees: select XLSX → local file constraints → server dry-run → row-level grid → fix/re-upload → confirm count/control total → commit → audit receipt.
2. Employee/HR requests ticket: select employee → system loads entitlement → enter route/date/cost → upload evidence → save draft → submit → manager and finance decisions → payment.
3. Finance recovers excess: approved ticket creates proposed loan → review terms/schedule → activate → include in payroll → reconcile acknowledgement → post deductions → settle.
4. Administrator changes preference: select scope → compare inherited/effective value → validate conditional rules → preview light/dark → publish with version.

## Data-grid rules

Server-side cursor pagination and stable tie-break by ID; sortable/filterable columns are allowlisted. Currency is right-aligned with company currency, dates locale-displayed but ISO-exported, status uses text plus icon (never color alone). Preserve selected rows by ID across refresh. Inline edit is limited to low-risk fields; financial/workflow edits use a detail form. Bulk actions show eligibility count and require confirmation. Empty, loading, partial-error and stale-version states are explicit. Export uses current authorized filter and records control totals.

## Conditional formatting engine

A rule is `{id, scope, entity, enabled, priority, when, style}`. Priority is integer 1–100; evaluate highest priority first, then stable ID. `when` is a recursive node:

```json
{"all":[
  {"field":"status","operator":"eq","value":"submitted"},
  {"any":[
    {"field":"excess_amount","operator":"gt","value":"0"},
    {"field":"travel_date","operator":"lt","value":"$today"}
  ]}
]}
```

Supported operators: `eq`, `ne`, `gt`, `lt`, `gte`, `lte`, `between`, `contains`, `starts_with`, `ends_with`, `in_list`, `is_null`, `is_not_null`; nesting uses `all` (AND) and `any` (OR), maximum depth 5 and 50 predicates. Types are schema-checked; string comparisons are Unicode case-folded only when `case_sensitive=false`; money/date compare as typed values. `between` is inclusive. Missing fields do not match except `is_null`.

Style permits semantic `foreground`, `background`, `font_weight`, `font_style`, `underline`, `icon`, `badge`, and `accessible_label`. Values reference approved theme tokens only. Multiple matching rules merge by descending priority only for non-conflicting properties; first property wins. Contrast is revalidated in both themes. Current `conditional_format()` supports only status/threshold semantic tokens and PySide6 searches hard-coded cell strings; the general engine is target scope.

## Theme tokens

| Token | Light | Dark |
|---|---|---|
| surface/base | `#FFFFFF` / `#F3F6F9` | `#17212B` / `#101820` |
| text/primary | `#172B3D` | `#F2F6FA` |
| text/muted | `#526579` | `#B3C0CC` |
| border | `#DCE5EE` | `#40505E` |
| accent | `#2463A6` | `#66AEF2` |
| success | `#197149` | `#55D69A` |
| warning | `#8A5200` | `#FFD166` |
| danger | `#B42318` | `#FF8A80` |
| focus | `#005FCC` 3px ring | `#8CC8FF` 3px ring |

## WCAG 2.2 AA

- Keyboard access for every action; logical focus order, visible focus not obscured, Escape closes modal and focus returns to trigger.
- Normal text contrast ≥4.5:1, large text/UI graphics ≥3:1; 200% zoom and 320 CSS px reflow without lost function.
- Labels, instructions and errors programmatically associated; errors identify field and correction, with summary focus.
- Status updates use appropriate live regions; tables have captions/headers and sortable state.
- Touch targets at least 24×24 CSS px with spacing; no drag-only or color-only interaction.
- Session timeout warns and permits extension; authentication supports password manager/paste.
- PySide6 supplies accessible names/descriptions, tab order, shortcuts, high-DPI scaling and screen-reader test evidence.

## Current vs target gaps

Neither client supports creation/approval/payment workflows end-to-end, server pagination, stale conflict recovery, dark theme, preference rule editing, or demonstrated WCAG testing. The web’s inline CSS has a light-only `color-scheme`; PySide6 has no theme token layer.
