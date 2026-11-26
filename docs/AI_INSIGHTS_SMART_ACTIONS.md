# AI Agent / ML on AI Insights — adopted scope

Source prompt: Downloads `ATLAS_HCM_AI_Agent_ML_Integration_Prompt.md`

## In product (AI Insights)

| Surface | Uses live API | Not in UI |
|---------|---------------|-----------|
| **Smart Actions** | SAA baseline, silent fixes, diagnose, anomaly/forecast prompts, action queue Run/Review | Semantic Kernel, Dify, CrewAI, MCP swarm |
| **Ask Data Agent** | `/v1/ai/agent/chat` + APPLY gate | Autonomous ticket create / year-end orchestrator |
| **Forecast chart** | `/v1/ai/forecasts/budget` | Full MLflow / Evidently stack |
| **Findings** | diagnose + SAA DQ flags | Separate learning-feedback chrome |

## Explicitly out of AI Insights

Research landscape (§2), multi-agent taxonomy diagrams, Phase 2–5 roadmap, learning-resource links, risk register — keep in docs only if needed; **not** on the screen.

Full ML program remains roadmap; ship only wired endpoints as Smart Actions.
