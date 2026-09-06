# QA Agent Spec Gap Matrix
## ATLAS HCM — Honest Assessment: Specification vs. Live Implementation

Synced from Downloads `QA_AGENT_SPEC_GAP.md` with ATLAS-specific path corrections (FastAPI/Alembic, Playwright `*-snapshots`, Data Agent at `C:\HCM Airfare`).

---

## How to Read This Matrix

| Status | Meaning |
|--------|---------|
| ✅ **Shipped** | Live in repo, functional, tested |
| 🔄 **Wired** | Code exists, integrated, but not fully exercised or stabilized |
| 🚧 **Partial** | Some sub-components built, gaps remain |
| ❌ **Not Built** | Spec exists, no implementation |
| 📋 **Deferred** | Intentionally postponed to later phase |

---

## Module-by-Module (summary)

| Spec module | Status | Live evidence |
|-------------|--------|---------------|
| Intent Parser (8 QA intents) | 🚧 Partial | Data Agent chat intents live; CREATE_TEST / Slack / Jira not built |
| Domain Model (HCM graph) | 🚧 Partial | Airfare schema dictionary + MSSQL; no full Leave/Payroll graph |
| Repair Engine (tests) | 🚧 Partial | Detect + classify in Stage 5; **no** Playwright auto-fix |
| Search Module | ❌ Not Built | SAA cites docs only |
| Data Forge | ❌ Not Built | Import templates only |
| SAA Ranker (tests) | 🔄 Wired | Stage 5 + `saa-scores.json` + historical JSONL |
| Baseline Manager | ✅ Visual shipped | Playwright goldens under `tests/e2e/**/*-snapshots/` |
| Gate Keeper | 🔄 Wired | Gate 0/1 off; Gate 2/3 in Stage 5; Data Agent APPLY gate separate |
| Playwright reporter | 🔄 Wired | Per-project `playwright-{project}.json` + aggregate |
| Stage 5 distribution | 🔄 Wired | Artifact + PR comment (CI); Slack digest deferred |

Full narrative assessment remains in Downloads; this file is the **repo source of truth**.

---

## Orchestration (post Option A)

| Piece | Path |
|-------|------|
| Per-project reporter | `tests/reporters/agent-reporter.ts` |
| Aggregator | `tests/qa-agent/aggregate_playwright_results.py` |
| Stage 5 | `tests/qa-agent/orchestrate_post_run.py` |
| Root resolver | `tests/qa-agent/_paths.py` |
| Combined input | `test-reports/qa-agent/playwright-combined.json` |
| Report | `test-reports/qa-agent/report.md` |

```
npm run test:e2e:suite   # chromium → visual → aggregate
npm run test:qa:agent    # Stage 5
npm run test:qa          # static + agentic + suite + Stage 5
```

**Gate policy:** No Playwright auto-repair commits until Repair Pattern Library matures (Orchestration Fixes §7).

---

**SSOT:** [`docs/ATLAS_HCM_Final_Consolidated_State.md`](../docs/ATLAS_HCM_Final_Consolidated_State.md) **v4.1 Corrected** — ops live ≠ repo E2E (5 specs only).

## Immediate next (SSOT §6 / Downloads gap §10)

1. ~~Fix orchestrator path~~ / ~~Combine Playwright runs (Option A)~~
2. **Sprint 1:** `data-testid` on production screens + `@critical` policy (`QA_STACK.md`)
3. PR comment bot — wired in `qa-hcm.yml`
4. Sprint 2+: `frontend-smoke` → `year-end-close` → vouchers → loans (see SSOT §6)
5. Slack nightly — needs `SLACK_QA_WEBHOOK`

---

*Version: 1.1 (repo) — Sep 2026*
