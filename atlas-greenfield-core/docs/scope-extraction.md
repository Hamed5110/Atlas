# ATLAS Greenfield Scope Extraction

STATUS: YELLOW — requirements extracted from business behavior and failure history; live user acceptance still required.

ACTION: Build a null-state ATLAS core with Employees first. Old implementation is contrast only.

## Core entity

Employee is the foundation record. Every operational domain must reference a valid employee identity scoped by tenant and company.

Required associated domains:

- Companies and tenant database routing.
- Employee master identity and employment status.
- Continuous airfare entitlement rules and history.
- Company allocation and usage events.
- Opening seed evidence for imported balances.
- Loan and EMI recovery.
- Airfare calculation policy.
- Period closing snapshots without batch reset behavior.

## Old behavior vs correct behavior

| Domain | Old system behavior observed from history | Correct greenfield behavior |
| --- | --- | --- |
| Employees | Employee state mixed with many screens and formulas. | Employee master is independent, validated, tenant-scoped, company-scoped, and audit-ready. |
| Entitlement | Annual/reset concepts leaked into UI and migrations. | Continuous rule + event history computes balance as of a date. |
| Opening balances | Treated like operational workflow. | Treated as seed evidence only. |
| Loans/EMI | Operational dependency could block deletes without clear ownership. | Loan ledger references employee identity and exposes explicit recovery state. |
| Multi-company | Company switching and database naming were bolted onto installer/runtime. | Tenant, company, and database routing exist in schema from row one. |
| Install/runtime | Installer could create files without creating all required DB objects. | Runtime must refuse “healthy” unless core schema contract is present. |
| UI | Monolithic dashboard carried unrelated state and conflicting labels. | Separate module screens, Employees first. |

## Non-negotiable greenfield rules

1. No dependency on old `server.js`.
2. No dependency on old `atlas-hcm-next`.
3. No reused old database names as defaults.
4. No hidden batch reset process.
5. Every API date parameter is explicit and `YYYY-MM-DD`.
6. Tenant and company scope are mandatory on employee writes.
7. Tests validate requirements, not implementation details.

RED TEAM: The main failure risk is rebuilding a nicer facade over old coupling. Mitigation: the first executable slice has its own schema, API, UI, and tests.

HISTORY GIT REF: Prior commits repeatedly removed annual-close labels and fixed installer database mismatch. Those are treated as failure patterns to prevent.
