# ATLAS HCM — AI Data Agent Specification (repo copy)

**Source download:** `ATLAS_HCM_AI_Data_Agent_Specification.md`  
**Status in this repo:** roadmap + honest gap matrix — see [`tests/QA_AGENT_SPEC_GAP.md`](../tests/QA_AGENT_SPEC_GAP.md)

## What is live vs aspirational

| Layer | Live | Not yet |
|-------|------|---------|
| Schema-gated **Data Agent** (MSSQL SELECT + gated repairs) | Yes | — |
| **Smart System Agent (SAA)** DB baseline / silent whitelist | Yes | — |
| Playwright + visual baselines + k6 script + `qa-hcm.yml` | Yes | — |
| QA Agent Stage 5 post-run report + test SAA scores | Yes (`npm run test:qa:agent`) | — |
| Self-healing Playwright commits / Data Forge / Slack/PR chat intents | — | Phase 2+ |

## Stage 5 usage

```bash
npm run test:qa          # agentic API + e2e suite + Stage 5 report
npm run test:qa:agent    # summarize last Playwright JSON only
```

Outputs:

- `test-reports/qa-agent/playwright-last.json`
- `test-reports/qa-agent/last-run-summary.md`
- `tests/qa-agent/saa-scores.json` (tracked; trends across runs)

Full cognitive architecture (Intent Parser, Repair Engine for tests, Search, Data Forge) remains in the Downloads spec — implement only with Gate Keeper rules (no silent Playwright auto-commit until Gate 2 PR workflow exists).
