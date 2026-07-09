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
