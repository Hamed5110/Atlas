# Architecture and engineering decisions

## Boundaries

The canonical implementation follows Clean Architecture: `domain` contains Decimal-only
business rules and entities; `application` defines CQRS handlers and repository/unit-of-
work ports; `infrastructure` owns SQLAlchemy, pyodbc, bcrypt and JWT; `api` and `desktop`
are transport adapters. Dependencies point inward. FastAPI composition is the DI root.

The existing ATLAS rule is retained deliberately: a 360-day year accrues 2.5 entitlement
days per 30 working days, a 60-day cycle caps balance, and payable equals policy maximum
times remaining/cycle days. The 30/360 calculation normalizes month-end dates to day 30.
This is an employer entitlement rule, distinct from India tax-law LTA eligibility.

## Preference inheritance

Research supports deterministic cascading configuration in which local settings override
less-specific defaults and an unspecified value inherits. ObjectStack documents explicit
precedence and deep merge for objects with replacement for primitives [1]. The enterprise
implementation therefore resolves: product default → company → branch → department →
user. Only explicitly stored keys override. Objects deep-merge, arrays and primitives
replace, and `null` means inherit. Security controls are not user preferences; server
policy remains authoritative.

## Conditional row formatting

Qt recommends `QStyledItemDelegate` as the style-aware customization base [2], while the
standard delegate already consumes model item roles. Simple warnings therefore come from
the table model's `BackgroundRole`; custom delegate painting is reserved for multi-part
cells. This preserves selection, accessibility, sorting, and theme behavior and avoids
widget-per-cell performance costs.

## Leave-travel edge cases

India Section 10(5) tax exemption is a separate, configurable compliance policy. Current
guidance limits exemption to actual domestic transport cost on the shortest route, caps
eligible fare class, allows two journeys per four-calendar-year block, and permits one
unused journey in the first year of the next block [3]. It excludes lodging, food,
sightseeing, and international legs. The system records actual cost, policy entitlement,
route evidence, travelers, tax regime, and block/carry-forward metadata independently.
It never silently treats employer reimbursement as tax-exempt; tax decisions require an
effective-dated jurisdiction rule and approval evidence.

Other decisions: joining after the cut-off accrues zero; prior allocation resumes on the
next calendar date; negative balances and payouts are rejected; over-policy company
payment becomes recoverable excess; money rounds `ROUND_HALF_UP` only at currency
boundaries; and all timestamps are UTC-aware. Leap years do not alter the contractual
30/360 accrual.

## MSSQL integrity, audit, indexing, and recovery

Critical operational tables use foreign keys, checks, filtered unique indexes over active
rows, soft deletion, and integer optimistic versions. Application audit rows capture
actor and correlation metadata; SQL Server system-versioned temporal tables preserve
row history. Microsoft recommends a rowstore history index for point-record audits and
columnstore for aggregate historical analysis [4][5]. This design uses `(ValidTo,
ValidFrom, Id)` rowstore indexes and proposes monthly partitioning only after history
volume justifies its operational cost. Temporal period columns are `datetime2` and hidden.

Backups are operational controls, not application endpoints: encrypted weekly full,
daily differential, and 5–15 minute log backups according to RPO; checksum, retention,
off-host immutable copies, and scheduled restore verification are mandatory. `DBCC
CHECKDB`, index/statistics maintenance based on measured fragmentation, least-privilege
service identities, and Query Store monitoring are deployment runbook requirements.
Partition switching is reserved for high-volume audit/history retention; Microsoft
documents partition-based sliding-window retention for temporal history [6].

## Security and operations

Access tokens are short-lived HS256 JWTs with issuer, subject, issued-at, expiry, and
roles; production secrets must be at least 256 random bits and rotated. Passwords use
bcrypt. Mutations authorize roles server-side. Attachments are content-addressed outside
the web root, size/type checked, malware scanned by the deployment integration, and
downloaded only after record-level authorization. Logs avoid payloads and PII, return a
correlation ID, and expose stable structured errors.

Alembic owns schema evolution; raw DDL documents SQL Server-only features. Migrations run
as a deployment identity, while runtime credentials have only required DML/execute rights.
No application feature initiates or downloads database backups.

## Sources

1. ObjectStack, “Configuration Resolution”: https://protocol.objectstack.ai/docs/protocol/objectos/config-resolution
2. Qt, “QStyledItemDelegate Class”: https://doc.qt.io/qt-6/qstyleditemdelegate.html
3. Income-tax Act Section 10(5) overview and Rule 2B constraints:
   https://www.bajajfinserv.in/investments/section-10-5-of-the-income-tax-act
4. Microsoft, “Temporal table usage scenarios”:
   https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal-table-usage-scenarios
5. Microsoft, “Create a system-versioned temporal table”:
   https://learn.microsoft.com/en-us/sql/relational-databases/tables/creating-a-system-versioned-temporal-table
6. Microsoft, “Manage retention of historical data”:
   https://learn.microsoft.com/en-us/sql/relational-databases/tables/manage-retention-of-historical-data-in-system-versioned-temporal-tables
