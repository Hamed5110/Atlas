# UI Diagnosis

## 2026-07-09 - Opening Balance action and summary layout

- Screen: `V2 / Opening Balance`
- Issue 1: the register action controls were escaping the row boundary because the action column was wider than the available left workspace width and did not use a dedicated action-cell wrapper.
- Issue 2: the calculation summary strip used an equal three-column split, which cramped the long MSSQL function label and caused visual overlap with adjacent values.
- Risk check:
  - Backend contracts are unaffected.
  - Fix should stay in the frontend layout layer only.
- Planned fix:
  - Constrain the Opening Balance table grid with a tighter final action column.
  - Wrap action buttons in a dedicated cell container that stretches within the row instead of spilling into the gutter.
  - Give the formula summary a weighted grid and safe text wrapping for long MSSQL names.

## 2026-07-09 - Opening Balance row action overflow follow-up

- Screen: `V2 / Opening Balance`
- Source evidence:
  - `openingBalanceActionGroup` was using `grid-template-columns: repeat(3, minmax(0, 1fr))`.
  - The action column width was only `minmax(184px, 0.98fr)`.
  - Button labels were locked to `white-space: nowrap`.
- Root cause:
  - This is not a z-index or pointer-events failure.
  - The visual overlap is intrinsic layout overflow: three text buttons are compressed into a column too narrow for their labels, so the text paints beyond the button boundary and appears to collide with the adjacent panel.
- Step 1 diagnosis summary:
  - Overlapping element: no separate overlay layer is blocking the controls; the row action content itself is overflowing its own grid track.
  - Box-model vs visual boundary: button hit-box remains inside the narrow cell, but the label text visually extends past it, creating the broken alignment seen in the screenshot.
  - Event listeners: the buttons still carry normal React `onClick` handlers for edit, next-year update, and delete.
  - Pointer events: no evidence of `pointer-events: none`; this is a layout compression issue, not an interaction-disabled state.
  - Viewport behavior:
    - Desktop: overflow appears in the action column first.
    - Tablet: the issue worsens because the right-side form panel takes a larger relative share.
    - Mobile: existing breakpoint logic already collapses the table to one column, so the dense action row pattern should not be used there.
- Open-source comparison:
  - Material guidance favors higher density layouts for tables and long-form data review, not oversized repeated action labels for every row.
  - Frappe list views support packing multiple row actions into dropdown-oriented or compact action patterns rather than forcing full-width labeled buttons into a narrow table cell.
- Historical layout note:
  - The fixed desktop sidebar removes a meaningful portion of usable workspace width before the Opening Balance module begins its own two-column split.
  - A viewport-only breakpoint is therefore too late for this module; it needs an earlier module-specific collapse point while the left rail is still visible.
- Planned correction:
  - Replace the three-across row action grid with a compact wrapping action layout on desktop.
  - Keep action labels readable without forcing nowrap overflow.
  - Preserve the mobile single-column fallback already present in the stylesheet.
  - Add an earlier desktop breakpoint for `Opening Balance` so the register and form stack before the sidebar squeezes the action column.
