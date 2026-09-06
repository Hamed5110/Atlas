# ATLAS HCM — Final Consolidated System State (v4.1 Corrected)
## Single Source of Truth: Production Ops vs. Repo E2E — Honest Separation

> **Repo adoption note (2026-09-03):** Canonical path `docs/ATLAS_HCM_Final_Consolidated_State.md`.  
> Filename on disk for entitlement: `airfare-entitlement-reconciliation.spec.ts` (not `entitlement-reconciliation.spec.ts`).  
> Stage 5 logic lives in `orchestrate_post_run.py` (no separate `saa_calculator.py` / `report_generator.py`).  
> `qa-nightly.yml` is **not** present — only `qa-hcm.yml`. Visual baselines live under `tests/e2e/**/*-snapshots/`.  
> AI Insights UI: Smart Actions (see `docs/AI_INSIGHTS_SMART_ACTIONS.md`).

---

## 1. Critical Correction Notice (v4 → v4.1)

**What v4 got wrong:**
- Marked E2E specs as "Gold" / "Platinum" that **do not exist in this repo**
- `year-end-close.spec.ts`, `loans-emi-preview.spec.ts`, `companies.spec.ts`, `reports-catalog.spec.ts`, `frontend-smoke.spec.ts`, `opening-balances-import.spec.ts` — **none of these files are in the repo**
- This created a false impression that ATLAS has comprehensive automated test coverage

**What v4.1 corrects:**
- **Strict separation** between "Production Live" (verified by Support Guide 2026-06-28) and "Repo E2E Coverage" (what Playwright actually runs in CI)
- Only **5 Playwright spec files** are acknowledged as live in the repo
- Everything else is honestly marked as **"To Be Written"**
- The QA Agent's job is to close this gap — not pretend it doesn't exist

---

## 2. Two-Tier Status System

### Tier 1: PRODUCTION LIVE (Verified by Operations)
These modules work in production at `http://FOCUSSERVER/`. Verified 2026-06-28.

| Module | Status | Evidence | Tested By |
|--------|--------|----------|-----------|
| Company Administration | ✅ Live | Create, update, backup, restore verified | Manual QA, SQL checks |
| Employee Master | ✅ Live | Identity, employment, status, eligibility | Manual QA, frontend checks |
| Opening Balances | ✅ Live | Excel import, preview, carry-forward | Manual QA, import validation |
| Airfare Allocation | ✅ Live | Ticket request, excess, approval, document attach | Manual QA, UI checks |
| Loans (full lifecycle) | ✅ Live | EMI preview/run, restructure, deferment, settlement, history | Manual QA, SQL verification |
| Year End | ✅ Live | Preview, dry-run, temporary close, carry-forward | Manual QA, dry-run checks |
| Reports (7 types) | ✅ Live | Dashboard, Employee Master, Airfare Payable, Allocation Register, Loan Register, Company Register, Year-End Preview | Manual QA, export checks |
| Frontend / SPA | ✅ Live | Production build, login, main screens, console errors | Manual QA, smoke tests |
| Offer Letter PDF | ✅ Live | Generated from employee data | Manual verification |
| Employment Contract PDF | ✅ Live | Generated from employee data | Manual verification |
| Document Registry | ✅ Live | Per-employee document list | Manual verification |

> **Rule:** A module can be Production Live WITHOUT having repo E2E coverage. Manual QA and SQL verification are valid but not automated.

### Tier 2: REPO E2E COVERAGE (What Playwright Actually Runs in CI)
These are the **only** `.spec.ts` files present in `tests/e2e/`.

| Spec File | Status | What It Tests | SAA Tier | Last Run |
|-----------|--------|---------------|----------|----------|
| `atlas-hcm-screens.spec.ts` | ✅ Live | Critical screen renders: login, dashboard, employee grid, allocation form | 🔄 TBD | — |
| `atlas-ai-data-agent.spec.ts` | ✅ Live | AI Insights panel, agent chat interface, prompt submission | 🔄 TBD | — |
| `atlas-import-export-print.spec.ts` | ✅ Live | Excel import flow, export to PDF/Excel, print dialog | 🔄 TBD | — |
| `atlas-visual-baselines.spec.ts` | ✅ Live | Screenshot comparison for 5 key screens | ✅ 5/5 passing | — |
| `airfare-entitlement-reconciliation.spec.ts` | ✅ Live | Entitlement calculation accuracy, edge cases (chromium project) | 🔄 TBD | — |

> **Rule:** If a spec is not in this list, it does not exist in the repo. No exceptions.  
> Downloads draft used the short name `entitlement-reconciliation.spec.ts` — **actual filename** is above.

---

## 3. The Gap: What E2E Specs Need To Be Written

### 3.1 Gap Matrix: Production Module → E2E Spec

| Production Module | E2E Spec Needed | In Repo? | Priority |
|-------------------|-----------------|----------|----------|
| Employee Master create/modal | `employee-master-create.spec.ts` | ❌ No | P1 |
| Employee Master Focus8080 sync | `employee-master-focus8080-sync.spec.ts` | ❌ No | P2 |
| Offer Letter voucher | `voucher-offer-letter.spec.ts` | ❌ No | P1 |
| Employment Contract voucher | `voucher-employment-contract.spec.ts` | ❌ No | P1 |
| Document Registry | `document-registry.spec.ts` | ❌ No | P2 |
| Airfare ticket request | `airfare-ticket-request.spec.ts` | ❌ No | P1 |
| Airfare excess + loan | `airfare-ticket-excess-loan.spec.ts` | ❌ No | P2 |
| Approval workflow | `airfare-approval-workflow.spec.ts` | ❌ No | P3 |
| Loan request → EMI | `loan-request-to-close.spec.ts` | ❌ No | P1 |
| Loan statement accuracy | `loan-statement-accuracy.spec.ts` | ❌ No | P2 |
| Opening Balances import | `opening-balances-import.spec.ts` | ❌ No | P2 |
| Year End close | `year-end-close.spec.ts` | ❌ No | P1 |
| Reports catalog | `reports-catalog.spec.ts` | ❌ No | P2 |
| Crystal designer | `reports-crystal-designer.spec.ts` | ❌ No | P3 |
| Companies admin | `companies.spec.ts` | ❌ No | P2 |
| Frontend smoke | `frontend-smoke.spec.ts` | ❌ No | P1 |

### 3.2 Current E2E Suite Health

```
Total specs in repo:     5
Total specs needed:      16
Coverage gap:            11 specs missing (69% gap)
Visual baselines:        5/5 passing ✅
SAA average (5 specs):   Cannot calculate — historical data insufficient
Gate 3 (@critical) tags: 0 applied
```

---

## 4. QA Agent Stack — Honest Assessment (Unchanged from v4)

The QA Agent reporting layer is live and functional. This section is correct.

| Component | Status | What It Actually Does |
|-----------|--------|----------------------|
| Playwright E2E (chromium) | ✅ Live | Runs the 5 spec files above |
| Playwright E2E (visual) | ✅ Live | Screenshot goldens — 5/5 passing |
| Reporter Aggregator (Option A) | ✅ Live | `playwright-chromium.json` + `playwright-visual.json` → `playwright-combined.json` |
| Stage 5 Orchestrator | ✅ Live | `report.md` + `saa-scores.json` + `saa-scores-historical.jsonl` |
| SAA Ranker (6-dim) | ✅ Live | 3 wired (Stability, Accuracy, Speed) + 3 neutral placeholder (Autonomy, Coverage, Data Health = 0.5) |
| CI PR Comment | ✅ Live | Updates `<!-- ATLAS-QA-AGENT-REPORT -->` |
| CI Artifact Upload | ✅ Live | `qa-agent-report` artifact |
| k6 Load Test | ✅ Live | `tests/load/ai-agent-endpoints.k6.js` |

**What the QA Agent does NOT do:**
- Auto-repair, chat bot, synthetic data, self-healing, proactive alerts — all correctly marked as Not Built in v4

### 4.1 SAA Formula (Corrected Placeholders)

```
SAA = (Stability × 0.25) + (Accuracy × 0.20) + (Autonomy × 0.20 × 0.5) +
      (Coverage × 0.15 × 0.5) + (Speed × 0.10) + (Data Health × 0.10 × 0.5)

Tier Thresholds:
  Platinum: 0.85 — 1.00
  Gold:     0.70 — 0.84
  Silver:   0.55 — 0.69
  Bronze:   0.40 — 0.54
  At Risk:  0.00 — 0.39
```

### 4.2 Gate Policy

| Gate | Status | Enforcement |
|------|--------|-------------|
| Gate 0 — Autonomous | ❌ DISABLED | No auto-repair commits |
| Gate 1 — Notify | ❌ DISABLED | No Slack notifications (needs `SLACK_QA_WEBHOOK`) |
| Gate 2 — Review | ✅ ACTIVE | Human PR review for SAA 0.55–0.69 |
| Gate 3 — Block | ✅ ACTIVE | Blocks merge for SAA < 0.55 or `@critical` tagged tests |

---

## 5. File Map (Repo Truth — Corrected)

```
repo-root/
├── tests/
│   ├── e2e/
│   │   ├── atlas-hcm-screens.spec.ts              ✅ ONLY live spec
│   │   ├── atlas-ai-data-agent.spec.ts            ✅ ONLY live spec
│   │   ├── atlas-import-export-print.spec.ts      ✅ ONLY live spec
│   │   ├── atlas-visual-baselines.spec.ts         ✅ ONLY live spec
│   │   ├── airfare-entitlement-reconciliation.spec.ts ✅ live (chromium)
│   │   ├── employee-master-create.spec.ts         ❌ NOT in repo
│   │   ├── voucher-offer-letter.spec.ts           ❌ NOT in repo
│   │   ├── voucher-employment-contract.spec.ts    ❌ NOT in repo
│   │   ├── document-registry.spec.ts              ❌ NOT in repo
│   │   ├── airfare-ticket-request.spec.ts         ❌ NOT in repo
│   │   ├── airfare-ticket-excess-loan.spec.ts     ❌ NOT in repo
│   │   ├── loan-request-to-close.spec.ts          ❌ NOT in repo
│   │   ├── year-end-close.spec.ts                 ❌ NOT in repo
│   │   ├── reports-catalog.spec.ts                ❌ NOT in repo
│   │   └── ...                                    ❌ NOT in repo
│   ├── e2e/**/*-snapshots/                        ✅ visual goldens (not tests/baselines/)
│   ├── load/
│   │   └── ai-agent-endpoints.k6.js               ✅ CI runs
│   ├── qa-agent/
│   │   ├── orchestrate_post_run.py                ✅ Stage 5 (+ SAA calc + report)
│   │   ├── aggregate_playwright_results.py        ✅ Option A
│   │   ├── _paths.py                              ✅ Root resolver
│   │   └── (no saa_calculator.py / report_generator.py — inlined)
│   └── reporters/
│       └── agent-reporter.ts                      ✅ Per-project JSON
├── test-reports/
│   └── qa-agent/                                  ✅ All outputs live
├── docs/
│   ├── ATLAS_HCM_Final_Consolidated_State.md      ✅ THIS FILE (v4.1)
│   ├── BUILD_VERIFICATION_STATUS.md               ✅ Points here
│   ├── AI_INSIGHTS_SMART_ACTIONS.md               ✅ AI Insights scope
│   └── ATLAS_HCM_AI_Data_Agent_Specification.md   📋 Roadmap
├── tests/QA_AGENT_SPEC_GAP.md                     ✅ Honest gap matrix
├── tests/QA_STACK.md                              ✅ Stack + @critical policy
├── playwright.config.ts                           ✅ Multi-project
├── package.json                                   ✅ Scripts defined
└── .github/
    └── workflows/
        └── qa-hcm.yml                             ✅ CI live (no qa-nightly.yml yet)
```

---

## 6. What To Build Next — Prioritized & Sequenced

### The Question: "Which to start?"

**Answer: Start with Item 1 (data-testid), then Item 4 (frontend-smoke), then Item 5 (year-end-close).**

**Rationale:**
- Without `data-testid`, every E2E spec is fragile (selector drift = maintenance hell)
- `frontend-smoke` validates the entire app loads — the foundation all other specs stand on
- `year-end-close` is irreversible in production; it MUST have `@critical` + Gate 3 protection

### 6.1 Sprint 1: Foundation (Week 1)

| # | Task | Why First? | Acceptance Criteria |
|---|------|------------|---------------------|
| **1** | **Add `data-testid` to all production screens** | Every subsequent E2E spec depends on this. No data-testid = flaky tests = low SAA Stability. | Every interactive element in Employee Master, Airfare Allocation, Loans, Year End, Reports has `data-testid="{module}-{element}"` |
| **2** | **Formalize `@critical` tag policy** | Defines which tests block merge. Year-end and money paths are irreversible. | `@critical` applied to: year-end-close, loan-EMI-run, ticket-approval > $5,000, employee-delete-GDPR |

**Deliverable:** PR with `data-testid` attributes + `@critical` tag documentation in `tests/QA_STACK.md`

### 6.2 Sprint 2: Core Smoke + Year End (Week 2)

| # | Task | Why? | Acceptance Criteria |
|---|------|------|---------------------|
| **3** | **Write `frontend-smoke.spec.ts`** | Validates the entire app loads and key screens render. Foundation for all other specs. | Login → Dashboard → Employee Grid → Airfare Form → Loans → Reports. No 500 errors. Console clean. |
| **4** | **Write `year-end-close.spec.ts` with `@critical`** | Year-end is irreversible in production. One bad automated close = data corruption. Must be tested. | Preview → check pending loans → check balances → dry-run close → verify carry-forward → rollback. Gate 3 enforced. |

**Deliverable:** 2 new spec files passing in CI. SAA calculated for both. Year-end marked `@critical`.

### 6.3 Sprint 3: Voucher + Employee (Week 3)

| # | Task | Why? | Acceptance Criteria |
|---|------|------|---------------------|
| **5** | **Write `voucher-offer-letter.spec.ts`** | Cursor AI built this feature; it has zero automated coverage. Regression risk. | Generate → preview → issue → verify Document Registry → view PDF. Visual baseline for preview. |
| **6** | **Write `voucher-employment-contract.spec.ts`** | Same as above. Legal document = high stakes. | Generate → preview → issue → verify registry. Check signature blocks visible. |
| **7** | **Write `employee-master-create.spec.ts`** | Core CRUD. Most frequently used screen. | Fill all required fields → submit → verify grid → open detail → verify data. Visual baseline for modal. |

**Deliverable:** 3 new spec files. Visual baselines refreshed. SAA ≥ Silver (0.55) for all.

### 6.4 Sprint 4: Airfare + Loans (Week 4)

| # | Task | Why? | Acceptance Criteria |
|---|------|------|---------------------|
| **8** | **Write `airfare-ticket-request.spec.ts`** | Core business workflow. Revenue-impacting. | Select employee → calculate entitlement → enter amount → submit → verify status card increments. |
| **9** | **Write `loan-request-to-close.spec.ts`** | Loans are production-live with full lifecycle but no E2E. | Request → approve → pay 3 EMIs → verify balance → close → verify status. |

**Deliverable:** 2 new spec files. Loan spec covers the full lifecycle (request → close).

### 6.5 Sprint 5: Remaining + Polish (Week 5)

| # | Task | Why? | Acceptance Criteria |
|---|------|------|---------------------|
| **10** | **Write `document-registry.spec.ts`** | Supporting feature. Lower priority than core workflows. | Grid renders → view PDF → reprint button disabled for unauthorized user. |
| **11** | **Write `opening-balances-import.spec.ts`** | Year-end dependency. Lower priority. | Upload Excel → preview rows → confirm → verify grid. |
| **12** | **Write `reports-catalog.spec.ts`** | Reporting is important but less risky than transactional workflows. | Click each report card → verify data loads → export PDF → file generated. |
| **13** | **Write `companies.spec.ts`** | Admin feature. Lowest priority. | List → create → backup → restore. |
| **14** | **Refresh all visual baselines** | After 5 sprints of DOM changes, baselines will be stale. | `npm run test:qa:baseline:refresh` → all 5+ baselines pass. |
| **15** | **Full suite run + SAA evaluation** | Measure where we stand after closing the gap. | `npm run test:qa` → all specs pass → SAA average ≥ 0.70 (Gold) |

### 6.6 Summary: 5-Week Sprint Plan

| Sprint | Focus | New Specs | Cumulative Specs | Target SAA |
|--------|-------|-----------|------------------|------------|
| 1 | Foundation | 0 (infra only) | 5 | — |
| 2 | Smoke + Year End | 2 | 7 | Silver (0.55) |
| 3 | Voucher + Employee | 3 | 10 | Silver (0.60) |
| 4 | Airfare + Loans | 2 | 12 | Gold (0.70) |
| 5 | Remaining + Polish | 4 | 16 | Gold (0.75) |

---

## 7. Definition of Done for E2E Specs

A spec is **Done** when ALL of the following are true:

- [ ] Spec file exists in `tests/e2e/`
- [ ] Spec passes in `npm run test:e2e:suite` (chromium + visual)
- [ ] Visual baseline exists and passes (`*-snapshots/`)
- [ ] `data-testid` attributes are present on all targeted elements
- [ ] SAA score ≥ 0.55 (Silver) after 3 consecutive CI runs
- [ ] No flaky behavior (passes 5/5 consecutive runs)
- [ ] PR reviewed and merged to `main`
- [ ] `@critical` tag applied if the spec covers: year-end, money calculation, GDPR deletion, or irreversible action

---

## 8. One-Command Verification (Updated)

```bash
# Verify what actually exists in the repo
echo "=== ACTUAL E2E SPECS ==="
ls tests/e2e/*.spec.ts
echo ""
echo "=== EXPECTED: 5 files ==="
echo "  atlas-hcm-screens.spec.ts"
echo "  atlas-ai-data-agent.spec.ts"
echo "  atlas-import-export-print.spec.ts"
echo "  atlas-visual-baselines.spec.ts"
echo "  airfare-entitlement-reconciliation.spec.ts"
echo ""

# Run the actual live suite
npm run test:e2e:suite

# Stage 5 report
npm run test:qa:agent

# Check outputs
cat test-reports/qa-agent/report.md
jq '.suite_saa, .tests | length' test-reports/qa-agent/saa-scores.json

# Full verification
npm run test:qa
```

**Expected output after v4.1 adoption:**
- 5 specs run, not 16
- Report shows honest coverage gap
- SAA calculated only for existing specs
- No phantom specs claimed as passing

---

## 9. Glossary (Corrected)

| Term | Live Meaning | What It Is NOT |
|------|------------|----------------|
| **Production Live** | Module works in production at FOCUSSERVER. Verified manually. | Does NOT mean it has automated E2E coverage |
| **Repo E2E** | Playwright spec exists in `tests/e2e/` and runs in CI | Does NOT mean the feature is production-ready (could be UI-only) |
| **SAA Gold** | Score 0.70–0.84 with 3+ consecutive stable runs | Does NOT apply to specs that don't exist |
| **@critical** | Tag on E2E specs that block merge if failing | Does NOT exist yet — needs to be applied |
| **5/5 baselines** | 5 screenshot comparisons pass in visual project | Does NOT mean 5 E2E specs exist (only 5 baselines exist) |
| **QA Agent** | Python orchestrator aggregating 5 spec results | Does NOT test features that have no specs |

---

*Document: ATLAS HCM — Final Consolidated System State (v4.1 Corrected)*
*Date: September 2026*
*Correction: v4 falsely claimed 16 E2E specs existed; v4.1 acknowledges only 5*
*Sources: ATLAS_Airfare_HCM_Support_Guide_2026-06-28.docx, BUILD_VERIFICATION_STATUS.md, QA_STACK.md, QA_AGENT_SPEC_GAP.md*
*Classification: Living Document — Single Source of Truth — Corrected*
