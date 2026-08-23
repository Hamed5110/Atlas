# Disaster recovery runbook

## Logical JSON backup (portable)

1. Sign in as admin at `http://127.0.0.1:3389`.
2. Open **Administration → Backup & Restore**.
3. Create **Logical JSON** backup; note `file_name` and SHA-256 in the catalog.
4. Copy the file from `AIRFARE_BACKUP_ROOT` (default `./var/backups`) to off-host storage.

### Restore

1. Stop write traffic (scale API to 0 or enable maintenance banner).
2. POST `/v1/admin/backups/restore` with `{ "file_name": "...", "confirm": "RESTORE_CONFIRM" }`.
3. Verify employee/ticket/loan counts in the UI.
4. Run `GET /health/ready` — database must be `ok`.

## Native SQL Server `.bak`

1. Ensure `AIRFARE_DATABASE_URL` (or `AIRFARE_DB_USER` / `AIRFARE_DB_PASSWORD`) has backup privileges.
2. Create native backup from the admin UI or `create_native_mssql_backup`.
3. Confirm `RESTORE VERIFYONLY` succeeded (logged in backup metadata).

### Restore

1. Put database in single-user mode (script handles `ALTER DATABASE … SINGLE_USER`).
2. POST restore with `.bak` file name.
3. Run `RESTORE VERIFYONLY` on a staging copy before production cutover.

## Rollback

If restore fails mid-flight:

1. Do **not** restart API against a half-restored database.
2. Restore the previous known-good `.bak` or logical JSON.
3. Re-run Alembic `upgrade head` only after a clean restore.
4. Document incident in audit log export.
