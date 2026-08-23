"""Report-related API types."""

from typing import Literal

ReportName = Literal[
    "employee-master",
    "opening-balances",
    "entitlements",
    "entitlement-balance-summary",
    "ticket-register",
    "booking-register",
    "loan-outstanding",
    "loan-statement",
    "loan-recovery-ledger",
    "liability-projections",
    "excess-recovery",
]

MssqlReportName = Literal[
    "employee_summary",
    "ticket_ledger",
    "loan_portfolio",
    "monthly_spend",
    "excess_recovery",
    "preference_audit",
    "ess_request_tracker",
    "ai_anomaly_flags",
]
