# ADR 001: Soft-delete partial unique indexes

## Status

Accepted (2026-08-22)

## Context

Operational tables (`opening_balances`, `loan_installments`, `preferences`, `lookups`) use soft-delete via `deleted_at`. Plain `UNIQUE` constraints on business keys block recreating a row after soft-delete, which breaks normal HR workflows (e.g. re-import opening balance for the same employee/year).

Both Microsoft SQL Server and SQLite support filtered/partial unique indexes.

## Decision

Replace composite unique constraints with filtered unique indexes:

```sql
CREATE UNIQUE INDEX uq_opening_balances_active
  ON opening_balances (employee_id, balance_year)
  WHERE deleted_at IS NULL;
```

Alembic migration `0009_soft_delete_unique` applies the change.

## Consequences

- Soft-deleted rows no longer participate in uniqueness checks; active duplicates remain impossible.
- Requires migration on every environment before deploy.
- ORM `UniqueConstraint` definitions removed from SQLAlchemy models; indexes managed in migrations.
