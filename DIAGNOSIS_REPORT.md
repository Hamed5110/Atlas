# UI Clickability Diagnosis Report

## Target control
- Screen: `/v2/`
- Control: `Employees` sidebar navigation button
- Element tag: `BUTTON`
- Element classes: `v2-shell-module__u7p4pG__navItem v2-shell-module__u7p4pG__navItemActive`

## Symptom
- The `Employees` button is visibly rendered and shows a pointer cursor.
- The button can be located uniquely at all tested breakpoints.
- Clicking it does **not** change route or module state.

## Z-index and overlap diagnosis

### Button computed stacking
- Button z-index: `auto`
- Position: `static`

### Parent stacking chain up to body
| Level | Element | Class | Position | z-index | pointer-events |
|---|---|---|---|---|---|
| 1 | `BUTTON` | `v2-shell-module__u7p4pG__navItem v2-shell-module__u7p4pG__navItemActive` | `static` | `auto` | `auto` |
| 2 | `NAV` | `v2-shell-module__u7p4pG__desktopNav` | `static` | `auto` | `auto` |
| 3 | `ASIDE` | `v2-shell-module__u7p4pG__sidebar` | `sticky` | `1` | `auto` |
| 4 | `SECTION` | `v2-shell-module__u7p4pG__shell` | `relative` | `auto` | `auto` |
| 5 | `MAIN` | `v2-shell-module__u7p4pG__viewport` | `static` | `auto` | `auto` |
| 6 | `BODY` | `(none)` | `static` | `auto` | `auto` |
| 7 | `HTML` | `dark` | `static` | `auto` | `auto` |

### Overlap result
- Higher z-index overlapping element found: **No**
- `elementFromPoint()` at the center of the button resolves to:
  - `SPAN`
  - class: `v2-shell-module__u7p4pG__navLabel`
  - text: `Employees`
- Conclusion: the hit point lands inside the button content, not under a foreign overlay.

## Pointer-events diagnosis
- Button pointer-events: `auto`
- All parents up to `body`: `auto`
- Conclusion: the button is **not** blocked by CSS pointer-event suppression.

## Event-listener diagnosis
- `getEventListeners(button)` output: `getEventListeners unavailable in page runtime`
- Additional direct wiring check:
  - `onclick`: `undefined`
  - React private props detected on element: none exposed in runtime inspection
- Practical behavior check:
  - Click executes without throwing an error
  - Route remains unchanged after click
- Conclusion: this behaves like a control with no effective navigation/state-change wiring at runtime.

## Box model vs visual boundary
- X: `28.6220`
- Y: `172.7362`
- Width: `214.7441`
- Height: `67.3720`
- Margin: `0 / 0 / 0 / 0`
- Padding: `9 / 11 / 9 / 11`
- Border: `0.629921 / 0.629921 / 0.629921 / 0.629921`
- Border radius: visually consistent with rendered card button

### Hit-box mismatch check
- Visual boundary mismatch found: **No**
- The measured clickable rectangle is non-zero and aligns with the visible rendered button.
- Conclusion: this is **not** a hit-box sizing bug.

## Viewport test matrix
| Viewport | Button visible | Button enabled | Click result | Pass/Fail |
|---|---:|---:|---|---|
| `375x844` | Yes | Yes | No route/state change | Fail |
| `768x1024` | Yes | Yes | No route/state change | Fail |
| `1440x900` | Yes | Yes | No route/state change | Fail |

## Root-cause summary
The `Employees` button is rendered correctly and is not blocked by overlay, z-index, pointer-events, or hit-box mismatch. The failure is functional rather than visual: the control accepts the click physically, but no navigation or module-state transition happens afterward. Based on runtime inspection, this is most consistent with missing or inactive click wiring in the V2 shell navigation logic.

## Recommended next step after approval
Trace the V2 shell navigation binding for sidebar items and verify whether the `Employees` button dispatches route/state updates, then retest all nav items with the same protocol.
