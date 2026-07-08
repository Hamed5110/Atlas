# ATLAS Density / Spacing Adjustment Verification

Date: 2026-07-08
Port: http://127.0.0.1:3355
Branch: codex/atlas-installer-2.2.8

## Design References

| Source | Applied guidance |
| --- | --- |
| Material Design density | Use compact density when higher information visibility improves focused work. |
| Carbon spacing / data table guidance | Use consistent spacing tokens and preserve table readability without excessive blank area. |
| PatternFly enterprise UI direction | Keep enterprise screens consistent, scannable, and operationally dense. |

## Layout Changes

| Area | Before | After |
| --- | --- | --- |
| Base page gap | 14px standard | 10px standard, 8px compact/live narrow context |
| Card padding | 18px standard | 14px standard, 12px compact |
| Topbar height token | 68px | 60px |
| Control height token | 54px | 48px standard, 42px narrow |
| Mobile/narrow topbar | Multi-row grid stack | Horizontal command strip with overflow |
| Modal backdrop | Heavy 12px blur | Reduced 5px blur |
| Metric cards | 106px minimum height | 84px minimum height |
| Table rows | 13px/14px padding | 9px/11px padding |
| Year-end preview rows | 1180px minimum width | 1080px minimum width |

## Verification

| Check | Result |
| --- | --- |
| Local health | PASS: `http://127.0.0.1:3355/api/health` healthy/database connected |
| Frontend tests | PASS: `npm test` in `atlas-hcm-next` |
| Frontend production build | PASS: `npm run build` in `atlas-hcm-next` |
| SQL/API contract checks | PASS: `node tests/company-admin-sql.test.js` and Python opening-loan contract |
| Browser measurement | PASS: narrow topbar measured about `135px`, with horizontal command strip enabled |

## Artifact Notes

No backend rules, formulas, procedures, routing, or database schemas were changed for this spacing fix. This update is frontend layout density only.
