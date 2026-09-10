"""Product domain knowledge the AI Data Agent can recall and learn from.

Inspired by privacy-first local agents (OpenCode, ReAct / Reason-Plan-Act):
a structured capability catalog is the tool schema the agent reasons over
before acting. Feature work must land here so chat + /schema stay consistent.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from airfare_management.infrastructure.schema import AiLearningEventRow

KNOWLEDGE_VERSION = "atlas-hcm-local-brain-v9"

# Nav-aligned module map (atlas-next). Self-description source of truth.
# Summaries are operator-first: screen → what to click → outcome (TRUE MODE easy path).
MODULE_CATALOG: list[dict[str, Any]] = [
    {
        "id": "dashboard",
        "route": "/dashboard",
        "title": "Dashboard",
        "summary": (
            "Open Dashboard for live KPIs: employees, open tickets, active loans, "
            "outstanding BHD, and budget forecast. Click a card to jump to that screen."
        ),
    },
    {
        "id": "employees",
        "route": "/employees",
        "title": "Employees",
        "summary": (
            "Employee master: New/Edit/Delete, search, Export Excel, Bulk import. "
            "Join date and pay group drive entitlement rates and allocation."
        ),
    },
    {
        "id": "opening_balances",
        "route": "/opening-balances",
        "title": "Opening Balances",
        "summary": (
            "Per-year opening days/amounts. New/Edit/Delete or import Excel before "
            "calculating entitlement on Allocation."
        ),
    },
    {
        "id": "rates",
        "route": "/rates",
        "title": "Entitlement Rates",
        "summary": (
            "Set airfare rates (BHD) by employee / pay group / company / global with "
            "effective dates. Allocation uses the active rate for the travel date."
        ),
    },
    {
        "id": "allocation",
        "route": "/allocation",
        "title": "Airfare Allocation",
        "summary": (
            "Main ticket desk: Calculate entitlement → choose excess settlement "
            "(Self paid / Company paid / Make loan / Entitlement amount) → Issue ticket → "
            "Print A4 PDF. Continuous engine — no year-end wipe."
        ),
    },
    {
        "id": "modern_entitlement",
        "route": "/allocation",
        "title": "Modern entitlement",
        "summary": (
            "Continuous accrual in the airfare cycle (default calendar 1 Jan–31 Dec; "
            "optional joining-date). Use Rates + Allocation. Period-end UI is removed."
        ),
    },
    {
        "id": "loans",
        "route": "/loans",
        "title": "Loans / EMI",
        "summary": (
            "Recover excess ticket cost: New loan, Pay, Settle, Defer, Return/Reopen, "
            "Monthly EMI run. Confirm dialogs on every mutation."
        ),
    },
    {
        "id": "offer_letters",
        "route": "/offer-letters",
        "title": "Offer Letters",
        "summary": "Compose offer letter vouchers with company letterhead/logo; Preview and Issue PDF.",
    },
    {
        "id": "contracts",
        "route": "/contracts",
        "title": "Employment Contracts",
        "summary": "Limited/unlimited contracts using the same document studio as offer letters.",
    },
    {
        "id": "ess",
        "route": "/ess",
        "title": "ESS Requests",
        "summary": (
            "Easy path: open ESS Requests → New request (employee, travel, notes) → "
            "Approve / Reject / Mark paid. Optional AI sentiment on notes."
        ),
    },
    {
        "id": "reports",
        "route": "/reports",
        "title": "Reports",
        "summary": (
            "Run catalog reports (payable, tickets, loans…) or Report Designer; "
            "Export PDF/Excel. Agent can draft a designer handoff from AI Insights."
        ),
    },
    {
        "id": "finance_gl",
        "route": "/finance",
        "title": "Finance Ledger",
        "summary": (
            "Easy path: open Finance Ledger → Seed COA (once) → Backfill if needed → "
            "view Trial balance → Export Excel or PDF. Currency BHD; journals auto-post "
            "from tickets and loans."
        ),
    },
    {
        "id": "lookups",
        "route": "/lookups",
        "title": "Lookups",
        "summary": "Maintain designations, nationalities, pay groups, departments, repair centers.",
    },
    {
        "id": "users",
        "route": "/users",
        "title": "Users & Access",
        "summary": "Create users, assign roles (admin/HR/finance/employee), unlock locked accounts.",
    },
    {
        "id": "settings",
        "route": "/settings",
        "title": "Settings",
        "summary": (
            "Company profile + logos (MSSQL) and rule engine (accrual, cycle calendar vs "
            "joining-date, caps). Save after edits."
        ),
    },
    {
        "id": "ai_insights",
        "route": "/ai-insights",
        "title": "AI Insights",
        "summary": (
            "Ask the Data Agent in TRUE MODE (facts only). Teach me everything, diagnostics, "
            "Smart baseline, Ollama polish, optional online research."
        ),
    },
    {
        "id": "audit",
        "route": "/audit",
        "title": "Audit Log",
        "summary": "Search append-only mutation trail; expand a row to see before/after payload.",
    },
    {
        "id": "entitlement_reconcile",
        "route": "/entitlement/reconcile",
        "title": "Ledger reconcile",
        "summary": "Advanced: pick fiscal year → Run reconciliation of expected vs current entitlement ledger.",
    },
    {
        "id": "entitlement_accounts",
        "route": "/entitlement/accounts",
        "title": "Ledger accounts",
        "summary": "Advanced: select employee/year → view opening, accruals, used, adjustments, history.",
    },
    {
        "id": "entitlement_rules",
        "route": "/entitlement/rules",
        "title": "Rules (legacy)",
        "summary": "Legacy grade×location matrix. Prefer Entitlement Rates (/rates) for new work.",
    },
    {
        "id": "entitlement_payroll",
        "route": "/entitlement/payroll-export",
        "title": "Payroll export",
        "summary": "Advanced: set payroll run + fiscal year → Export entitlement transactions to payroll log.",
    },
    {
        "id": "backups",
        "route": "/backups",
        "title": "Backup & Restore",
        "summary": (
            "Admin API: list/create/restore/delete DB backups via /v1/admin/backups*. "
            "UI page may be incomplete — use API or DBA process if nav link is empty."
        ),
    },
]

PRODUCT_CAPABILITIES: list[dict[str, Any]] = [
    {
        "id": "company_profile_crud",
        "area": "Settings / Company Profile",
        "module": "settings",
        "summary": (
            "Companies live in MSSQL dbo.companies. Admins list/create/edit/soft-delete "
            "and upload logos (VARBINARY). Offer letters use the selected company."
        ),
        "mssql": {
            "table": "companies",
            "columns": [
                "id",
                "code",
                "name",
                "currency",
                "cr_no",
                "address",
                "logo_data",
                "logo_content_type",
                "active",
                "deleted_at",
                "version",
            ],
            "notes": "logo_data VARBINARY(MAX) is source of truth; disk branding is PDF cache.",
            "soft_delete": True,
        },
        "apis": [
            "GET/POST /v1/companies",
            "PATCH/DELETE /v1/companies/{id}",
            "POST/GET/DELETE /v1/companies/{id}/logo",
        ],
        "rules": [
            "Application currency is BHD.",
            "Logo PNG/JPG/WebP ≤ 2 MB stored in MSSQL.",
            "Soft-delete blocked if last company or active employees still reference it.",
            "Business code freed on delete so it can be reused.",
        ],
        "research_notes": [
            "Microsoft: small BLOBs (<~1MB) fit VARBINARY(MAX) well.",
            "Master-data soft-delete with deleted_at + filtered live queries.",
        ],
        "keywords": [
            "company",
            "companies",
            "logo",
            "cr no",
            "cr_no",
            "letterhead",
            "branding",
            "delete company",
            "edit company",
            "company profile",
        ],
    },
    {
        "id": "currency_bhd",
        "area": "Finance / Currency",
        "module": "settings",
        "summary": "Atlas HCM standardizes on Bahraini Dinar (BHD) application-wide.",
        "mssql": {"table": "companies", "columns": ["currency"], "soft_delete": False},
        "apis": ["PATCH /v1/companies/{id}", "GET /v1/preferences"],
        "rules": [
            "UI formatters use en-BH with 3 decimal places.",
            "New companies default currency BHD; startup normalizes existing rows.",
        ],
        "keywords": ["bhd", "currency", "dinar", "bahrain"],
    },
    {
        "id": "finance_gl_ticket_loan",
        "area": "Finance / GL",
        "module": "finance_gl",
        "summary": (
            "Native MSSQL double-entry finance ledger for employee ticket issue and loan "
            "accounts. Seed COA, post balanced journals on ticket issue / loan disbursement / "
            "loan recovery, and read trial balance + ledger report. Research chose "
            "python-accounting patterns (IFRS/GAAP) without depending on that library — "
            "it does not officially support MSSQL."
        ),
        "mssql": {
            "table": "finance_journals",
            "columns": [
                "id",
                "company_id",
                "entry_date",
                "narration",
                "source_type",
                "source_id",
                "employee_id",
                "total_debit",
                "total_credit",
                "status",
            ],
            "related": ["finance_accounts", "finance_journal_lines"],
            "soft_delete": True,
        },
        "apis": [
            "GET /v1/finance/status",
            "POST /v1/finance/seed",
            "GET /v1/finance/accounts",
            "GET /v1/finance/trial-balance",
            "GET /v1/finance/ledger-report",
        ],
        "rules": [
            "Debits must equal credits on every journal.",
            "Ticket issue posts expense + loan receivable + cash.",
            "Loan recovery posts cash debit and loan receivable credit.",
            "GL posts use savepoints so ticket/loan saves never fail on GL errors.",
        ],
        "keywords": [
            "finance",
            "ledger",
            "gl",
            "trial balance",
            "chart of accounts",
            "journal",
            "ticket expense",
            "loan receivable",
            "accounting",
        ],
    },
    {
        "id": "documents_offer_contract",
        "area": "Offer Letters / Contracts",
        "module": "offer_letters",
        "summary": (
            "HR vouchers (offer letters, limited/unlimited contracts) in dbo.documents. "
            "Employee is optional (pre-hire). Letterhead uses company logo from MSSQL."
        ),
        "mssql": {
            "table": "documents",
            "columns": [
                "id",
                "voucher_no",
                "kind",
                "employee_id",
                "company_id",
                "template_key",
                "title",
                "status",
                "document_date",
                "joining_date",
                "net_amount",
                "params",
                "deleted_at",
            ],
            "soft_delete": True,
        },
        "apis": [
            "GET/POST /v1/documents",
            "GET/PUT /v1/documents/{id}",
            "POST /v1/documents/preview",
        ],
        "rules": [
            "Party fields can come from voucher form without Employee Master.",
            "Arabic reshaping + Traditional Arabic / Tahoma fonts for PDF.",
            "CR/address appear in footer when set on company.",
        ],
        "keywords": [
            "offer letter",
            "offer",
            "contract",
            "voucher",
            "document",
            "letterhead",
            "pdf",
            "joining date",
        ],
    },
    {
        "id": "employees_master",
        "area": "Employees",
        "module": "employees",
        "summary": "Employee master is the core HCM entity; soft-deleted via deleted_at.",
        "mssql": {
            "table": "employees",
            "columns": ["id", "code", "full_name", "company_id", "join_date", "deleted_at"],
            "soft_delete": True,
        },
        "apis": ["GET/POST /v1/employees", "PATCH/DELETE /v1/employees/{id}", "import endpoints"],
        "rules": [
            "Codes unique per company among live rows.",
            "Agent never returns password or raw PII dumps beyond schema-gated SQL.",
        ],
        "keywords": ["employee", "employees", "staff", "employee master", "cpr"],
    },
    {
        "id": "entitlement_rates",
        "area": "Rates / Entitlements",
        "module": "rates",
        "summary": "Scoped entitlement rates with effective dating; overlaps are diagnosable.",
        "mssql": {
            "table": "entitlement_rates",
            "columns": [
                "id",
                "scope_type",
                "scope_id",
                "amount",
                "effective_from",
                "effective_to",
                "cap_amount",
                "deleted_at",
            ],
            "soft_delete": True,
        },
        "apis": [
            "GET/POST /v1/entitlement-rates",
            "GET /v1/ai/employees/{id}/rate-recommendation",
        ],
        "rules": [
            "Overlapping rates are a whitelisted repair check.",
            "Amounts are BHD.",
        ],
        "keywords": ["rate", "rates", "entitlement", "cap", "airfare rate"],
    },
    {
        "id": "tickets_allocation",
        "area": "Tickets / Allocation",
        "module": "allocation",
        "summary": (
            "Ticket register tracks cost vs entitlement and excess handling. "
            "Origin/Destination use a worldwide IATA catalog (~9k airports from OurAirports). "
            "Ranking: text-match quality (Skyscanner/FareLens style), then India & Pakistan first, "
            "then hub size (large/medium/small). Linked recovery loans prompt Delete loan vs Keep "
            "on edit/delete (expense-claim parent/child confirm pattern)."
        ),
        "mssql": {
            "table": "tickets",
            "columns": [
                "id",
                "employee_id",
                "travel_date",
                "origin_code",
                "destination_code",
                "ticket_cost",
                "entitlement",
                "company_paid",
                "excess_handling",
                "status",
                "deleted_at",
            ],
            "soft_delete": True,
        },
        "apis": [
            "GET/POST /v1/tickets",
            "PUT /v1/tickets/{id}",
            "DELETE /v1/tickets/{id}",
            "POST /v1/allocations/issue",
            "POST /v1/allocations/print.pdf",
            "POST /v1/ai/anomalies",
            "POST /v1/ai/expense-anomaly",
        ],
        "rules": [
            "Anomaly scoring uses IsolationForest when available.",
            "UI airport search: atlas-next/lib/airports-data.ts (world IATA; IN/PK prioritized).",
            "If a ticket has a linked loan, edit/delete must ask Delete loan or Keep loan before save.",
            "Ticket edit auto-revises unpaid linked loans; payments block revise until reversed.",
            "Settled linked loans cannot be deleted until Loans → Reopen reverses settlement payments.",
            "Paid tickets remain editable/deletable with the same loan confirm gates.",
            "Settlement option ENTITLEMENT_AMOUNT is disabled/rejected when final_entitlement_amount <= 0 "
            "(cannot cap a ticket at zero — use Self paid, Fully company paid, or Make loan).",
            "Allocation print uses offer-letter HTML letterhead with MSSQL company logo; "
            "A4 PDF via Chromium (HarfBuzz Arabic). Browser preview must not duplicate ID/name values.",
            "POST /v1/allocations/print.pdf accepts ticket_id; settlement.option may be enum or str.",
        ],
        "keywords": [
            "ticket",
            "tickets",
            "allocation",
            "airfare",
            "travel",
            "excess",
            "entitlement amount",
            "settlement",
            "airport",
            "airports",
            "origin",
            "destination",
            "iata",
            "india airport",
            "pakistan airport",
            "delete loan",
            "linked loan",
        ],
    },
    {
        "id": "loans_emi",
        "area": "Loans / EMI",
        "module": "loans",
        "summary": (
            "Excess recovery loans with installment schedules and EMI risk scores. "
            "Lifecycle: create → pay/defer/settle → return/reopen. Settled loans can be "
            "reopened by reversing payments (Frappe/ERPNext cancel-repayment pattern)."
        ),
        "mssql": {
            "table": "loans",
            "columns": [
                "id",
                "employee_id",
                "outstanding",
                "status",
                "monthly_installment",
                "deleted_at",
            ],
            "soft_delete": True,
        },
        "apis": [
            "GET/POST /v1/loans",
            "POST /v1/loans/{id}/payments",
            "POST /v1/loans/{id}/defer",
            "POST /v1/loans/{id}/return",
            "POST /v1/loans/{id}/restructure",
            "POST /v1/loans/bulk-settle",
            "DELETE /v1/loans/{id}",
            "POST /v1/ai/emi-risk",
            "POST /v1/ai/loans/{id}/risk-score",
        ],
        "rules": [
            "Missing installment schedules are auto-repairable (whitelist).",
            "Agent drafts loan-outstanding / loan-statement report SQL.",
            "Every loan action requires UI confirmation (create, edit, pay, defer, settle, return, delete, EMI run).",
            "Return on deferred resumes active recovery; Return/Reopen on settled soft-deletes payments and restores principal outstanding.",
            "Restructure edits rate/EMI months/first due on outstanding (blocked while settled).",
            "Delete loan blocked while non-deleted payments exist.",
            "Compared with ERPNext HRMS: settle ≈ repayment submit; return settled ≈ cancel repayment then reopen.",
        ],
        "keywords": [
            "loan",
            "loans",
            "emi",
            "installment",
            "recovery",
            "outstanding",
            "settle",
            "settled",
            "defer",
            "return",
            "reopen",
            "restructure",
        ],
    },
    {
        "id": "opening_balances",
        "area": "Opening Balances",
        "module": "opening_balances",
        "summary": "Year opening days/amounts; orphans vs soft-deleted employees are flagged.",
        "mssql": {
            "table": "opening_balances",
            "columns": ["id", "employee_id", "balance_year", "opening_days", "opening_amount"],
            "soft_delete": True,
        },
        "apis": ["GET/POST /v1/opening-balances"],
        "rules": ["Orphan opening balances are a whitelisted repair."],
        "keywords": ["opening balance", "opening balances", "balance year"],
    },
    {
        "id": "ess_self_service",
        "area": "ESS Requests",
        "module": "ess",
        "summary": (
            "Easy way: open /ess → New request → pick employee, travel, notes → "
            "Submit → Approve / Reject / Mark paid. Optional sentiment on notes."
        ),
        "how_to": [
            "Open ESS Requests (/ess)",
            "Click New request; fill employee + travel + notes",
            "Approve, Reject, or Mark paid from the list",
            "Optional sentiment: POST /v1/ai/ess-sentiment",
        ],
        "mssql": {
            "table": "ess_requests",
            "columns": [
                "id",
                "employee_id",
                "request_type",
                "travel_date",
                "origin_code",
                "destination_code",
                "status",
                "notes",
                "deleted_at",
            ],
            "soft_delete": True,
        },
        "apis": ["GET/POST /v1/ess/requests", "POST /v1/ai/ess-sentiment"],
        "rules": [
            "Teach the /ess screen first; APIs are secondary.",
            "Sentiment uses transformers when installed, else keyword fallback.",
        ],
        "keywords": [
            "ess",
            "ess request",
            "ess requests",
            "self-service",
            "self service",
            "sentiment",
            "request",
            "approve request",
            "employee request",
        ],
    },
    {
        "id": "end_to_end_airfare",
        "area": "Whole process (airfare)",
        "module": "allocation",
        "summary": (
            "Full easy path: Employees → Opening Balances → Rates → Allocation "
            "(Calculate → settle excess → Issue) → Loans if needed → Finance Ledger → Reports."
        ),
        "how_to": [
            "1. Employees (/employees)",
            "2. Opening Balances (/opening-balances)",
            "3. Entitlement Rates (/rates) in BHD",
            "4. Airfare Allocation (/allocation): Calculate → settle → Issue",
            "5. Loans (/loans) if Convert to loan",
            "6. Finance Ledger (/finance): trial balance + Export Excel/PDF",
            "7. Reports (/reports) for payable / ticket / loan catalogs",
        ],
        "mssql": {
            "table": "tickets",
            "columns": ["id", "employee_id", "ticket_cost", "entitlement", "status"],
            "soft_delete": True,
        },
        "apis": [
            "POST /v1/allocations/preview",
            "POST /v1/allocations/issue",
            "GET /v1/finance/trial-balance",
        ],
        "rules": ["Currency is always BHD.", "TRUE MODE: screens before APIs."],
        "keywords": [
            "whole process",
            "end to end",
            "full process",
            "how does the system work",
            "learn all",
            "all modules",
            "workflow",
            "step by step",
            "step-by-step",
            "airfare process",
        ],
    },
    {
        "id": "entitlement_advanced",
        "area": "Advanced entitlement ledger",
        "module": "entitlement_reconcile",
        "summary": (
            "Advanced: reconcile (/entitlement/reconcile), accounts (/entitlement/accounts), "
            "legacy rules (/entitlement/rules), payroll export (/entitlement/payroll-export). "
            "Day-to-day stays on Rates + Allocation."
        ),
        "how_to": [
            "Day-to-day: /rates + /allocation",
            "Reconcile: /entitlement/reconcile",
            "Per-employee ledger: /entitlement/accounts",
            "Payroll batch: /entitlement/payroll-export",
        ],
        "mssql": {
            "table": "entitlement_rates",
            "columns": ["id", "scope_type", "amount", "effective_from"],
            "soft_delete": True,
        },
        "apis": [
            "GET /v1/entitlement/reconcile",
            "POST /v1/entitlement/export-payroll",
        ],
        "rules": ["Prefer Rates + Allocation for normal HR work."],
        "keywords": [
            "reconcile",
            "ledger accounts",
            "payroll export",
            "entitlement rules",
            "advanced entitlement",
        ],
    },
    {
        "id": "reports_designer",
        "area": "Reports",
        "module": "reports",
        "summary": "Agent drafts Report Designer payloads with schema-gated SQL — no app code.",
        "mssql": {
            "table": "report_templates",
            "columns": ["id", "code", "title", "dataset", "definition", "deleted_at"],
            "soft_delete": True,
        },
        "apis": ["GET /v1/report-templates", "POST /v1/ai/agent/chat (draft_report)"],
        "rules": [
            "Datasets: employee-master, opening-balances, entitlements, ticket-register, "
            "loan-outstanding, loan-statement, liability-projections, excess-recovery.",
        ],
        "keywords": ["report", "reports", "designer", "draft a report", "dataset"],
    },
    {
        "id": "lookups_users",
        "area": "Lookups / Users",
        "module": "lookups",
        "summary": "Reference lookups and auth users; locked users are diagnosable.",
        "mssql": {
            "table": "users",
            "columns": ["id", "username", "employee_id", "locked_until", "deleted_at"],
            "soft_delete": True,
        },
        "apis": ["GET /v1/lookups/{type}", "GET /v1/users", "support diagnose locked_users"],
        "rules": ["Never SELECT password_hash in agent SQL."],
        "keywords": ["lookup", "lookups", "user", "users", "locked", "unlock"],
    },
    {
        "id": "ui_arabic_locale",
        "area": "UI / Language",
        "module": "settings",
        "summary": (
            "EN | ع switcher on login and sidebar footer. Arabic enables RTL (dir=rtl) and "
            "Noto Sans Arabic; preference saved as atlas.locale. Shell/nav/login translate first."
        ),
        "mssql": {"table": "n/a", "columns": [], "soft_delete": False},
        "apis": [],
        "rules": [
            "No /ar route prefix — client locale store only.",
            "Documents/PDFs already support bilingual Arabic independently of UI locale.",
        ],
        "keywords": [
            "arabic",
            "language",
            "locale",
            "rtl",
            "عربية",
            "لغة",
            "switch language",
            "english arabic",
        ],
    },
    {
        "id": "ai_data_agent",
        "area": "AI Data Agent",
        "module": "ai_insights",
        "summary": (
            "Local/privacy-first schema-gated agent: Think → Plan → Act. "
            "MSSQL diagnostics, whitelisted repairs, forecasts, anomalies, product knowledge. "
            "No cloud exfiltration of your DB; all SQL runs against HCM_Airfare_Management."
        ),
        "mssql": {
            "table": "ai_learning_events",
            "columns": ["id", "event_type", "check_code", "outcome", "confidence"],
            "soft_delete": False,
        },
        "apis": [
            "POST /v1/ai/agent/chat",
            "GET /v1/ai/agent/schema",
            "GET /v1/ai/support/learning",
            "POST /v1/ai/support/train",
            "POST /v1/ai/saa/baseline",
        ],
        "rules": [
            "Think-before-action: planner emits steps before any repair or write-like path.",
            "Refuse bulk 'fix everything'; require Auto-Repair + APPLY per whitelist item.",
            "Read-only SQL unless whitelisted repair with human confirm.",
        ],
        "research_notes": [
            "OpenCode: privacy-first local agent; multi-session / tool schema pattern.",
            "Microsoft ai-agents-for-beginners: Planning + Tool Use design patterns.",
            "Reason-Plan-ReAct / HTN: separate planning from execution for enterprise reliability.",
        ],
        "keywords": [
            "ai agent",
            "data agent",
            "what can you do",
            "capabilities",
            "modules",
            "help",
            "think",
            "plan",
            "saa",
            "baseline",
            "smart agent",
            "learn all",
            "teach me",
            "teach everything",
        ],
    },
]


def match_capabilities(message: str) -> list[dict[str, Any]]:
    lowered = message.casefold()
    hits: list[dict[str, Any]] = []
    for cap in PRODUCT_CAPABILITIES:
        if any(k in lowered for k in cap.get("keywords") or []):
            hits.append(cap)
    return hits


def list_modules_reply() -> str:
    lines = [
        f"- **{m['title']}** (`{m['route']}`): {m['summary']}" for m in MODULE_CATALOG
    ]
    return (
        f"Atlas HCM modules (knowledge `{KNOWLEDGE_VERSION}`):\n"
        + "\n".join(lines)
        + "\n\nAsk about any module for the easy screen path (e.g. ESS, Finance Ledger, Allocation)."
    )


def capability_reply(caps: list[dict[str, Any]]) -> str:
    if not caps:
        return ""
    parts: list[str] = []
    for cap in caps:
        how = cap.get("how_to") or []
        how_txt = (" Easy steps: " + " → ".join(str(s) for s in how) + ".") if how else ""
        rules = "; ".join(cap.get("rules") or [])
        table = (cap.get("mssql") or {}).get("table", "?")
        apis = ", ".join(cap.get("apis") or [])
        parts.append(
            f"**{cap['area']}** — {cap['summary']}{how_txt} "
            f"Screen/module: `{cap.get('module') or ''}`. "
            f"MSSQL `{table}`. APIs (advanced): {apis}. Rules: {rules}"
        )
    return "\n\n".join(parts)


def as_public_capabilities() -> dict[str, Any]:
    return {
        "knowledge_version": KNOWLEDGE_VERSION,
        "modules": MODULE_CATALOG,
        "capabilities": [
            {
                "id": c["id"],
                "area": c["area"],
                "module": c.get("module"),
                "summary": c["summary"],
                "mssql": c["mssql"],
                "apis": c["apis"],
                "rules": c["rules"],
            }
            for c in PRODUCT_CAPABILITIES
        ],
        "agent_principles": [
            "privacy_first_local_mssql",
            "think_before_action",
            "schema_gated_sql",
            "human_gated_repairs",
            "learn_into_ai_learning_events",
            "bm25_local_knowledge_brain",
            "optional_online_research_cited",
            "optional_ollama_local_llm",
            "optional_deepseek_openai_compatible_api",
            "local_ml_sklearn_fallbacks",
        ],
    }


def ensure_product_knowledge_learned(session: Session, *, actor: str | None = "system") -> int:
    """Idempotently upsert product capabilities into ai_learning_events."""
    touched = 0
    for cap in PRODUCT_CAPABILITIES:
        check_code = f"product:{cap['id']}"
        existing = session.scalar(
            select(AiLearningEventRow)
            .where(
                AiLearningEventRow.check_code == check_code,
                AiLearningEventRow.event_type == "product_knowledge",
            )
            .limit(1)
        )
        details = {
            "knowledge_version": KNOWLEDGE_VERSION,
            "area": cap["area"],
            "module": cap.get("module"),
            "mssql": cap["mssql"],
            "apis": cap["apis"],
            "rules": cap["rules"],
            "research_notes": cap.get("research_notes") or [],
        }
        if existing is None:
            session.add(
                AiLearningEventRow(
                    id=str(uuid4()),
                    event_type="product_knowledge",
                    check_code=check_code,
                    severity="info",
                    summary=cap["summary"][:2000],
                    details=details,
                    fix_applied=None,
                    outcome="success",
                    confidence=0.95,
                    created_by=actor,
                )
            )
            touched += 1
            continue
        prior = existing.details if isinstance(existing.details, dict) else {}
        if prior.get("knowledge_version") != KNOWLEDGE_VERSION:
            existing.summary = cap["summary"][:2000]
            existing.details = details
            existing.outcome = "success"
            existing.confidence = 0.95
            touched += 1
    # Module catalog snapshot
    mod_code = "product:module_catalog"
    mod = session.scalar(
        select(AiLearningEventRow)
        .where(
            AiLearningEventRow.check_code == mod_code,
            AiLearningEventRow.event_type == "product_knowledge",
        )
        .limit(1)
    )
    mod_details = {
        "knowledge_version": KNOWLEDGE_VERSION,
        "modules": MODULE_CATALOG,
    }
    if mod is None:
        session.add(
            AiLearningEventRow(
                id=str(uuid4()),
                event_type="product_knowledge",
                check_code=mod_code,
                severity="info",
                summary=f"Atlas HCM module catalog ({len(MODULE_CATALOG)} modules).",
                details=mod_details,
                outcome="success",
                confidence=0.95,
                created_by=actor,
            )
        )
        touched += 1
    elif (mod.details or {}).get("knowledge_version") != KNOWLEDGE_VERSION:
        mod.summary = f"Atlas HCM module catalog ({len(MODULE_CATALOG)} modules)."
        mod.details = mod_details
        touched += 1
    if touched:
        session.flush()
    return touched
