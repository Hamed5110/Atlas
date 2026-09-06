"""Local knowledge brain for the HCM AI Data Agent.

Patterns (open-source local agents):
- OpenClaw / AgentDB: SQLite FTS + hybrid keyword retrieval
- Khoj / Letta: private knowledge + persistent memory
- nanobot / Daedalus: tool catalog + cross-session memory

This module builds an in-process corpus from product packs, schema dictionary,
domain facts, and ai_learning_events — then ranks with BM25-style keyword scoring.
No cloud embeddings required (works offline); optional later: sqlite-vec / Ollama embed.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from airfare_management.ai_agent.product_knowledge import (
    KNOWLEDGE_VERSION,
    MODULE_CATALOG,
    PRODUCT_CAPABILITIES,
    as_public_capabilities,
)
from airfare_management.ai_agent.schema_dictionary import SCHEMA_VERSION, TABLES, as_public_dict
from airfare_management.infrastructure.schema import AiLearningEventRow

_TOKEN = re.compile(r"[a-z0-9_]{2,}")

# Everything built into Atlas HCM — durable domain facts for the local brain.
DOMAIN_FACTS: list[dict[str, str]] = [
    {
        "id": "fact_currency_bhd",
        "title": "Currency BHD",
        "text": (
            "Application currency is Bahraini Dinar (BHD) everywhere. UI formatters use "
            "en-BH with 3 decimal places. Company rows are normalized to BHD on startup."
        ),
        "tags": "bhd currency dinar bahrain finance",
    },
    {
        "id": "fact_company_mssql",
        "title": "Company profile in MSSQL",
        "text": (
            "companies table stores code, name, currency, cr_no, address, logo_data "
            "(VARBINARY MAX), logo_content_type. Soft-delete via deleted_at. Logos mirrored "
            "to disk only for PDF letterheads. CRUD + logo upload via /v1/companies."
        ),
        "tags": "company logo cr_no address mssql settings branding",
    },
    {
        "id": "fact_documents",
        "title": "Offer letters and contracts",
        "text": (
            "documents table holds offer_letter and contract vouchers. employee_id is "
            "nullable for pre-hire offers. PDF print prefers headless Chrome/Edge "
            "(HarfBuzz + Unicode bidi). Contracts print as Focus Soft–style bordered "
            "bilingual forms: logo left, document no right, Times New Roman EN + "
            "Traditional Arabic, orange field highlights, Eastern numerals on AR "
            "salary/dates, clauses 1–17, salary as 350.00/- with words ***. "
            "xhtml2pdf + arabic-reshaper is fallback only."
        ),
        "tags": "offer letter contract voucher pdf arabic letterhead chromium focus lmra",
    },
    {
        "id": "fact_allocation_print",
        "title": "Airfare allocation A4 print",
        "text": (
            "Allocation Download A4 PDF calls POST /v1/allocations/print.pdf with ticket_id. "
            "Saved ticket amounts are source of truth. Print sheet and PDF use bilingual "
            "letterhead; identity rows show each value once (EN label | value | AR label). "
            "ENTITLEMENT_AMOUNT settlement is blocked when entitlement is 0."
        ),
        "tags": "allocation print pdf ticket_id letterhead arabic duplicate",
    },
    {
        "id": "fact_airports",
        "title": "Worldwide airport search",
        "text": (
            "Origin/Destination combobox uses OurAirports IATA catalog (~8900 airports). "
            "Ranking: match quality then India and Pakistan priority then hub size. "
            "Data in atlas-next/lib/airports-data.json."
        ),
        "tags": "airport iata origin destination india pakistan ourairports",
    },
    {
        "id": "fact_agent_safety",
        "title": "Schema-gated agent safety",
        "text": (
            "AI Data Agent Think Plan Act. Read-only SQL via sql_gate. Whitelisted repairs "
            "need Auto-Repair Mode and confirm APPLY. Never DROP/ALTER without human gate. "
            "Bulk fix everything is refused. Dialect MSSQL HCM_Airfare_Management."
        ),
        "tags": "agent safety sql_gate whitelist repair ooda privacy local",
    },
    {
        "id": "fact_ml_suite",
        "title": "Local ML suite",
        "text": (
            "Local ML tools: IsolationForest ticket anomalies, EMI default risk "
            "(LogisticRegression fallback rules), ARIMA/moving-average budget forecast, "
            "rate recommendation, ESS sentiment. Prefer sklearn when installed; rule "
            "fallbacks keep the agent offline-capable."
        ),
        "tags": "machine learning anomaly forecast emi risk sentiment sklearn local",
    },
    {
        "id": "fact_research",
        "title": "Online research tool",
        "text": (
            "Agent can research online via DuckDuckGo Instant Answer and allowlisted "
            "HTTPS fetch (Microsoft Learn, OurAirports, GitHub docs). Results are cited "
            "and optionally stored in ai_learning_events. HCM MSSQL data never leaves "
            "the machine for research calls."
        ),
        "tags": "research online web search duckduckgo privacy",
    },
    {
        "id": "fact_entitlement",
        "title": "Airfare entitlement engine",
        "text": (
            "Entitlement rates are scoped with effective dating. Tickets compare "
            "ticket_cost vs entitlement; excess can become loans with EMI schedules. "
            "Opening balances seed yearly entitlement days."
        ),
        "tags": "entitlement rates tickets excess loan emi opening balance",
    },
    {
        "id": "fact_loan_settle_return",
        "title": "Loan settle and return lifecycle",
        "text": (
            "Loan statuses: active, deferred, settled. Settle posts full outstanding and "
            "closes the loan. Return on deferred resumes active recovery. Return/Reopen on "
            "settled soft-deletes loan_payments (ERPNext/Frappe cancel-repayment pattern) "
            "and restores outstanding to principal with a rebuilt EMI schedule. Every loan "
            "UI step requires confirmation. Delete loan is blocked while payments exist."
        ),
        "tags": "loan settle settled return reopen defer emi erpnext frappe repayment reverse",
    },
    {
        "id": "fact_allocation_linked_loan",
        "title": "Allocation linked-loan confirm",
        "text": (
            "Airfare Allocation tickets may link a recovery loan via source_ticket_id. "
            "On edit or delete, the UI asks Delete loan vs Keep loan (expense-claim "
            "parent/child batch confirm pattern). Keep+save revises unpaid loans; settled "
            "loans must be reopened on Loans first. Ticket list exposes loan_id, loan_code, "
            "loan_status, loan_version, loan_outstanding."
        ),
        "tags": "allocation ticket linked loan delete loan keep loan confirm excess convert_to_loan",
    },
    {
        "id": "fact_allocation_settlement_gates",
        "title": "Allocation settlement option gates",
        "text": (
            "When ticket > entitlement, HR chooses excess settlement: SELF_PAID, COMPANY_PAID, "
            "CONVERT_TO_LOAN (Make loan), or ENTITLEMENT_AMOUNT (cap ticket at entitlement). "
            "ENTITLEMENT_AMOUNT is hard-disabled when final_entitlement_amount is zero or negative — "
            "capping at zero would issue a blank ticket (travel-advance systems block empty funding "
            "buckets the same way). Backend raises entitlement_amount_unavailable; UI greys the card "
            "and clears a stale selection. With zero entitlement, valid excess options are Self paid, "
            "Fully company paid, or Make loan."
        ),
        "tags": "allocation settlement entitlement amount zero balance excess self paid company paid loan gate",
    },
    {
        "id": "fact_local_ollama",
        "title": "Local Ollama free LLM",
        "text": (
            "AI Insights shows a Local Ollama panel. Free path: Ollama on "
            "http://127.0.0.1:11434 with model deepseek-r1:1.5b (or configured "
            "AIRFARE_AI_OLLAMA_MODEL). Provider auto prefers Ollama, then optional "
            "DeepSeek cloud if AIRFARE_AI_DEEPSEEK_API_KEY is set. Status API: "
            "GET /v1/ai/llm/status. Check local Ollama button refreshes status and "
            "asks capabilities. Teaching mode uses Ollama to explain modules and how-tos "
            "from the BM25 knowledge brain — HCM data never leaves the machine for Ollama."
        ),
        "tags": "ollama local llm free deepseek ai insights teach polish synthesis",
    },
    {
        "id": "fact_allocation_post_ticket_amounts",
        "title": "Post-ticket accrual amounts",
        "text": (
            "After a same-year previous ticket, Accrued Days restart from the day after "
            "that ticket (30/360). Opening is treated as settled. Current-year remaining "
            "and Total available funds equal unpaid post-ticket accrual "
            "(accrued_days × per_day_rate), not MaxPayout minus full-year spend. "
            "Example: AGIL 0127 after 01 Jan 2026 ticket shows ~20.4 accrued days and "
            "~BHD 51.04 remaining/available while Already Paid Days still shows prior "
            "consumption (e.g. 60). Calculate via POST /v1/allocations/preview."
        ),
        "tags": "allocation entitlement previous ticket accrued days current year remaining total available funds",
    },
    {
        "id": "fact_modern_entitlement",
        "title": "Modern entitlement method",
        "text": (
            "Atlas HCM uses continuous modern entitlement — NOT a fiscal period-end / year-close wipe. "
            "Default cycle_reset_basis is joining_date (rolling hire anniversary). "
            "Primary path: Entitlement Rates (/rates, table entitlement_rates, BHD) + Airfare Allocation "
            "(/allocation, POST /v1/allocations/preview). Ticket/opening windows follow the anniversary "
            "cycle (Workday/SF hire-date pattern). Opening balances and tickets feed remaining/available. "
            "Period-end UI and year-close buttons were removed from the product path."
        ),
        "tags": "modern entitlement continuous joining date rates allocation no year end period end removed",
    },
    {
        "id": "fact_airfare_payable_report",
        "title": "R01 Airfare Payable Statement",
        "text": (
            "Reports catalog includes airfare-payable, airfare-payable-summary, "
            "airfare-payable-exceptions. Data: GET /v1/reports/data/airfare-payable?year=. "
            "Uses AllocationQueryHandler entitlement engine; filters year, as_of_date, "
            "company_id, department. Excel/PDF export supported."
        ),
        "tags": "reports payable r01 airfare statement export excel pdf",
    },
    {
        "id": "fact_how_to_learn",
        "title": "How to learn the system with Ollama",
        "text": (
            "On AI Insights: open Local Ollama panel, confirm Online, click "
            "'Teach me everything' or ask 'Teach me how allocation works', "
            "'What is modern entitlement', 'How does local Ollama work'. Agent recalls "
            "BM25 knowledge + product modules then Ollama teaches step-by-step. "
            "Also: POST /v1/ai/support/train reseeds product knowledge into "
            "ai_learning_events; GET /v1/ai/support/learning shows training memory."
        ),
        "tags": "teach learn tutorial how to ollama ai insights training knowledge brain",
    },
]


@dataclass
class KnowledgeHit:
    id: str
    source: str
    title: str
    text: str
    score: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "title": self.title,
            "text": self.text,
            "score": round(self.score, 4),
        }


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(text.casefold())


def _build_static_docs() -> list[dict[str, str]]:
    docs: list[dict[str, str]] = []
    for fact in DOMAIN_FACTS:
        docs.append(
            {
                "id": fact["id"],
                "source": "domain_fact",
                "title": fact["title"],
                "text": f"{fact['title']}. {fact['text']} {fact.get('tags', '')}",
            }
        )
    for mod in MODULE_CATALOG:
        docs.append(
            {
                "id": f"module:{mod['id']}",
                "source": "module_catalog",
                "title": mod["title"],
                "text": f"{mod['title']} route {mod['route']}. {mod['summary']}",
            }
        )
    for cap in PRODUCT_CAPABILITIES:
        rules = " ".join(cap.get("rules") or [])
        apis = " ".join(cap.get("apis") or [])
        docs.append(
            {
                "id": f"cap:{cap['id']}",
                "source": "product_capability",
                "title": cap["area"],
                "text": f"{cap['area']}. {cap['summary']} Rules: {rules}. APIs: {apis}. "
                f"Keywords: {' '.join(cap.get('keywords') or [])}",
            }
        )
    for table, meta in TABLES.items():
        cols = " ".join(sorted(meta.get("columns") or []))
        docs.append(
            {
                "id": f"table:{table}",
                "source": "schema",
                "title": f"MSSQL table {table}",
                "text": f"Table {table} columns {cols}. soft_delete={meta.get('soft_delete')}. "
                f"schema {SCHEMA_VERSION}",
            }
        )
    return docs


_STATIC_DOCS = _build_static_docs()


def _learning_docs(session: Session | None, limit: int = 80) -> list[dict[str, str]]:
    if session is None:
        return []
    try:
        rows = session.scalars(
            select(AiLearningEventRow).order_by(AiLearningEventRow.created_at.desc()).limit(limit)
        ).all()
    except Exception:  # noqa: BLE001
        return []
    docs: list[dict[str, str]] = []
    for row in rows:
        docs.append(
            {
                "id": f"learn:{row.check_code}:{row.id}",
                "source": "ai_learning_events",
                "title": f"{row.event_type}:{row.check_code}",
                "text": f"{row.summary} outcome={row.outcome} type={row.event_type}",
            }
        )
    return docs


def _bm25_rank(query: str, docs: list[dict[str, str]], *, k1: float = 1.5, b: float = 0.75) -> list[KnowledgeHit]:
    q_tokens = _tokens(query)
    if not q_tokens or not docs:
        return []
    doc_tokens = [_tokens(d["text"]) for d in docs]
    lengths = [len(t) or 1 for t in doc_tokens]
    avgdl = sum(lengths) / len(lengths)
    df: Counter[str] = Counter()
    for toks in doc_tokens:
        df.update(set(toks))
    n = len(docs)
    hits: list[KnowledgeHit] = []
    for doc, toks, dl in zip(docs, doc_tokens, lengths, strict=True):
        tf = Counter(toks)
        score = 0.0
        for term in q_tokens:
            if term not in tf:
                continue
            idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
            freq = tf[term]
            score += idf * (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * dl / avgdl))
        if score > 0:
            hits.append(
                KnowledgeHit(
                    id=doc["id"],
                    source=doc["source"],
                    title=doc["title"],
                    text=doc["text"][:600],
                    score=score,
                )
            )
    hits.sort(key=lambda h: h.score, reverse=True)
    return hits


def recall(
    query: str,
    *,
    session: Session | None = None,
    limit: int = 8,
) -> dict[str, Any]:
    """Retrieve local knowledge for a query (product + schema + learning memory)."""
    docs = list(_STATIC_DOCS) + _learning_docs(session)
    hits = _bm25_rank(query, docs)[:limit]
    return {
        "knowledge_version": KNOWLEDGE_VERSION,
        "schema_version": SCHEMA_VERSION,
        "corpus_size": len(docs),
        "hits": [h.as_dict() for h in hits],
        "answer_context": "\n\n".join(f"- **{h.title}**: {h.text}" for h in hits),
    }


def brain_stats(session: Session | None = None) -> dict[str, Any]:
    caps = as_public_capabilities()
    schema = as_public_dict()
    learn_n = 0
    if session is not None:
        try:
            from sqlalchemy import func

            learn_n = int(
                session.scalar(select(func.count()).select_from(AiLearningEventRow)) or 0
            )
        except Exception:  # noqa: BLE001
            learn_n = 0
    return {
        "mode": "local_knowledge_brain",
        "knowledge_version": KNOWLEDGE_VERSION,
        "schema_version": SCHEMA_VERSION,
        "static_docs": len(_STATIC_DOCS),
        "domain_facts": len(DOMAIN_FACTS),
        "modules": len(MODULE_CATALOG),
        "capabilities": len(PRODUCT_CAPABILITIES),
        "schema_tables": len(schema.get("tables") or {}),
        "learning_events": learn_n,
        "principles": caps.get("agent_principles"),
        "research_stack": [
            "Think-Plan-Act planner",
            "BM25 local knowledge recall",
            "DuckDuckGo + allowlisted web research",
            "Optional Ollama local LLM synthesis (free)",
            "Optional DeepSeek OpenAI-compatible API (when key set)",
            "sklearn ML suite with rule fallbacks",
            "MSSQL learning store ai_learning_events",
        ],
    }
