"""Schema-gated AI Data Agent for HCM Airfare (MSSQL).

Outputs: SQL (read / whitelisted repair preview), diagnostics, structured
recommendations, report_designer_payload. No application code generation.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from airfare_management.ai_agent.schema_dictionary import (
    REPORT_DATASETS,
    SCHEMA_VERSION,
    WHITELIST_REPAIRS,
    as_public_dict,
    candidates_for,
    schema_fingerprint,
)
from airfare_management.ai_agent.product_knowledge import (
    as_public_capabilities,
    capability_reply,
    list_modules_reply,
    match_capabilities,
)
from airfare_management.ai_agent.planner import build_plan
from airfare_management.ai_agent.sql_gate import missing_column_message, validate_against_schema
from airfare_management.application.support import (
    apply_remediation,
    learning_stats,
    run_diagnostics,
)
from airfare_management.infrastructure.schema import AiAgentAuditRow, AiRepairLogRow

_CURRENT_PLAN: ContextVar[dict[str, Any] | None] = ContextVar("agent_plan", default=None)


class ReportDesignerPayload(BaseModel):
    dataset: str
    title: str
    sql_source: str
    suggested_visualization: Literal["table", "pivot", "line", "bar", "variance"] = "table"
    default_filters: dict[str, Any] = Field(default_factory=dict)
    drill_paths: list[str] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    clarifying_questions: list[str] = Field(default_factory=list)


class RepairPreview(BaseModel):
    check_code: str
    apply_token: str
    before_count: int
    affected_ids: list[str] = Field(default_factory=list)
    narrative: str
    undo_sql: str | None = None
    requires_confirmation: bool = True


class AgentResponse(BaseModel):
    intent: str
    outcome: Literal["ok", "manual_review", "error", "needs_clarification", "awaiting_confirm"]
    reply: str
    confidence_score: float = 0.7
    tools_used: list[str] = Field(default_factory=list)
    sql: list[str] = Field(default_factory=list)
    sql_preview: list[dict[str, Any]] = Field(default_factory=list)
    findings: list[dict[str, Any]] = Field(default_factory=list)
    remediation: dict[str, Any] | None = None
    repair_preview: RepairPreview | None = None
    forecast: dict[str, Any] | None = None
    anomalies: dict[str, Any] | None = None
    report_designer_payload: ReportDesignerPayload | None = None
    learning: dict[str, Any] | None = None
    plan: dict[str, Any] | None = None
    research: dict[str, Any] | None = None
    knowledge: dict[str, Any] | None = None
    ml: dict[str, Any] | None = None
    schema_version: str = SCHEMA_VERSION
    estimated_cost: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _inject_think_plan(self) -> AgentResponse:
        """Attach Think→Plan payload and ensure planner is listed in tools_used."""
        current = _CURRENT_PLAN.get()
        if current and self.plan is None:
            self.plan = current
        if self.plan is not None and "planner" not in self.tools_used:
            self.tools_used = ["planner", *list(self.tools_used)]
        return self


_DETECT_SQL: dict[str, str] = {
    "duplicate_employee_codes": """
SELECT company_id, LOWER(code) AS code, COUNT(*) AS cnt
FROM employees
WHERE deleted_at IS NULL
GROUP BY company_id, LOWER(code)
HAVING COUNT(*) > 1
ORDER BY cnt DESC
""".strip(),
    "opening_balance_orphans": """
SELECT ob.id, ob.employee_id, ob.balance_year, ob.opening_days
FROM opening_balances ob
LEFT JOIN employees e ON e.id = ob.employee_id
WHERE ob.deleted_at IS NULL
  AND (e.id IS NULL OR e.deleted_at IS NOT NULL)
""".strip(),
    "overlapping_entitlement_rates": """
SELECT r1.id AS id_a, r2.id AS id_b, r1.scope_type, r1.scope_id,
       r1.effective_from AS from_a, r1.effective_to AS to_a,
       r2.effective_from AS from_b, r2.effective_to AS to_b
FROM entitlement_rates r1
JOIN entitlement_rates r2
  ON r1.scope_type = r2.scope_type
 AND ISNULL(r1.scope_id, '') = ISNULL(r2.scope_id, '')
 AND r1.id < r2.id
 AND r1.deleted_at IS NULL AND r2.deleted_at IS NULL
 AND r1.effective_from <= ISNULL(r2.effective_to, '9999-12-31')
 AND r2.effective_from <= ISNULL(r1.effective_to, '9999-12-31')
""".strip(),
    "locked_users": """
SELECT id, username, locked_until, failed_login_count, active
FROM users
WHERE deleted_at IS NULL AND locked_until IS NOT NULL
""".strip(),
    "loans_missing_schedule": """
SELECT l.id, l.employee_id, l.outstanding, l.installments, l.status
FROM loans l
WHERE l.deleted_at IS NULL AND l.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM loan_installments i
    WHERE i.loan_id = l.id AND i.deleted_at IS NULL
  )
""".strip(),
}

_REPORT_SQL: dict[str, tuple[str, str, list[str]]] = {
    "loan-outstanding": (
        "Loan outstanding",
        """
SELECT e.code AS employee_code, l.loan_number, l.outstanding, l.status, l.monthly_installment
FROM loans l
JOIN employees e ON e.id = l.employee_id
WHERE l.deleted_at IS NULL AND e.deleted_at IS NULL
ORDER BY l.outstanding DESC
""".strip(),
        ["employee_code", "loan_number", "outstanding", "status", "monthly_installment"],
    ),
    "ticket-register": (
        "Ticket register",
        """
SELECT e.code AS employee_code, t.travel_date,
       CONCAT(t.origin_code, '-', t.destination_code) AS route,
       t.ticket_cost, t.entitlement, t.status
FROM tickets t
JOIN employees e ON e.id = t.employee_id
WHERE t.deleted_at IS NULL AND e.deleted_at IS NULL
ORDER BY t.travel_date DESC
""".strip(),
        ["employee_code", "travel_date", "route", "ticket_cost", "entitlement", "status"],
    ),
    "opening-balances": (
        "Opening balances",
        """
SELECT e.code AS employee_code, ob.balance_year, ob.opening_days, ob.opening_amount
FROM opening_balances ob
JOIN employees e ON e.id = ob.employee_id
WHERE ob.deleted_at IS NULL AND e.deleted_at IS NULL
ORDER BY ob.balance_year DESC, e.code
""".strip(),
        ["employee_code", "balance_year", "opening_days", "opening_amount"],
    ),
    "employee-master": (
        "Employee master",
        """
SELECT code, full_name, department, branch, join_date, employment_status, active
FROM employees
WHERE deleted_at IS NULL
ORDER BY code
""".strip(),
        ["code", "full_name", "department", "branch", "join_date", "employment_status", "active"],
    ),
    "excess-recovery": (
        "Excess recovery",
        """
SELECT e.code AS employee_code, t.travel_date, t.ticket_cost, t.entitlement,
       t.excess_cost, t.excess_handling
FROM tickets t
JOIN employees e ON e.id = t.employee_id
WHERE t.deleted_at IS NULL AND e.deleted_at IS NULL
  AND t.company_paid > t.entitlement
ORDER BY t.travel_date DESC
""".strip(),
        ["employee_code", "travel_date", "ticket_cost", "entitlement", "excess_cost", "excess_handling"],
    ),
    "entitlements": (
        "Entitlement rates",
        """
SELECT scope_type, scope_id, amount, effective_from, effective_to, cap_amount
FROM entitlement_rates
WHERE deleted_at IS NULL
ORDER BY effective_from DESC
""".strip(),
        ["scope_type", "scope_id", "amount", "effective_from", "effective_to", "cap_amount"],
    ),
    "loan-statement": (
        "Loan statement",
        """
SELECT e.code AS employee_code, l.loan_number, l.status, l.outstanding,
       l.monthly_installment, i.installment_no, i.due_date, i.amount, i.status AS installment_status
FROM loans l
JOIN employees e ON e.id = l.employee_id
LEFT JOIN loan_installments i ON i.loan_id = l.id AND i.deleted_at IS NULL
WHERE l.deleted_at IS NULL AND e.deleted_at IS NULL
ORDER BY e.code, l.loan_number, i.installment_no
""".strip(),
        [
            "employee_code",
            "loan_number",
            "status",
            "outstanding",
            "monthly_installment",
            "installment_no",
            "due_date",
            "amount",
            "installment_status",
        ],
    ),
    "liability-projections": (
        "Liability projections",
        """
SELECT e.code AS employee_code, e.department,
       SUM(CASE WHEN t.status <> 'settled' THEN t.entitlement ELSE 0 END) AS open_entitlement,
       SUM(CASE WHEN l.status <> 'settled' THEN l.outstanding ELSE 0 END) AS loan_outstanding
FROM employees e
LEFT JOIN tickets t ON t.employee_id = e.id AND t.deleted_at IS NULL
LEFT JOIN loans l ON l.employee_id = e.id AND l.deleted_at IS NULL
WHERE e.deleted_at IS NULL
GROUP BY e.code, e.department
ORDER BY loan_outstanding DESC
""".strip(),
        ["employee_code", "department", "open_entitlement", "loan_outstanding"],
    ),
}


def _classify(message: str) -> str:
    """Classify via Think→Plan (deterministic). Kept for QA decision table."""
    return build_plan(message).primary_action


def _maybe_llm_polish(
    user_message: str,
    tool_context: dict[str, Any],
    fallback_reply: str,
    tools: list[str],
    *,
    system_prompt: str | None = None,
    timeout: float = 120.0,
) -> str:
    """Optional LLM rewrite (Ollama free → DeepSeek if configured). Never invents SQL."""
    try:
        from airfare_management.ai_agent.local_llm import SUPPORT_SYSTEM_PROMPT, synthesize
        from airfare_management.config import get_settings

        settings = get_settings()
        # Keep context small — local models follow short fact packs (ollama.com guidance).
        compact = {
            "facts": tool_context.get("facts")
            or tool_context.get("answer_context")
            or tool_context.get("teaching_outline")
            or fallback_reply[:3500],
            "question": user_message[:500],
        }
        result = synthesize(
            user_message=user_message,
            tool_context=compact,
            provider=settings.ai_llm_provider,
            ollama_enabled=settings.ai_ollama_enabled,
            ollama_base_url=settings.ai_ollama_base_url,
            ollama_model=settings.ai_ollama_model,
            deepseek_api_key=settings.ai_deepseek_api_key or None,
            deepseek_base_url=settings.ai_deepseek_base_url,
            deepseek_model=settings.ai_deepseek_model,
            deepseek_thinking=settings.ai_deepseek_thinking,
            deepseek_reasoning_effort=settings.ai_deepseek_reasoning_effort,
            timeout=timeout,
            system_prompt=system_prompt or SUPPORT_SYSTEM_PROMPT,
        )
        if result.get("ok") and result.get("reply"):
            provider = str(result.get("provider") or "llm")
            tools.append(provider)
            reply = str(result["reply"]).strip()
            if len(reply) < 80 or "### Answer" not in reply and "### Think" not in reply:
                return fallback_reply
            return reply
    except Exception:  # noqa: BLE001
        return fallback_reply
    return fallback_reply


# Back-compat alias for older imports / tests
_maybe_ollama_polish = _maybe_llm_polish


def _attach_plan(response: AgentResponse, plan_dict: dict[str, Any] | None) -> AgentResponse:
    if plan_dict is not None:
        response.plan = plan_dict
        if "planner" not in response.tools_used:
            response.tools_used = ["planner", *list(response.tools_used)]
    return response


def _audit(
    session: Session,
    *,
    prompt: str,
    intent: str,
    summary: str,
    sql_text: str | None = None,
    details: dict[str, Any] | None = None,
    confidence: float = 0.7,
    actor: str | None = None,
) -> None:
    session.add(
        AiAgentAuditRow(
            id=str(uuid4()),
            prompt=prompt[:4000],
            intent=intent,
            schema_version=SCHEMA_VERSION,
            sql_text=sql_text,
            result_summary=summary[:2000],
            details={**(details or {}), "fingerprint": schema_fingerprint()},
            confidence=confidence,
            actor=actor,
        )
    )
    session.flush()


def _run_select(session: Session, sql: str, *, limit: int = 20) -> list[dict[str, Any]]:
    validate_against_schema(sql, allow_write=False)
    # Soft-cap preview rows for safety
    wrapped = f"SELECT TOP ({int(limit)}) * FROM ({sql}) AS agent_q"
    try:
        result = session.execute(text(wrapped))
    except Exception:
        result = session.execute(text(sql))
    rows = result.mappings().all()
    return [dict(row) for row in rows[:limit]]


def _serialize_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        clean: dict[str, Any] = {}
        for key, value in row.items():
            if hasattr(value, "isoformat"):
                clean[key] = value.isoformat()
            else:
                clean[key] = value if value is None or isinstance(value, (str, int, float, bool)) else str(value)
        out.append(clean)
    return out


def _infer_check(message: str) -> str | None:
    lowered = message.casefold()
    mapping = {
        "duplicate": "duplicate_employee_codes",
        "orphan": "opening_balance_orphans",
        "overlap": "overlapping_entitlement_rates",
        "rate": "overlapping_entitlement_rates",
        "locked": "locked_users",
        "unlock": "locked_users",
        "schedule": "loans_missing_schedule",
        "emi": "loans_missing_schedule",
        "attachment": "attachments_scan_pending",
    }
    for token, code in mapping.items():
        if token in lowered:
            return code
    return None


def _infer_dataset(message: str) -> str | None:
    lowered = message.casefold()
    pairs = [
        ("loan", "loan-outstanding"),
        ("ticket", "ticket-register"),
        ("opening", "opening-balances"),
        ("balance", "opening-balances"),
        ("excess", "excess-recovery"),
        ("entitle", "entitlements"),
        ("employee", "employee-master"),
        ("airfare", "ticket-register"),
    ]
    for token, dataset in pairs:
        if token in lowered and dataset in REPORT_DATASETS:
            return dataset
    return None


def preview_repair(
    session: Session,
    check_code: str,
    *,
    actor: str | None = None,
) -> RepairPreview:
    if check_code not in WHITELIST_REPAIRS:
        raise ValueError(f"Repair `{check_code}` is not on the whitelist. Manual Review required.")
    detect_sql = _DETECT_SQL.get(check_code)
    affected: list[str] = []
    before = 0
    if detect_sql:
        validate_against_schema(detect_sql)
        rows = _run_select(session, detect_sql, limit=50)
        before = len(rows)
        for row in rows:
            for key in ("id", "id_a", "username"):
                if key in row and row[key] is not None:
                    affected.append(str(row[key]))
                    break
    token = secrets.token_hex(16)
    undo = (
        f"-- Inverse notes for {check_code}. Restore from backup if needed.\n"
        f"-- apply_token={token}"
    )
    session.add(
        AiRepairLogRow(
            id=str(uuid4()),
            check_code=check_code,
            status="preview",
            preview={"before_count": before, "affected_ids": affected[:50]},
            undo_sql=undo,
            apply_token=token,
            fixed=0,
            actor=actor,
        )
    )
    session.flush()
    return RepairPreview(
        check_code=check_code,
        apply_token=token,
        before_count=before,
        affected_ids=affected[:25],
        narrative=(
            f"Whitelisted repair `{check_code}` would touch ~{before} row(s). "
            "Confirm with APPLY + token (Auto-Repair Mode)."
        ),
        undo_sql=undo,
    )


def apply_repair_token(
    session: Session,
    *,
    apply_token: str,
    confirm: str,
    actor: str | None = None,
) -> dict[str, Any]:
    from sqlalchemy import select

    if confirm.strip().upper() != "APPLY":
        raise ValueError('Type APPLY to confirm. Bulk "fix everything" is refused.')
    item = session.scalar(select(AiRepairLogRow).where(AiRepairLogRow.apply_token == apply_token))
    if item is None or item.status != "preview":
        raise ValueError("Invalid or already-used apply token.")
    if item.check_code not in WHITELIST_REPAIRS:
        raise ValueError("Repair not whitelisted.")
    result = apply_remediation(session, item.check_code, actor=actor)
    item.status = "applied"
    item.fixed = int(result.get("fixed") or 0)
    item.applied_at = datetime.now(UTC)
    session.flush()
    return {
        "check_code": item.check_code,
        "fixed": item.fixed,
        "verified": result.get("verified"),
        "outcome": result.get("outcome"),
        "apply_token": apply_token,
        "undo_sql": item.undo_sql,
    }


def run_agent(
    session: Session,
    *,
    message: str,
    apply_fix: str | None = None,
    auto_repair_mode: bool = False,
    apply_token: str | None = None,
    confirm: str | None = None,
    actor: str | None = None,
) -> AgentResponse:
    # Think → Plan (no side effects) before any tool action.
    plan = build_plan(
        message,
        auto_repair_mode=auto_repair_mode,
        apply_token=apply_token,
        confirm=confirm,
    )
    plan_dict = plan.as_dict()
    plan_token = _CURRENT_PLAN.set(plan_dict)
    try:
        return _run_agent_body(
            session,
            message=message,
            apply_fix=apply_fix,
            auto_repair_mode=auto_repair_mode,
            apply_token=apply_token,
            confirm=confirm,
            actor=actor,
            plan=plan,
            plan_dict=plan_dict,
        )
    finally:
        _CURRENT_PLAN.reset(plan_token)


def _run_agent_body(
    session: Session,
    *,
    message: str,
    apply_fix: str | None,
    auto_repair_mode: bool,
    apply_token: str | None,
    confirm: str | None,
    actor: str | None,
    plan: Any,
    plan_dict: dict[str, Any],
) -> AgentResponse:
    intent = plan.primary_action if not apply_fix else "diagnose"
    if apply_fix and intent not in {"unsafe", "unsafe_bulk_fix"}:
        intent = "diagnose"
    tools: list[str] = ["planner"]

    # Explicit apply path
    if apply_token and confirm:
        try:
            if not auto_repair_mode:
                return AgentResponse(
                    intent="apply_repair",
                    outcome="manual_review",
                    reply="Auto-Repair Mode is OFF. Enable it, then confirm APPLY for a previewed fix.",
                    confidence_score=0.95,
                    tools_used=tools,
                )
            result = apply_repair_token(session, apply_token=apply_token, confirm=confirm, actor=actor)
            tools.append("apply_repair")
            _audit(
                session,
                prompt=message,
                intent="apply_repair",
                summary=str(result),
                actor=actor,
                confidence=0.9,
                details={"plan": plan_dict},
            )
            return AgentResponse(
                intent="apply_repair",
                outcome="ok",
                reply=f"Applied `{result['check_code']}`: fixed {result['fixed']} record(s).",
                confidence_score=0.9,
                tools_used=tools,
                remediation=result,
            )
        except ValueError as exc:
            return AgentResponse(
                intent="apply_repair",
                outcome="error",
                reply=str(exc),
                confidence_score=0.99,
                tools_used=tools,
            )

    if intent in {"unsafe", "unsafe_bulk_fix", "refuse"}:
        reply = (
            "Refuse. I Think → Plan → Act and will not run bulk or destructive fixes. "
            "Review findings individually; enable Auto-Repair Mode and confirm each whitelisted fix."
        )
        _audit(
            session,
            prompt=message,
            intent=intent,
            summary=reply,
            actor=actor,
            confidence=0.99,
            details={"plan": plan_dict},
        )
        return AgentResponse(
            intent=intent,
            outcome="manual_review",
            reply=reply,
            confidence_score=0.99,
            tools_used=tools,
        )

    if intent == "capabilities":
        from airfare_management.ai_agent.knowledge_brain import brain_stats
        from airfare_management.ai_agent.local_llm import llm_status
        from airfare_management.config import get_settings

        tools.extend(["product_knowledge", "knowledge_brain"])
        stats = brain_stats(session)
        settings = get_settings()
        llm = llm_status(
            ollama_enabled=settings.ai_ollama_enabled,
            ollama_base_url=settings.ai_ollama_base_url,
            ollama_model=settings.ai_ollama_model,
            deepseek_api_key=settings.ai_deepseek_api_key or None,
            deepseek_base_url=settings.ai_deepseek_base_url,
            deepseek_model=settings.ai_deepseek_model,
            provider=settings.ai_llm_provider,
        )
        active = llm.get("active_provider") or "none"
        ollama_state = "online" if llm["ollama"]["online"] else "offline"
        deepseek_state = "key set" if llm["deepseek"]["configured"] else "no key"
        reply = (
            list_modules_reply()
            + f"\n\n**Local AI brain:** {stats['static_docs']} docs · "
            f"{stats['learning_events']} learning events · schema `{stats['schema_version']}`.\n"
            f"**Tools:** BM25 recall, online research "
            f"({'on' if settings.ai_research_enabled else 'off'}), "
            f"LLM synthesis (active={active}; Ollama {ollama_state}; DeepSeek {deepseek_state}), "
            f"sklearn ML suite, schema-gated SQL, SAA baseline.\n"
            f"Stack: {', '.join(stats.get('research_stack') or [])}.\n\n"
            "For Think→Logic→Answer support, ask: **Teach me everything** or **Support me step by step** "
            "(those use local Ollama)."
        )
        caps = as_public_capabilities()
        # Keep capabilities fast — do not block Ask on Ollama (teach/support paths polish).
        _audit(session, prompt=message, intent=intent, summary=reply[:2000], actor=actor, details={"plan": plan_dict, "brain": stats})
        return AgentResponse(
            intent=intent,
            outcome="ok",
            reply=reply,
            confidence_score=0.95,
            tools_used=tools,
            learning={"product_capabilities": caps, "brain": stats, "llm": llm},
            knowledge=stats,
            plan=plan_dict,
        )

    if intent == "teach":
        from airfare_management.ai_agent.knowledge_brain import brain_stats, recall
        from airfare_management.ai_agent.local_llm import SUPPORT_SYSTEM_PROMPT, llm_status
        from airfare_management.ai_agent.product_knowledge import MODULE_CATALOG, capability_reply, match_capabilities
        from airfare_management.config import get_settings

        tools.extend(["knowledge_brain", "product_knowledge", "teach"])
        settings = get_settings()
        stats = brain_stats(session)
        knowledge = recall(message, session=session, limit=6)
        hit_rows = knowledge.get("hits") or []
        caps = match_capabilities(message)
        llm = llm_status(
            ollama_enabled=settings.ai_ollama_enabled,
            ollama_base_url=settings.ai_ollama_base_url,
            ollama_model=settings.ai_ollama_model,
            deepseek_api_key=settings.ai_deepseek_api_key or None,
            deepseek_base_url=settings.ai_deepseek_base_url,
            deepseek_model=settings.ai_deepseek_model,
            provider=settings.ai_llm_provider,
        )
        lowered = message.casefold()
        want_everything = any(
            t in lowered for t in ("teach everything", "teach me everything", "what was built", "all modules")
        )
        fact_lines = [
            f"- **{h.get('title')}**: {str(h.get('text') or '')[:400]}" for h in hit_rows[:4]
        ]
        if caps:
            # Keep product pack short so the focused answer is not drowned.
            fact_lines.append(capability_reply(caps)[:900])
        if any(
            t in lowered
            for t in (
                "period end",
                "period-end",
                "year end",
                "year-end",
                "year close",
                "modern entitlement",
                "joining date",
                "joining-date",
                "no year end",
            )
        ):
            fact_lines.insert(
                0,
                "- **Modern entitlement (no period-end)**: The live product path does **not** use "
                "fiscal year-end close / period-end wipe. Use **Entitlement Rates** (`/rates`, "
                "`entitlement_rates`, BHD) + **Airfare Allocation** (`/allocation`, "
                "`POST /v1/allocations/preview`). Set cycle reset to **Joining date** in Settings "
                "for rolling anniversary entitlement. Old `/entitlement/year-end` only redirects "
                "to Allocation — do not run period-end buttons.",
            )
        if any(t in lowered for t in ("airfare rate", "entitlement rate", "what is rate", "rates", "airfare")):
            fact_lines.insert(
                0,
                "- **Airfare / entitlement rate**: MSSQL table `entitlement_rates` stores scoped rates "
                "(company/grade/nationality…) with effective dating. Amounts are BHD (Bahraini Dinar, 3 dp). "
                "UI screen: `/rates`. APIs: `GET /v1/entitlement-rates`, "
                "`GET /v1/ai/employees/{id}/rate-recommendation`. "
                "On Allocation (`/allocation`), Calculate entitlement uses the active rate for the travel date.",
            )
        if want_everything:
            facts = (
                "Modules:\n"
                + "\n".join(
                    f"- **{m['title']}** (`{m['route']}`): {m['summary']}" for m in MODULE_CATALOG[:14]
                )
                + "\n\nDomain facts:\n"
                + ("\n".join(fact_lines) or "- (none)")
            )
        else:
            facts = "\n".join(fact_lines) or (knowledge.get("answer_context") or "UNKNOWN — no local facts.")

        next_bits = (
            "- Open `/rates` to view/edit entitlement rates\n"
            "- Ask: How does allocation use the airfare rate?\n"
            if any(t in lowered for t in ("rate", "airfare"))
            else "- Open the screen named in Answer\n- Ask a follow-up question\n"
        )
        fallback = (
            f"### Think\n- Operator asked: {message}\n\n"
            f"### Logic\n- Answer from product knowledge + knowledge brain only.\n\n"
            f"### Answer\n{facts}\n\n"
            f"### Next\n{next_bits}"
        )
        curriculum = {
            "facts": facts,
            "question": message,
            "llm_model": (llm.get("ollama") or {}).get("model"),
            "source": "https://ollama.com/ local chat",
        }
        reply = _maybe_llm_polish(
            message,
            curriculum,
            fallback,
            tools,
            system_prompt=SUPPORT_SYSTEM_PROMPT,
            timeout=90.0,
        )
        _audit(
            session,
            prompt=message,
            intent=intent,
            summary=reply[:2000],
            actor=actor,
            details={"plan": plan_dict, "hits": len(hit_rows), "focused": not want_everything},
        )
        return AgentResponse(
            intent=intent,
            outcome="ok",
            reply=reply,
            confidence_score=0.93,
            tools_used=tools,
            learning={"brain": stats, "llm": llm, "focused": not want_everything},
            knowledge={**knowledge, **stats},
            plan=plan_dict,
        )

    if intent == "schema":
        tools.append("schema")
        payload = as_public_dict()
        reply = f"Active schema `{SCHEMA_VERSION}` — {len(payload['tables'])} tables. Dialect MSSQL."
        _audit(
            session,
            prompt=message,
            intent=intent,
            summary=reply,
            details={"plan": plan_dict, "schema": payload},
            actor=actor,
        )
        return AgentResponse(
            intent=intent,
            outcome="ok",
            reply=reply,
            confidence_score=0.95,
            tools_used=tools,
            learning={"schema": payload},
        )

    if intent == "product":
        from airfare_management.ai_agent.knowledge_brain import recall as brain_recall
        from airfare_management.ai_agent.local_llm import SUPPORT_SYSTEM_PROMPT

        tools.append("product_knowledge")
        caps = match_capabilities(message)
        knowledge = brain_recall(message, session=session, limit=5)
        if knowledge.get("hits"):
            tools.append("knowledge_brain")
        raw = capability_reply(caps) or "No matching product capability found."
        if knowledge.get("answer_context"):
            raw += "\n" + str(knowledge.get("answer_context"))
        facts = raw[:4500]
        fallback = (
            f"### Think\n- Operator asked: {message}\n\n"
            f"### Logic\n- Use product capability packs + local recall only.\n\n"
            f"### Answer\n{facts}\n\n"
            "### Next\n- Open the related screen from the answer\n"
            "- Ask a follow-up (e.g. how do I set an entitlement rate)\n"
        )
        reply = _maybe_llm_polish(
            message,
            {"facts": facts, "question": message},
            fallback,
            tools,
            system_prompt=SUPPORT_SYSTEM_PROMPT,
            timeout=90.0,
        )
        details = {"capabilities": [c["id"] for c in caps], "plan": plan_dict}
        _audit(
            session,
            prompt=message,
            intent=intent,
            summary=reply[:2000],
            details=details,
            actor=actor,
            confidence=0.92,
        )
        return AgentResponse(
            intent=intent,
            outcome="ok",
            reply=reply,
            confidence_score=0.92,
            tools_used=tools,
            learning={"product_capabilities": caps},
            knowledge=knowledge,
            plan=plan_dict,
        )

    if intent == "recall":
        from airfare_management.ai_agent.knowledge_brain import recall as brain_recall

        tools.append("knowledge_brain")
        knowledge = brain_recall(message, session=session, limit=10)
        reply = knowledge.get("answer_context") or "No local knowledge hits."
        reply = (
            f"Local knowledge brain (`{knowledge.get('knowledge_version')}`, "
            f"corpus {knowledge.get('corpus_size')}):\n\n{reply}"
        )
        _audit(session, prompt=message, intent=intent, summary=reply[:2000], actor=actor, details={"plan": plan_dict})
        return AgentResponse(
            intent=intent,
            outcome="ok",
            reply=reply,
            confidence_score=0.9,
            tools_used=tools,
            knowledge=knowledge,
        )

    if intent == "research":
        from airfare_management.ai_agent.web_research import remember_research, research_online
        from airfare_management.config import get_settings

        settings = get_settings()
        if not settings.ai_research_enabled:
            return AgentResponse(
                intent=intent,
                outcome="manual_review",
                reply="Online research is disabled (AIRFARE_AI_RESEARCH_ENABLED=false).",
                confidence_score=0.95,
                tools_used=tools,
            )
        tools.append("web_research")
        # Strip trigger words for a cleaner query
        q = message
        for prefix in (
            "research online",
            "research ",
            "search the web for",
            "search online for",
            "search online",
            "look up online",
        ):
            if q.casefold().startswith(prefix):
                q = q[len(prefix) :].strip(" :,-")
                break
        result = research_online(q or message)
        try:
            remember_research(session, query=q or message, result=result, actor=actor)
            tools.append("learning_store")
        except Exception:  # noqa: BLE001
            pass
        reply = result.get("summary") or "No research result."
        if result.get("privacy_note"):
            reply += f"\n\n_{result['privacy_note']}_"
        # Optional local LLM polish
        reply = _maybe_ollama_polish(message, {"research": result}, reply, tools)
        _audit(
            session,
            prompt=message,
            intent=intent,
            summary=reply[:2000],
            actor=actor,
            details={"plan": plan_dict, "citations": result.get("citations")},
            confidence=0.8 if result.get("ok") else 0.5,
        )
        return AgentResponse(
            intent=intent,
            outcome="ok" if result.get("ok") else "needs_clarification",
            reply=reply,
            confidence_score=0.8 if result.get("ok") else 0.55,
            tools_used=tools,
            research=result,
        )

    if intent == "ml_insight":
        tools.append("ml_suite")
        ml_payload: dict[str, Any] = {"notes": []}
        lowered = message.casefold()
        try:
            if "sentiment" in lowered:
                from airfare_management.ai_agent.sentiment import analyze_sentiment

                text = message
                for p in ("sentiment", "analyze", "ess"):
                    text = text.replace(p, "")
                ml_payload["sentiment"] = analyze_sentiment(text.strip() or message)
                ml_payload["notes"].append("sentiment")
            if "forecast" in lowered or "budget" in lowered or "spend" in lowered:
                from airfare_management.ai_agent.forecaster import forecast_monthly_spend
                from airfare_management.infrastructure.schema import TicketRow
                from sqlalchemy import select as sa_select

                history = list(
                    session.scalars(
                        sa_select(TicketRow.ticket_cost)
                        .where(TicketRow.deleted_at.is_(None))
                        .order_by(TicketRow.travel_date.desc())
                        .limit(24)
                    )
                )
                ml_payload["forecast"] = forecast_monthly_spend(history)
                ml_payload["notes"].append("forecast")
            if "anomal" in lowered or "outlier" in lowered or "ml insight" in lowered or "machine learning" in lowered:
                from airfare_management.ai_agent.anomaly_detector import score_ticket_anomalies
                from airfare_management.infrastructure.schema import TicketRow
                from sqlalchemy import select as sa_select

                rows = [
                    {
                        "ticket_cost": str(t.ticket_cost),
                        "entitlement": str(t.entitlement),
                        "employee_id": str(t.employee_id),
                    }
                    for t in session.scalars(
                        sa_select(TicketRow).where(TicketRow.deleted_at.is_(None)).limit(500)
                    )
                ]
                ml_payload["anomalies"] = score_ticket_anomalies(rows)
                ml_payload["notes"].append("anomalies")
            if "emi" in lowered or "default risk" in lowered:
                ml_payload["notes"].append(
                    "emi_risk: use POST /v1/ai/emi-risk or /v1/ai/loans/{id}/risk-score with a loan id"
                )
            if "rate" in lowered:
                ml_payload["notes"].append(
                    "rate_recommendation: use GET /v1/ai/employees/{id}/rate-recommendation"
                )
        except Exception as exc:  # noqa: BLE001
            ml_payload["error"] = str(exc)
        if not ml_payload.get("notes") and not ml_payload.get("error"):
            ml_payload["notes"].append(
                "Try: machine learning anomalies, forecast spend, sentiment <text>, emi risk"
            )
        reply = "Local ML suite results:\n" + json.dumps(ml_payload, default=str)[:2500]
        reply = _maybe_ollama_polish(message, ml_payload, reply, tools)
        return AgentResponse(
            intent=intent,
            outcome="ok",
            reply=reply,
            confidence_score=0.8,
            tools_used=tools,
            ml=ml_payload,
            anomalies=ml_payload.get("anomalies") if isinstance(ml_payload.get("anomalies"), dict) else None,
            forecast=ml_payload.get("forecast") if isinstance(ml_payload.get("forecast"), dict) else None,
        )

    if intent == "diagnose" or apply_fix:
        diagnostics = run_diagnostics(session, actor=actor)
        tools.append("diagnose")
        findings = diagnostics.get("findings") or []
        sqls: list[str] = []
        previews: list[dict[str, Any]] = []
        for finding in findings:
            code = finding.get("check_code")
            detect = _DETECT_SQL.get(str(code or ""))
            if detect:
                try:
                    validate_against_schema(detect)
                    sqls.append(detect)
                    rows = _serialize_rows(_run_select(session, detect, limit=10))
                    previews.append({"check_code": code, "rows": rows, "row_count": len(rows)})
                except Exception as exc:  # noqa: BLE001
                    previews.append({"check_code": code, "error": str(exc)})
            rate = finding.get("learned_success_rate")
            if rate is not None:
                finding["confidence_score"] = finding.get("confidence", 0.7)
        count = len(findings)
        reply = (
            "Diagnostics complete — healthy."
            if diagnostics.get("healthy") and count == 0
            else f"Found {count} issue(s), ranked by confidence. Whitelisted repairs need Auto-Repair + APPLY."
        )
        reply = _maybe_llm_polish(
            message,
            {"diagnostics": {"healthy": diagnostics.get("healthy"), "finding_count": count, "findings": findings[:12]}},
            reply,
            tools,
        )
        _audit(
            session,
            prompt=message,
            intent="diagnose",
            summary=reply,
            sql_text="\n\n".join(sqls) or None,
            details={"findings": count},
            actor=actor,
        )
        return AgentResponse(
            intent="diagnose",
            outcome="ok",
            reply=reply,
            confidence_score=0.85 if count else 0.9,
            tools_used=tools,
            sql=sqls,
            sql_preview=previews,
            findings=findings,
        )

    if intent == "repair_preview":
        if not auto_repair_mode:
            return AgentResponse(
                intent=intent,
                outcome="manual_review",
                reply="Auto-Repair Mode is OFF by default. Enable it to preview a whitelisted fix, then confirm APPLY.",
                confidence_score=0.95,
            )
        code = apply_fix or _infer_check(message)
        if not code:
            diagnostics = run_diagnostics(session, actor=actor)
            tools.append("diagnose")
            auto = [f for f in diagnostics["findings"] if f.get("auto_fixable")]
            if not auto:
                return AgentResponse(
                    intent=intent,
                    outcome="manual_review",
                    reply="No auto-fixable findings. Run diagnostics first.",
                    tools_used=tools,
                    findings=diagnostics["findings"],
                    confidence_score=0.8,
                )
            code = str(auto[0]["check_code"])
        try:
            preview = preview_repair(session, code, actor=actor)
            tools.append("repair_preview")
            detect = _DETECT_SQL.get(code)
            if detect:
                validate_against_schema(detect)
            _audit(session, prompt=message, intent=intent, summary=preview.narrative, actor=actor, confidence=0.8)
            return AgentResponse(
                intent=intent,
                outcome="awaiting_confirm",
                reply=preview.narrative + ' Reply with confirm=APPLY and this apply_token.',
                confidence_score=0.8,
                tools_used=tools,
                sql=[detect] if detect else [],
                repair_preview=preview,
            )
        except ValueError as exc:
            return AgentResponse(intent=intent, outcome="manual_review", reply=str(exc), confidence_score=0.95)

    if intent == "forecast":
        from airfare_management.ai_agent.forecaster import forecast_monthly_spend
        from airfare_management.infrastructure.schema import TicketRow
        from sqlalchemy import select

        tools.append("forecast")
        cost = {"row_scans": 24, "seconds": 1, "requires_confirm": False}
        history = list(
            session.scalars(
                select(TicketRow.ticket_cost)
                .where(TicketRow.deleted_at.is_(None))
                .order_by(TicketRow.travel_date.desc())
                .limit(24)
            )
        )
        forecast = forecast_monthly_spend(history)
        reply = f"Budget forecast ready ({len(forecast.get('forecast', []))} months)."
        _audit(session, prompt=message, intent=intent, summary=reply, actor=actor, details=cost)
        return AgentResponse(
            intent=intent,
            outcome="ok",
            reply=reply,
            confidence_score=0.75,
            tools_used=tools,
            forecast=forecast,
            estimated_cost=cost,
        )

    if intent == "anomaly":
        from airfare_management.ai_agent.anomaly_detector import score_ticket_anomalies
        from airfare_management.infrastructure.schema import TicketRow
        from sqlalchemy import select

        tools.append("anomaly")
        rows = [
            {
                "ticket_cost": str(t.ticket_cost),
                "entitlement": str(t.entitlement),
                "employee_id": str(t.employee_id),
            }
            for t in session.scalars(select(TicketRow).where(TicketRow.deleted_at.is_(None)).limit(500))
        ]
        cost = {"row_scans": len(rows), "seconds": max(1, len(rows) // 200), "requires_confirm": len(rows) > 2000}
        if cost["requires_confirm"]:
            return AgentResponse(
                intent=intent,
                outcome="needs_clarification",
                reply=f"Anomaly scan estimates {cost['row_scans']} row scans. Confirm to proceed.",
                estimated_cost=cost,
                confidence_score=0.7,
            )
        flagged = score_ticket_anomalies(rows)
        items = [
            {
                "anomaly_type": "ticket_cost_outlier",
                "detected_at": datetime.now(UTC).isoformat(),
                "severity": "warning",
                "contributing_sql": _DETECT_SQL.get("loans_missing_schedule"),
                "narrative_summary": str(item),
            }
            for item in flagged[:25]
        ]
        reply = f"Anomaly scan flagged {len(flagged)} ticket row(s)."
        _audit(session, prompt=message, intent=intent, summary=reply, actor=actor)
        return AgentResponse(
            intent=intent,
            outcome="ok",
            reply=reply,
            confidence_score=0.72,
            tools_used=tools,
            anomalies={"count": len(flagged), "items": items},
            estimated_cost=cost,
        )

    if intent == "draft_report":
        dataset = _infer_dataset(message)
        if dataset is None:
            return AgentResponse(
                intent=intent,
                outcome="needs_clarification",
                reply="I can draft a report. Which dataset? (employee-master, opening-balances, tickets, loans, excess-recovery)",
                confidence_score=0.6,
                report_designer_payload=ReportDesignerPayload(
                    dataset="employee-master",
                    title="Clarify report scope",
                    sql_source="",
                    clarifying_questions=[
                        "Granularity: employee / department / month?",
                        "Time horizon: YTD / last 12 months / open?",
                        "Compare-to period needed?",
                    ],
                ),
            )
        title, sql, columns = _REPORT_SQL[dataset]
        validate_against_schema(sql)
        tools.append("draft_report")
        preview = _serialize_rows(_run_select(session, sql, limit=20))
        payload = ReportDesignerPayload(
            dataset=dataset,
            title=title,
            sql_source=sql,
            suggested_visualization="table",
            default_filters={"deleted_at": None},
            drill_paths=["employee_code", "department"] if "employee" in dataset else ["employee_code"],
            columns=columns,
        )
        reply = f"Drafted read-only SQL for `{dataset}` (top 20 preview). Open Reports Designer to refine."
        _audit(session, prompt=message, intent=intent, summary=reply, sql_text=sql, actor=actor)
        return AgentResponse(
            intent=intent,
            outcome="ok",
            reply=reply,
            confidence_score=0.82,
            tools_used=tools,
            sql=[sql],
            sql_preview=[{"dataset": dataset, "rows": preview, "row_count": len(preview)}],
            report_designer_payload=payload,
        )

    if intent == "sql":
        # Only allow canned / dictionary-backed detection SQL — never free-form user SQL execution.
        code = _infer_check(message) or "duplicate_employee_codes"
        sql = _DETECT_SQL.get(code)
        if not sql:
            return AgentResponse(
                intent=intent,
                outcome="manual_review",
                reply="Low confidence — recommend manual review. No catalog SQL matched.",
                confidence_score=0.4,
            )
        try:
            validate_against_schema(sql)
            rows = _serialize_rows(_run_select(session, sql, limit=20))
        except ValueError as exc:
            return AgentResponse(intent=intent, outcome="error", reply=str(exc), confidence_score=0.9)
        tools.append("sql")
        _audit(session, prompt=message, intent=intent, summary=code, sql_text=sql, actor=actor)
        return AgentResponse(
            intent=intent,
            outcome="ok",
            reply=f"Schema-gated SELECT for `{code}` — {len(rows)} preview row(s).",
            confidence_score=0.8,
            tools_used=tools,
            sql=[sql],
            sql_preview=[{"check_code": code, "rows": rows, "row_count": len(rows)}],
        )

    if intent == "learning":
        stats = learning_stats(session)
        caps = as_public_capabilities()
        tools.append("learning")
        return AgentResponse(
            intent=intent,
            outcome="ok",
            reply=(
                f"Learning store has {stats.get('total_events', 0)} event(s). "
                f"Product knowledge version `{caps.get('knowledge_version')}` "
                f"covers {len(caps.get('capabilities') or [])} capability pack(s)."
            ),
            confidence_score=0.85,
            tools_used=tools,
            learning={**stats, "product_capabilities": caps},
        )

    # Unknown column mention
    col_match = re.search(r"\b([a-z_]{3,40})\b", message.casefold())
    if col_match and "column" in message.casefold():
        name = col_match.group(1)
        return AgentResponse(
            intent="schema",
            outcome="needs_clarification",
            reply=candidates_for(name) and f"I don't see `{name}` in the current schema. Available candidates are: {', '.join(candidates_for(name))}" or missing_column_message(name),
            confidence_score=0.7,
        )

    product_hits = match_capabilities(message)
    if product_hits:
        from airfare_management.ai_agent.knowledge_brain import recall as brain_recall
        from airfare_management.ai_agent.local_llm import SUPPORT_SYSTEM_PROMPT

        tools.append("product_knowledge")
        knowledge = brain_recall(message, session=session, limit=6)
        if knowledge.get("hits"):
            tools.append("knowledge_brain")
        fallback = capability_reply(product_hits)
        if knowledge.get("answer_context"):
            fallback += "\n\n**Local recall:**\n" + str(knowledge.get("answer_context"))
        reply = _maybe_llm_polish(
            message,
            {
                "mode": "support",
                "product_capabilities": [
                    {"id": c.get("id"), "summary": c.get("summary"), "apis": c.get("apis")}
                    for c in product_hits
                ],
                "answer_context": knowledge.get("answer_context"),
                "plan": plan_dict,
            },
            fallback,
            tools,
            system_prompt=SUPPORT_SYSTEM_PROMPT,
            timeout=90.0,
        )
        return AgentResponse(
            intent="product",
            outcome="ok",
            reply=reply,
            confidence_score=0.9,
            tools_used=tools,
            learning={"product_capabilities": product_hits},
            knowledge=knowledge,
            plan=plan_dict,
        )

    from airfare_management.ai_agent.knowledge_brain import recall as brain_recall
    from airfare_management.ai_agent.local_llm import SUPPORT_SYSTEM_PROMPT

    knowledge = brain_recall(message, session=session, limit=5)
    if knowledge.get("hits"):
        tools.append("knowledge_brain")
    hit_bits = [
        f"- **{h.get('title')}**: {str(h.get('text') or '')[:350]}"
        for h in (knowledge.get("hits") or [])[:4]
    ]
    facts = "\n".join(hit_bits) or "UNKNOWN — try: Teach me everything / Run diagnostics"
    fallback = (
        f"### Think\n- Operator asked: {message}\n\n"
        f"### Logic\n- Use local knowledge hits only; no invented features.\n\n"
        f"### Answer\n{facts}\n\n"
        "### Next\n- Ask a more specific question (e.g. what is modern entitlement)\n"
        "- Or click Teach me everything / Support me step by step\n"
    )
    reply = _maybe_llm_polish(
        message,
        {"facts": facts, "question": message},
        fallback,
        tools,
        system_prompt=SUPPORT_SYSTEM_PROMPT,
        timeout=90.0,
    )
    return AgentResponse(
        intent="general",
        outcome="ok",
        reply=reply,
        confidence_score=0.9,
        tools_used=tools,
        knowledge=knowledge,
        plan=plan_dict,
    )


# Compatibility alias used by older UI field name
ReportSpec = ReportDesignerPayload
