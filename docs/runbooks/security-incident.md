# Security incident runbook

## JWT secret compromise

1. Rotate `AIRFARE_JWT_SECRET` to a new 32+ character value in secrets manager.
2. Restart all API containers/processes simultaneously.
3. Revoke all refresh tokens:
   ```sql
   UPDATE refresh_tokens SET revoked_at = SYSUTCDATETIME() WHERE revoked_at IS NULL;
   ```
4. Force password reset for privileged roles (`SYSTEM_ADMIN`, `FINANCE_MANAGER`).
5. Review audit metadata for anomalous `actor_id` / IP ranges.

## Password breach (bootstrap or user dump)

1. Disable affected accounts (`active = 0`).
2. Trigger `/v1/auth/change-password` campaign or admin-initiated reset.
3. Enforce password history (last 5 hashes) on next login.
4. Clear failed-login counters and lockouts after verified reset.

## Audit log extraction

Query append-only audit rows by date range:

```sql
SELECT *
FROM audit_metadata
WHERE created_at >= @from AND created_at < @to
ORDER BY created_at;
```

Export to CSV for SOC review. Correlate with `X-Correlation-ID` from API access logs (`structlog` JSON in production).

## Attachment malware suspicion

1. Quarantine `AIRFARE_ATTACHMENT_ROOT` subfolder for the entity.
2. Mark attachment `scan_status = rejected` (do not serve download).
3. Re-scan with customer AV before clearing `pending`.
