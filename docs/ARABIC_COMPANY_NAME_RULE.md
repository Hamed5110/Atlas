# Arabic Company / Employee Name Rule

**Status:** SIGNED — Product Owner · Decision: **Option A — BLOCK**  
**Scope:** Arabic-primary Offer Letter and Contract print PDFs  
**Related:** `application/documents.py` (`_resolve_company_arabic_name`, `_company_profile`)

## 1. Problem

Arabic-primary documents display company and employee names in Arabic. If `company.arabic_name` (or employee Arabic name) is blank, Engineering must not silently invent or leave misleading Latin text in Arabic slots without an explicit Product rule.

## 2. Engineering behaviour (implemented)

1. Prefer MSSQL `company.arabic_name` / employee Arabic name.
2. Else apply a small known Focus-style name map (e.g. Atlas Aluminium → شركة أطلس ألمنيوم).
3. **Issue / regenerate:** if company or employee Arabic name is still empty → hard-fail `arabic_name_required`.
4. **Preview only:** may render with Latin fallback and an explicit **DEGRADED — Arabic company name missing** banner.

## 3. Product decision (choose exactly one)

### Option A — BLOCK (recommended) — **SELECTED**

- [x] **Issue hard-fails** (`arabic_name_required`) when Arabic-primary print is requested and resolved company Arabic name is empty after DB + map lookup.
- Preview may still render with a clear **DEGRADED — Arabic name missing** banner for data cleanup only.
- Employee Arabic name blank: hard-fail Issue for Arabic-primary templates.

### Option B — Explicit degrade

- [ ] Not selected.

## 4. Signatures

| Role | Name | Decision (A/B) | Date | Signed |
|---|---|---|---|---|
| Product Owner | Ahmed Al-Mansoori | A — BLOCK | 2026-09-09 | Yes — Signed Arabic-name rule. |
| Legal / HR | Ahmed Al-Mansoori | A — BLOCK | 2026-09-09 | Acknowledged |
| Remediation Lead | (Release Manager lift) | A — BLOCK | 2026-09-09 | Yes |
