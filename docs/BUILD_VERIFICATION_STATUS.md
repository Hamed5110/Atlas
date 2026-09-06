# Airfare Management — Build Verification Status

**SSOT:** [`ATLAS_HCM_Final_Consolidated_State.md`](./ATLAS_HCM_Final_Consolidated_State.md) **v4.1 Corrected**

## Port

**HCM product path: `:3389` only.** See [`PORT_3389_ONLY.md`](./PORT_3389_ONLY.md). Do not default E2E/QA to `:3355`.

## Two-tier rule

| Tier | Meaning |
|------|---------|
| **Production Live** | Works at FOCUSSERVER (Support Guide 2026-06-28). Manual/SQL verified. |
| **Repo E2E** | Spec exists under `tests/e2e/` and runs in `npm run test:e2e:suite`. |

A module can be Production Live with **zero** Playwright coverage.

## Repo E2E (only these 5)

| Spec | In suite? |
|------|-----------|
| `atlas-hcm-screens.spec.ts` | ✅ chromium |
| `atlas-ai-data-agent.spec.ts` | ✅ chromium |
| `atlas-import-export-print.spec.ts` | ✅ chromium |
| `atlas-visual-baselines.spec.ts` | ✅ visual |
| `airfare-entitlement-reconciliation.spec.ts` | ✅ chromium |

**Gap:** 11 target specs missing (~69%). Do not claim Gold/Platinum for missing files.

## Next (SSOT §6.1)

1. `data-testid` on production screens  
2. `@critical` policy (documented in `tests/QA_STACK.md`)  
3. Then `frontend-smoke` + `year-end-close` (@critical)
