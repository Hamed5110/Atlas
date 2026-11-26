# ATLAS QA Stack — Decision from Landscape Guide

Source: `Software_Testing_Tools_Landscape_Guide.md` (Sep 2026)  
Decision date: 2026-09-03

## Verdict (what to use)

**Do not buy** Mabl, testRigor, Applitools Cloud, or Katalon for ATLAS HCM right now.

The guide’s own matrix for **“Startup / Small Team, Web-Only”** and **technical teams** maps to what we already run:

| Guide recommendation | ATLAS adoption | Status |
|---------------------|----------------|--------|
| Playwright (E2E/UI) | `tests/e2e/atlas-*.spec.ts` | Live |
| Playwright visual baselines (Applitools-style) | `--project=visual` | Live |
| k6 (performance) | `tests/load/ai-agent-endpoints.k6.js` | Script ready (CI installs k6) |
| AI agentic testing | Data Agent + SAA + `tests/agentic_qa_runner.py` | Live |
| CI/CD | `.github/workflows/qa-hcm.yml` | Live |
| API testing | pytest + agent chat/schema gate | Live |

Commercial AI tools (Mabl / testRigor / Katalon) overlap our **schema-gated Data Agent** and would add license cost without replacing MSSQL/domain QA logic.

## How ATLAS maps to guide categories

| Guide category | Best ATLAS use |
|----------------|----------------|
| **E2E/UI (Playwright)** | Critical journeys: login → screens → import/export chrome → AI Insights prompts |
| **Visual AI (Applitools)** | Playwright screenshot goldens on dashboard / employees / reports / AI / allocation |
| **Agentic (Mabl/testRigor)** | Plain-English prompts via Data Agent; refuse “fix everything”; SAA baseline |
| **Load (k6)** | Agent endpoints under concurrent VUs (diagnose / draft / SAA) |
| **Security (OWASP ZAP)** | Phase-2 — not blocking; prefer authenticated API gate + SQL gate first |
| **Mobile (Appium)** | N/A — web SPA only |

## Test pyramid (guide §6.1) applied

```
E2E/UI + visual     → npm run test:e2e:hcm && npm run test:e2e:visual
Agentic + API       → npm run test:agentic   (or test:agentic:hcm)
Unit/source         → cd atlas-next && node --test tests/*.mjs
Load                → npm run test:load:agent   (requires k6)
```

Canonical gate: **`npm run test:qa`** (static → agentic → e2e suite Option A → Stage 5)  
Full gate: **`npm run test:qa:full`** (adds k6, re-runs Stage 5)  
Post-run only: **`npm run test:qa:agent`** → `test-reports/qa-agent/report.md`

Spec vs live: [`QA_AGENT_SPEC_GAP.md`](./QA_AGENT_SPEC_GAP.md)  
Orchestration fixes: [`../docs/QA_Agent_Orchestration_Fixes.md`](../docs/QA_Agent_Orchestration_Fixes.md)  
**SSOT:** [`../docs/ATLAS_HCM_Final_Consolidated_State.md`](../docs/ATLAS_HCM_Final_Consolidated_State.md) (v4.1 Corrected)  
Build verify: [`../docs/BUILD_VERIFICATION_STATUS.md`](../docs/BUILD_VERIFICATION_STATUS.md)

## Live E2E specs only (v4.1)

1. `atlas-hcm-screens.spec.ts`
2. `atlas-ai-data-agent.spec.ts`
3. `atlas-import-export-print.spec.ts`
4. `atlas-visual-baselines.spec.ts`
5. `airfare-entitlement-reconciliation.spec.ts`

Everything else in the gap matrix is **To Be Written** — see SSOT §3 / §6.

## `@critical` tag policy (Sprint 1)

Apply Playwright tag `@critical` when the spec covers any of:

- Year-end close / carry-forward
- Loan EMI run / settlement money path
- Ticket approval above policy threshold
- Employee GDPR deletion

**Enforcement:** Stage 5 Gate 3 blocks merge on `@critical` **failures** (or SAA &lt; 0.55). Gate 0/1 remain disabled.

## Next build order (SSOT §6)

1. Add `data-testid` across production screens  
2. Formalize `@critical` on new year-end / money specs  
3. `frontend-smoke.spec.ts` → `year-end-close.spec.ts` → vouchers → loans  

## AI adoption roadmap (guide §6.2) — ATLAS phase

| Phase | Guide intent | ATLAS action |
|-------|--------------|--------------|
| 1 Augment | AI beside existing tests | Data Agent in AI Insights + agentic runner |
| 2 Integrate | CI + baselines | `qa-hcm.yml` + visual snapshots committed |
| 3 Optimize | Risk-based selection | SAA action queue ranks fixes by risk×confidence |
| 4 Autonomy | Self-exploring agents | Future: SAA silent whitelist only; human gate for schema |

## When to revisit commercial tools

Re-evaluate **Applitools Eyes** only if cross-browser visual false positives exceed ~5% on Playwright pixel diffs.  
Re-evaluate **Mabl/testRigor** only if non-developers must author the majority of E2E tests without TypeScript.

## Secrets for CI live runs

- `ATLAS_E2E_BASE_URL`
- `ATLAS_E2E_TOKEN` **or** `ATLAS_E2E_USERNAME` + `ATLAS_E2E_PASSWORD`
