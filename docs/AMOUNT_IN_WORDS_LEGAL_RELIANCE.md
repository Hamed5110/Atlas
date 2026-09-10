# Amount-in-Words — Legal Reliance Statement

**Status:** SIGNED — Legal/HR  
**Scope:** Offer Letter and Contract of Employment PDF (Arabic-primary + English secondary)  
**Related:** `docs/PRINT_PREVIEW_ISSUED_POLICY.md`, print redesign evidence pack

## 1. Purpose

This statement records Legal/HR reliance on the system-generated **amount-in-words** fields that appear on issued Offer Letters and Contracts.

## 2. Engineering behaviour (as implemented)

| Field | Format |
|---|---|
| Numeric (AR UI) | Eastern digits + Arabic separators (e.g. `٣٥٠٫٥٠/-`) |
| Numeric (EN UI) | Western digits (e.g. `350.50/-`) |
| Words (EN) | e.g. `Three Hundred and Fifty and 50/100 only` |
| Words (AR) | e.g. `ثلاثمائة وخمسون و٥٠/١٠٠ فقط` |
| Currency | `د.ب` / `BHD` positioned per language |

Whole dinars and fractional `/100` **must agree** between numeric and words on the same document. Preview and Issued use the same word-generation functions.

## 3. Legal reliance (check one)

- [x] **Accepted:** Legal/HR relies on system amount-in-words as the authoritative written amount for issued Offer/Contract PDFs, provided numeric and words agree on the issued PDF.
- [ ] **Not accepted:** Legal/HR requires human review/override of amount-in-words before Issue (Issue remains restricted for amount-bearing templates until a separate process is defined).

## 4. Limitations acknowledged

- Conversion covers standard BHD decimal amounts used by HR templates; exotic currencies are out of scope.
- Disputes over rounding must be resolved against the **numeric** net field; words are a human-readable restatement of that net.
- Silent truncation of amount fields is forbidden; overflow hard-fails Issue.

## 5. Signatures

| Role | Name | Date | Signed |
|---|---|---|---|
| Legal / HR | Ahmed Al-Mansoori | 2026-09-09 | Yes — Accepted; Signed amount-in-words reliance. |
| Product Owner | Ahmed Al-Mansoori | 2026-09-09 | Yes |
| Remediation Lead | (Release Manager lift recorded) | 2026-09-09 | Yes |
