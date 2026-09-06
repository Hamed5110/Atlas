# Entitlement Rate vs Rule — Adopted Decision

> Source: `Entitlement_Rate_vs_Rule_Decision_Prompt.md` (Sep 2026)  
> Runtime: HCM on **:3389** · UI `atlas-next` → `web_dist_next`

## Decision

**ATLAS HCM uses Entitlement RATE as the sole Phase 1–2 mechanism for base airfare entitlement.**

Hierarchy (most specific wins):

`employee` → `pay_group` → `company` → `global`

**Entitlement RULE matrix** (grade × location × family × LOS) is **out of primary product scope** for Phase 1–2:

- Route `/entitlement/rules` may remain for admin/advanced / ledger experiments
- **Removed from main navigation**
- Do not expand rule-matrix E2E as a primary acceptance gate
- Prefer `/rates` (Entitlement Rates) for operators and AI explainability

## Why

- Airfare amount is policy-scoped (company / pay group / employee), not a multi-dimensional benefits matrix
- Focus Soft migration maps cleanly to rates
- Rate hierarchy is auditable in one sentence (“Global = 150”)
- AI Insights / forecasts stay simple

## UI

| Surface | Status |
|---------|--------|
| `/rates` Entitlement Rates | **Primary** — schedule + New rate |
| `/entitlement/rules` | Advanced only — not in main nav |
| `/entitlement/accounts`, year-end, reconcile | Ledger ops (coexist; not amount policy) |

## Tests

- Prefer `airfare-entitlement-rate.spec.ts` (rate schedule UI + hierarchy copy)
- Do **not** treat grade × location × family × LOS matrix coverage as Phase 1–2 required
