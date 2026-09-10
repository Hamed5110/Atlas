"""Think-before-action planner for the schema-gated AI Data Agent.

Design references (local / enterprise agents):
- OpenCode: privacy-first local tool use; plan before mutating.
- Microsoft ai-agents-for-beginners: Planning + Tool Use patterns.
- Reason-Plan-ReAct / HTN: separate strategic plan from deterministic execution.
- ReAct: Thought → Action → Observation (we emit Thought+Plan, then Act once).

This planner is deterministic (no cloud LLM required): it classifies risk,
emits an explicit plan, and only then should `run_agent` execute tools.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from airfare_management.ai_agent.product_knowledge import match_capabilities
from airfare_management.ai_agent.schema_dictionary import WHITELIST_REPAIRS

Risk = Literal["none", "read", "write_gated", "refuse"]
Action = Literal[
    "refuse",
    "unsafe",
    "unsafe_bulk_fix",
    "clarify",
    "schema",
    "product",
    "capabilities",
    "teach",
    "diagnose",
    "repair_preview",
    "apply_repair",
    "forecast",
    "anomaly",
    "draft_report",
    "sql",
    "learning",
    "research",
    "recall",
    "ml_insight",
    "general",
]


@dataclass
class PlanStep:
    id: str
    thought: str
    action: Action
    tool: str | None = None
    requires_confirm: bool = False
    risk: Risk = "read"


@dataclass
class AgentPlan:
    """Structured plan returned to UI + audit before execution."""

    thoughts: list[str]
    steps: list[PlanStep]
    primary_action: Action
    risk: Risk
    confidence: float
    mode: str = "think_plan_act"
    citations: list[str] = field(
        default_factory=lambda: [
            "OpenCode privacy-first local agent",
            "Microsoft AI Agents for Beginners — Planning + Tool Use",
            "Reason-Plan-ReAct hierarchical planning",
            "Hugging Face smolagents WebSearch + Ollama local synthesis",
            "OpenClaw / AgentDB local FTS memory",
        ]
    )

    def as_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "thoughts": self.thoughts,
            "steps": [asdict(s) for s in self.steps],
            "primary_action": self.primary_action,
            "risk": self.risk,
            "confidence": self.confidence,
            "citations": self.citations,
        }


def build_plan(
    message: str,
    *,
    auto_repair_mode: bool = False,
    apply_token: str | None = None,
    confirm: str | None = None,
) -> AgentPlan:
    """Reason over the user message and produce a validated plan (no side effects)."""
    lowered = message.casefold().strip()
    thoughts: list[str] = []
    steps: list[PlanStep] = []

    thoughts.append("Parse user intent against schema-gated tool catalog (no free-form DDL/DML).")
    thoughts.append("Prefer read/diagnose over mutation; require human gate for repairs.")

    # Explicit apply path
    if apply_token and confirm:
        thoughts.append("Apply-token present — verify Auto-Repair Mode and confirm=APPLY.")
        if not auto_repair_mode:
            return AgentPlan(
                thoughts=thoughts
                + ["Auto-Repair Mode is OFF — refuse apply until enabled."],
                steps=[
                    PlanStep(
                        id="1",
                        thought="Block apply without Auto-Repair Mode.",
                        action="refuse",
                        risk="refuse",
                    )
                ],
                primary_action="refuse",
                risk="refuse",
                confidence=0.99,
            )
        steps.append(
            PlanStep(
                id="1",
                thought="Apply whitelisted repair with undo token.",
                action="apply_repair",
                tool="apply_repair_token",
                requires_confirm=True,
                risk="write_gated",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="apply_repair",
            risk="write_gated",
            confidence=0.9,
        )

    # Red-team / TRUE MODE: block prompt injection and secret exfil before any tool.
    security_probes = (
        "ignore previous",
        "ignore all previous",
        "disregard previous",
        "jailbreak",
        "system prompt",
        "dump all",
        "dump sql",
        "dump password",
        "dump passwords",
        "print your system",
        "reveal your prompt",
        "api keys",
        "api key",
        "secret key",
        "exfiltrat",
    )
    if any(t in lowered for t in security_probes) or (
        "password" in lowered
        and any(t in lowered for t in ("dump", "print", "show", "reveal", "give me"))
    ):
        thoughts.append("Security probe / prompt injection — TRUE MODE refuse (no tools).")
        return AgentPlan(
            thoughts=thoughts,
            steps=[
                PlanStep(
                    id="1",
                    thought="Refuse credential dump and instruction override.",
                    action="refuse",
                    risk="refuse",
                )
            ],
            primary_action="refuse",
            risk="refuse",
            confidence=0.99,
            mode="true_mode",
        )

    # Hard refuses
    if any(t in lowered for t in ("fix everything", "repair all", "fix all")):
        thoughts.append("Detected bulk-fix language — refuse; require per-check confirm.")
        return AgentPlan(
            thoughts=thoughts,
            steps=[
                PlanStep(
                    id="1",
                    thought="Refuse unsafe bulk remediation.",
                    action="unsafe_bulk_fix",
                    risk="refuse",
                )
            ],
            primary_action="unsafe_bulk_fix",
            risk="refuse",
            confidence=0.99,
        )
    if any(t in lowered for t in ("drop table", "truncate", "delete all", "wipe")):
        thoughts.append("Detected destructive SQL language — refuse.")
        return AgentPlan(
            thoughts=thoughts,
            steps=[
                PlanStep(
                    id="1",
                    thought="Refuse destructive database operations.",
                    action="unsafe",
                    risk="refuse",
                )
            ],
            primary_action="unsafe",
            risk="refuse",
            confidence=0.99,
        )

    # Teach / explain / what-is support (Ollama Think→Logic→Answer)
    # Prefer teach over raw product dumps for natural questions (ollama.com chat style).
    topic_hit = any(
        t in lowered
        for t in (
            "allocation",
            "ollama",
            "year-end",
            "year end",
            "period-end",
            "period end",
            "year close",
            "modern entitlement",
            "joining date",
            "joining-date",
            "report",
            "payable",
            "entitlement",
            "loan",
            "agent",
            "insights",
            "module",
            "system",
            "opening balance",
            "carry",
            "forfeit",
            "rate",
            "rates",
            "airfare",
            "ticket",
            "passport",
            "employee",
            "logo",
            "contract",
            "offer letter",
            "forecast",
            "anomaly",
            "baseline",
        )
    )
    question_style = any(
        t in lowered
        for t in (
            "explain",
            "how does",
            "how do",
            "how to",
            "what is",
            "what's",
            "whats",
            "what are",
            "why",
            "when",
            "where",
            "tell me",
            "describe",
            "meaning",
        )
    )
    product_question = bool(question_style and match_capabilities(message))
    if any(
        t in lowered
        for t in (
            "teach me",
            "teach everything",
            "explain everything",
            "support me",
            "help me step",
            "step by step",
            "how does this system",
            "how do i use",
            "tutorial",
            "walk me through",
            "what was built",
            "how was it built",
            "show me how",
            "learning center",
            "local ai learning",
            "like an expert",
            "next best actions",
        )
    ) or (topic_hit and question_style) or product_question:
        thoughts.append("Teaching/support question — focused facts + Ollama Think→Logic→Answer.")
        steps.append(
            PlanStep(
                id="1",
                thought="Recall domain/product facts for the question; answer with local Ollama.",
                action="teach",
                tool="knowledge_brain+ollama",
                risk="none",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="teach",
            risk="none",
            confidence=0.94,
        )

    # Capability / help self-description
    if any(
        t in lowered
        for t in (
            "what can you do",
            "list modules",
            "which modules",
            "capabilities",
            "help",
            "what do you cover",
            "show modules",
            "local ai",
            "how smart",
        )
    ):
        thoughts.append("User wants agent self-description — list modules + local brain.")
        steps.append(
            PlanStep(
                id="1",
                thought="Return MODULE_CATALOG, brain stats, and agent principles.",
                action="capabilities",
                tool="product_knowledge.list_modules",
                risk="none",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="capabilities",
            risk="none",
            confidence=0.95,
        )

    # Online research (smolagents-style web tool)
    if any(
        t in lowered
        for t in (
            "research online",
            "search the web",
            "search online",
            "look up online",
            "google",
            "duckduckgo",
            "wikipedia",
            "what does the web say",
            "browse",
        )
    ) or lowered.startswith("research "):
        thoughts.append("Online research requested — use DuckDuckGo/Wikipedia; cite sources; no HCM row exfil.")
        steps.append(
            PlanStep(
                id="1",
                thought="Run web_research.research_online and store learning event.",
                action="research",
                tool="web_research",
                risk="read",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="research",
            risk="read",
            confidence=0.88,
        )

    # Local knowledge brain recall
    if any(
        t in lowered
        for t in (
            "recall",
            "from memory",
            "knowledge brain",
            "what do you know about",
            "search knowledge",
            "local knowledge",
        )
    ):
        thoughts.append("Local BM25 knowledge recall over product + schema + learning store.")
        steps.append(
            PlanStep(
                id="1",
                thought="knowledge_brain.recall",
                action="recall",
                tool="knowledge_brain",
                risk="none",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="recall",
            risk="none",
            confidence=0.9,
        )

    # ML suite intents
    if any(
        t in lowered
        for t in (
            "emi risk",
            "default risk",
            "rate recommend",
            "recommend rate",
            "sentiment",
            "machine learning",
            "ml insight",
            "run ml",
        )
    ):
        thoughts.append("Route to local ML suite (sklearn with rule fallbacks).")
        steps.append(
            PlanStep(
                id="1",
                thought="Execute ml_insight tool bundle.",
                action="ml_insight",
                tool="travel_intelligence",
                risk="read",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="ml_insight",
            risk="read",
            confidence=0.82,
        )

    # Repair preview (write-gated)
    if any(
        t in lowered
        for t in (
            "auto-repair",
            "auto repair",
            "enable repair",
            "remediat",
            "unlock",
            "fix orphan",
            "fix overlap",
            "fix locked",
        )
    ) or ("apply" in lowered and any(t in lowered for t in WHITELIST_REPAIRS)):
        thoughts.append("Repair path requested — plan preview first, never silent write.")
        if not auto_repair_mode and "apply" not in lowered:
            steps.append(
                PlanStep(
                    id="1",
                    thought="Auto-Repair OFF — ask to enable before preview.",
                    action="repair_preview",
                    tool="preview_repair",
                    requires_confirm=True,
                    risk="write_gated",
                )
            )
        else:
            steps.append(
                PlanStep(
                    id="1",
                    thought="Preview whitelisted repair and return apply_token.",
                    action="repair_preview",
                    tool="preview_repair",
                    requires_confirm=True,
                    risk="write_gated",
                )
            )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="repair_preview",
            risk="write_gated",
            confidence=0.85,
        )

    # Diagnose
    if any(
        t in lowered
        for t in (
            "diagnos",
            "out of balance",
            "duplicate",
            "orphan",
            "overlap",
            "health",
            "scan",
            "problem",
        )
    ):
        thoughts.append("Diagnostics request — read-only MSSQL checks + SQL previews.")
        steps.extend(
            [
                PlanStep(
                    id="1",
                    thought="Run support diagnostics against live MSSQL.",
                    action="diagnose",
                    tool="run_diagnostics",
                    risk="read",
                ),
                PlanStep(
                    id="2",
                    thought="Attach schema-gated detect SQL previews for findings.",
                    action="diagnose",
                    tool="_DETECT_SQL",
                    risk="read",
                ),
            ]
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="diagnose",
            risk="read",
            confidence=0.9,
        )

    if any(t in lowered for t in ("forecast", "budget", "predict", "next quarter", "spend")):
        thoughts.append("Forecast path — aggregate ticket costs; no writes.")
        steps.append(
            PlanStep(
                id="1",
                thought="Compute budget forecast from ticket history.",
                action="forecast",
                tool="forecast_monthly_spend",
                risk="read",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="forecast",
            risk="read",
            confidence=0.8,
        )

    if any(t in lowered for t in ("anomal", "outlier", "spike")):
        thoughts.append("Anomaly scan — statistical / IsolationForest over tickets.")
        steps.append(
            PlanStep(
                id="1",
                thought="Score ticket anomalies.",
                action="anomaly",
                tool="score_ticket_anomalies",
                risk="read",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="anomaly",
            risk="read",
            confidence=0.8,
        )

    if any(t in lowered for t in ("draft a report", "build report", "report on", "designer")):
        thoughts.append("Report draft — emit Report Designer payload with gated SQL.")
        steps.append(
            PlanStep(
                id="1",
                thought="Infer dataset and build designer handoff.",
                action="draft_report",
                tool="_REPORT_SQL",
                risk="read",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="draft_report",
            risk="read",
            confidence=0.85,
        )

    if any(t in lowered for t in ("schema", "what tables", "dictionary")):
        thoughts.append("Schema dictionary request.")
        steps.append(
            PlanStep(
                id="1",
                thought="Return allowlisted tables/columns + product capabilities.",
                action="schema",
                tool="as_public_dict",
                risk="none",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="schema",
            risk="none",
            confidence=0.95,
        )

    if any(t in lowered for t in ("learn", "confidence", "feedback", "product knowledge")):
        thoughts.append("Learning store / confidence stats.")
        steps.append(
            PlanStep(
                id="1",
                thought="Aggregate ai_learning_events + product knowledge version.",
                action="learning",
                tool="learning_stats",
                risk="read",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="learning",
            risk="read",
            confidence=0.85,
        )

    # Explicit canned-SQL intent before product matching (word "sql" alone is not enough).
    sql_markers = (
        "select ",
        "run sql",
        "show sql",
        "canned sql",
        "schema-gated",
        "preview sql",
        "detect sql",
        "sql preview",
        "query for duplicate",
        "query orphans",
        "query locked",
    )
    if any(t in lowered for t in sql_markers) or (
        "sql" in lowered
        and any(
            t in lowered
            for t in ("duplicate", "orphan", "overlap", "locked", "schedule", "attachment", "detect")
        )
    ):
        thoughts.append("SQL intent — only canned detect queries, never arbitrary user SQL.")
        steps.append(
            PlanStep(
                id="1",
                thought="Run schema-gated canned SELECT if a check code is inferred.",
                action="sql",
                tool="_DETECT_SQL",
                risk="read",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="sql",
            risk="read",
            confidence=0.75,
        )

    caps = match_capabilities(message)
    if caps:
        thoughts.append(
            f"Matched {len(caps)} product capability pack(s): "
            + ", ".join(c["id"] for c in caps[:5])
        )
        steps.append(
            PlanStep(
                id="1",
                thought="Answer from product knowledge (MSSQL + APIs + rules).",
                action="product",
                tool="product_knowledge",
                risk="none",
            )
        )
        return AgentPlan(
            thoughts=thoughts,
            steps=steps,
            primary_action="product",
            risk="none",
            confidence=0.92,
        )

    thoughts.append("No specialized tool match — explain agent scope and how to ask.")
    steps.append(
        PlanStep(
            id="1",
            thought="General guidance + module catalog hint.",
            action="general",
            tool=None,
            risk="none",
        )
    )
    return AgentPlan(
        thoughts=thoughts,
        steps=steps,
        primary_action="general",
        risk="none",
        confidence=0.7,
    )
