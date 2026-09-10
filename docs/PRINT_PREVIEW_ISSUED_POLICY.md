# Print Preview ≡ Issued Policy

**Status:** SIGNED — Product Owner  
**Document primary language:** Arabic (RTL). English is secondary.

## Page labels
- **Issued PDF:** `صفحة N من M` with Eastern Arabic digits (٠١٢…).
- **HTML preview:** Shows format sample `صفحة ٠ من ٠` (actual N/M assigned only when multipage PDF is stamped).
- **Intentional difference:** Preview cannot know final page count until Chromium pagination completes; format (language + digit shape) is identical. Product acknowledges this as the only allowed preview≠issued gap for page **numbers**, not format.

## Dates
- Arabic primary fields: Eastern `dd/mm/yyyy` (day first).
- English secondary: `dd/MonthName/yyyy` (unambiguous month name — never bare MM/DD/YYYY).

## Amounts
- Arabic cells: Eastern digits + Arabic decimal/thousands separators.
- English cells: Western digits.
- Amount-in-words EN/AR must agree on whole + fractional `/100`.

## Footer address/CR
- Wrap up to 2 lines within the stamp band.
- If address+CR exceeds capacity (160 chars): Issue **hard-fails** (`footer_overflow`) — no silent truncation.

## Signatures
| Role | Name | Date | Signed |
|---|---|---|---|
| Product Owner | Ahmed Al-Mansoori | 2026-09-09 | Yes — Signed preview=issued policy. |
| Legal / HR | Ahmed Al-Mansoori | 2026-09-09 | Acknowledged with amount-in-words pack |
| Remediation Lead | (recorded via Release lift) | 2026-09-09 | Evidence pack complete |
