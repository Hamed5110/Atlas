# ATLAS Update Option UI Artifact - 2026-07-08

## Decision

The application update command belongs in:

`System Admin profile menu -> System Maintenance -> Updates`

It must not appear as a main business navigation item because update activity is an administrator system utility, not an HCM transaction workflow.

## Open-Source Placement Comparison

| Reference pattern | Observed placement | ATLAS placement |
|---|---|---|
| Nextcloud admin updater | Administration settings and update status area | System Maintenance workspace |
| Open WebUI admin settings | Admin-only instance controls | System Admin profile menu |
| VS Code update check | User/help menu command | Check for Updates inside profile menu |
| Material 3 utility actions | Settings/overflow, not primary task navigation | Hidden from left business sidebar |

## Implemented UI Structure

| Surface | Purpose | Alignment rule |
|---|---|---|
| System Admin profile chip | Opens admin utility menu | Topbar, before Logout |
| Check for Updates menu item | Direct update readiness command | Admin-only, disabled for non-admin roles |
| System Maintenance screen | Full update status and process evidence | Between Security and Support workflows |
| Update status card | Shows current check state | Right side on HD, stacked on tablet/mobile |
| Safe Update Workflow | Explains check, backup, verify sequence | Secondary panel to the right on HD |
| Layout placement map | Documents FOSS comparison | Full-width evidence table |

## Functional Rules

| Rule | Result |
|---|---|
| Admin only | Update controls are disabled unless the active user is admin |
| Port preservation | Status check uses the existing ATLAS service on port 3355 |
| Backend preservation | No database, controller, route, or serialization changes |
| Business workflow protection | Opening Balance, Year End, Airfare, Loans, and Employees are not cluttered by app update controls |
| Evidence capture | System Maintenance is included in print/export status output |

## Verification Targets

| Check | Expected result |
|---|---|
| Profile menu | Contains System Maintenance and Check for Updates |
| System Maintenance screen | Contains Update Application, Check for Updates, Safe Update Workflow, and Layout placement map |
| Responsive layout | Maintenance grid stacks at tablet and phone breakpoints |
| RTL layout | Admin dropdown mirrors to the left edge in RTL mode |
| Backend safety | `server.js` and database files remain unchanged |
