# ATLAS Opening Balance Edit Modal Fix

Date: 2026-07-08
Port: http://127.0.0.1:3355
Branch: codex/atlas-installer-2.2.8

## Problem

The Opening Balance edit popup was rendered inside the main application shell. The shell uses 3D perspective/transform styling, which created an unsafe containing context for the fixed-position modal. As a result, the popup could appear too low on the screen and the lower fields/actions could be cut off.

## Fix

| Area | Change |
| --- | --- |
| Modal rendering | Opening Balance edit popup now uses `createPortal(..., document.body)` so it is no longer trapped inside the transformed shell. |
| Backdrop placement | Backdrop aligns modal at the safe top of the viewport instead of centering it too low. |
| Modal sizing | Modal uses `100dvh` max-height and internal scrolling. |
| Modal actions | Update/Cancel action row is sticky inside the modal so actions remain visible. |
| Backdrop blur | Reduced overlay blur for clearer context while editing. |

## Live Verification

| Check | Result |
| --- | --- |
| Port health | PASS: `http://127.0.0.1:3355/api/health` healthy/database connected |
| Modal exists | PASS |
| Modal parent | PASS: backdrop parent is `document.body` |
| Modal top | PASS: measured `14px` from viewport top |
| Modal bottom | PASS: measured `535px` inside `549px` viewport |
| Action row visible | PASS: action row bottom measured `522px` |
| Update button visible | PASS |
| Frontend tests | PASS: `npm test` |
| Frontend build | PASS: `npm run build` |

## Scope

Frontend modal layout fix only. No backend routes, formulas, SQL procedures, or database schema were changed.
