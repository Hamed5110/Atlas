# Stuck-Voucher Rollback Runbook (Draft — Ops executable)

**Directive refs:** Sprint-critical #2 · Pillar 4 · Surface A/H  
**Audience:** Ops Lead (no developer required)  
**Status:** APPROVED — Product Owner (Ahmed Al-Mansoori, 2026-09-09)  

## Goal

If a voucher number is reserved but PDF bytes are missing or incomplete, operators must detect a **stuck** state and either complete or retire the voucher without minting a duplicate official number.

## Detect stuck

A document is **stuck** when ANY of:

1. Status is not a clear “issued with file” state AND no PDF file exists on disk for that document id.  
2. Status claims issued / downloadable BUT PDF download returns not-found / empty.  
3. Audit/correlation shows voucher allocated, then render or stamp stage failed.

Record: voucher_no, document id, company id, kind (offer/contract), last stage (reserve / render / stamp / store).

## Compensating actions (choose one)

### A — Retry same voucher (preferred when failure was infrastructure)

1. Confirm no second voucher was created for the same business intent.  
2. Re-run Issue/regenerate **for the same document id** (idempotent path).  
3. Verify PDF downloads and page bottoms clear the footer band.  
4. Confirm logs show a single clean completion event (no CR/LF forged lines).

### B — Retire stuck voucher (when data was wrong / cannot complete)

1. Mark voucher **void / failed** in UI or admin procedure (do not delete history).  
2. Do **not** reuse the same voucher_no for a different company or employee.  
3. Open a **new** Issue only as an explicit new business intent.  
4. Notify HR that the voided number is not legally issued.

## Do not

- Blindly click Issue again expecting a new number for the “same” failed click without checking stuck state.  
- Change company on regenerate to “fix branding.”  
- Delete audit rows.

## Sign-off

| Role | Name | Date | Approved |
|---|---|---|---|
| Ops Lead | Ahmed Al-Mansoori | 2026-09-09 | Yes |
| Product Owner | Ahmed Al-Mansoori | 2026-09-09 | Yes — Approved stuck-voucher runbook. |
| Remediation Lead | (Release Manager lift) | 2026-09-09 | Yes |
