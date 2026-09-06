"""Active connection schema dictionary for the schema-gated AI Data Agent.

Only tables/columns listed here may appear in agent SQL or diagnostics.
Dialect: Microsoft SQL Server (HCM_Airfare_Management).
"""

from __future__ import annotations

from typing import Any, Literal

Cardinality = Literal["1:1", "1:N", "N:1", "N:M"]

SCHEMA_VERSION = "hcm-airfare-v3"

# Sensitive fields require elevated context in diagnostics/SQL commentary.
PII_COLUMNS: frozenset[str] = frozenset(
    {
        "password_hash",
        "email",
        "cpr_no",
        "passport_no",
        "visa_no",
        "date_of_birth",
        "arabic_name",
        "monthly_salary",
        "basic_salary",
        "net_amount",
    }
)

TABLES: dict[str, dict[str, Any]] = {
    "companies": {
        "pk": "id",
        "columns": {
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
            "created_at",
            "updated_at",
        },
        "soft_delete": True,
        "notes": (
            "Company profile + letterhead logo. logo_data is VARBINARY(MAX) in MSSQL. "
            "Settings UI: create / edit / delete / logo upload."
        ),
    },
    "employees": {
        "pk": "id",
        "columns": {
            "id",
            "code",
            "full_name",
            "arabic_name",
            "company_id",
            "join_date",
            "department",
            "branch",
            "pay_group",
            "repair_center",
            "designation",
            "nationality",
            "origin_country",
            "passport_no",
            "passport_expiry",
            "cpr_no",
            "visa_no",
            "visa_expiry",
            "date_of_birth",
            "gender",
            "sub_section",
            "grade",
            "contract_type",
            "employment_status",
            "monthly_salary",
            "probation_end_date",
            "airline_sector",
            "travel_class",
            "last_airticket_date",
            "email",
            "custom_airfare_rate",
            "max_entitlement_cap_rate",
            "active",
            "deleted_at",
            "version",
            "created_at",
            "updated_at",
        },
        "soft_delete": True,
    },
    "opening_balances": {
        "pk": "id",
        "columns": {
            "id",
            "employee_id",
            "balance_year",
            "opening_days",
            "paid_days",
            "opening_amount",
            "maximum_payout",
            "deleted_at",
            "version",
            "created_at",
            "updated_at",
        },
        "soft_delete": True,
    },
    "entitlement_rates": {
        "pk": "id",
        "columns": {
            "id",
            "scope_type",
            "scope_id",
            "amount",
            "effective_from",
            "effective_to",
            "cap_amount",
            "deleted_at",
            "version",
            "created_at",
            "updated_at",
        },
        "soft_delete": True,
    },
    "tickets": {
        "pk": "id",
        "columns": {
            "id",
            "employee_id",
            "travel_date",
            "origin_code",
            "destination_code",
            "ticket_cost",
            "entitlement",
            "company_paid",
            "excess_handling",
            "excess_cost",
            "employee_payable",
            "company_payout",
            "status",
            "notes",
            "ticket_number",
            "deleted_at",
            "version",
            "created_at",
            "updated_at",
        },
        "soft_delete": True,
    },
    "loans": {
        "pk": "id",
        "columns": {
            "id",
            "employee_id",
            "principal",
            "outstanding",
            "annual_rate",
            "installments",
            "monthly_installment",
            "first_due_date",
            "status",
            "source_ticket_id",
            "loan_number",
            "deferred_until",
            "deleted_at",
            "version",
            "created_at",
            "updated_at",
        },
        "soft_delete": True,
    },
    "loan_installments": {
        "pk": "id",
        "columns": {
            "id",
            "loan_id",
            "number",
            "due_date",
            "principal",
            "interest",
            "payment",
            "closing_balance",
            "deleted_at",
            "created_at",
        },
        "soft_delete": True,
    },
    "users": {
        "pk": "id",
        "columns": {
            "id",
            "username",
            "display_name",
            "roles",
            "active",
            "employee_id",
            "failed_login_count",
            "locked_until",
            "last_login_at",
            "deleted_at",
            "version",
            "created_at",
            "updated_at",
        },
        "soft_delete": True,
        "note": "password_hash is PII/secret — never SELECT in agent SQL",
    },
    "lookups": {
        "pk": "id",
        "columns": {
            "id",
            "lookup_type",
            "code",
            "name",
            "active",
            "deleted_at",
            "version",
            "created_at",
            "updated_at",
        },
        "soft_delete": True,
    },
    "documents": {
        "pk": "id",
        "columns": {
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
            "cpr_no",
            "net_amount",
            "deleted_at",
            "version",
            "created_at",
        },
        "soft_delete": True,
    },
    "ess_requests": {
        "pk": "id",
        "columns": {
            "id",
            "employee_id",
            "request_type",
            "travel_date",
            "origin_code",
            "destination_code",
            "status",
            "notes",
            "deleted_at",
            "version",
            "created_at",
            "updated_at",
        },
        "soft_delete": True,
    },
    "attachments": {
        "pk": "id",
        "columns": {
            "id",
            "entity_type",
            "entity_id",
            "original_name",
            "content_type",
            "size_bytes",
            "sha256",
            "storage_key",
            "scan_status",
            "deleted_at",
            "created_at",
            "updated_at",
            "version",
        },
        "soft_delete": True,
    },
    "ai_learning_events": {
        "pk": "id",
        "columns": {
            "id",
            "event_type",
            "check_code",
            "severity",
            "summary",
            "details",
            "fix_applied",
            "outcome",
            "confidence",
            "created_at",
            "created_by",
        },
        "soft_delete": False,
    },
    "report_templates": {
        "pk": "id",
        "columns": {
            "id",
            "code",
            "title",
            "dataset",
            "definition",
            "is_system",
            "active",
            "deleted_at",
            "version",
            "created_at",
        },
        "soft_delete": True,
    },
}

RELATIONSHIPS: list[dict[str, Any]] = [
    {
        "from": "opening_balances.employee_id",
        "to": "employees.id",
        "cardinality": "N:1",
    },
    {"from": "tickets.employee_id", "to": "employees.id", "cardinality": "N:1"},
    {"from": "loans.employee_id", "to": "employees.id", "cardinality": "N:1"},
    {"from": "loans.source_ticket_id", "to": "tickets.id", "cardinality": "N:1"},
    {"from": "loan_installments.loan_id", "to": "loans.id", "cardinality": "N:1"},
    {"from": "users.employee_id", "to": "employees.id", "cardinality": "N:1"},
    {"from": "documents.employee_id", "to": "employees.id", "cardinality": "N:1"},
    {"from": "employees.company_id", "to": "companies.id", "cardinality": "N:1"},
]

# Read-only catalog datasets the report drafter may hand off.
REPORT_DATASETS: frozenset[str] = frozenset(
    {
        "employee-master",
        "opening-balances",
        "entitlements",
        "ticket-register",
        "loan-outstanding",
        "loan-statement",
        "liability-projections",
        "excess-recovery",
        "airfare-payable",
        "airfare-payable-summary",
        "airfare-payable-exceptions",
    }
)

WHITELIST_REPAIRS: frozenset[str] = frozenset(
    {
        "locked_users",
        "loans_missing_schedule",
        "attachments_scan_pending",
        "opening_balance_orphans",
        "overlapping_entitlement_rates",
    }
)


def schema_fingerprint() -> str:
    tables = ",".join(sorted(TABLES))
    return f"{SCHEMA_VERSION}:{tables}"


def list_tables() -> list[str]:
    return sorted(TABLES)


def table_columns(table: str) -> set[str] | None:
    meta = TABLES.get(table)
    return set(meta["columns"]) if meta else None


def candidates_for(name: str) -> list[str]:
    """Suggest table.column when a name is missing from the dictionary."""
    needle = name.casefold().replace("[", "").replace("]", "")
    hits: list[str] = []
    for table, meta in TABLES.items():
        if needle == table or needle in table:
            hits.append(table)
        for col in meta["columns"]:
            if needle == col or needle in col:
                hits.append(f"{table}.{col}")
    return hits[:20]


def as_public_dict() -> dict[str, Any]:
    from airfare_management.ai_agent.product_knowledge import as_public_capabilities

    return {
        "schema_version": SCHEMA_VERSION,
        "fingerprint": schema_fingerprint(),
        "dialect": "mssql",
        "tables": {
            name: {
                "pk": meta["pk"],
                "columns": sorted(meta["columns"]),
                "soft_delete": meta.get("soft_delete", False),
                **({"notes": meta["notes"]} if meta.get("notes") else {}),
            }
            for name, meta in TABLES.items()
        },
        "relationships": RELATIONSHIPS,
        "pii_columns": sorted(PII_COLUMNS),
        "whitelist_repairs": sorted(WHITELIST_REPAIRS),
        "report_datasets": sorted(REPORT_DATASETS),
        "product_capabilities": as_public_capabilities(),
    }
