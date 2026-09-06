# QA Agent Orchestration Fixes (adopted)

Repo adoption of Downloads `QA_Agent_Orchestration_Fixes.md` **Option A**.

| Fix | Status |
|-----|--------|
| Per-project `playwright-{project}.json` | Done — `tests/reporters/agent-reporter.ts` |
| Aggregate → `playwright-combined.json` | Done — `tests/qa-agent/aggregate_playwright_results.py` |
| `resolve_repo_root()` / `REPO_ROOT` | Done — `tests/qa-agent/_paths.py` + CI env |
| Stage 5 §4.3 report + 6-dim SAA + JSONL | Done — `orchestrate_post_run.py` |
| PR comment `<!-- ATLAS-QA-AGENT-REPORT -->` | Done — `qa-hcm.yml` |
| Slack nightly digest | Deferred (needs `SLACK_QA_WEBHOOK`) |
| Gate 0 auto-repair commits | Deferred (§7) |

```bash
npm run test:e2e:suite
npm run test:qa:agent
```
