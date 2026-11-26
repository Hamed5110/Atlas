# HR Document Lifecycle — architecture note (ATLAS on :3389)

## Benchmark (research summary)

| Platform | Document generation | Dynamic forms / custom fields | Fit for ATLAS :3389 |
|----------|--------------------|-------------------------------|---------------------|
| **ERPNext / Frappe** | Jinja print formats → PDF; strong merge | DocType Customize Form | Would replace FastAPI stack — not used |
| **OrangeHRM** | WYSIWYG templates + tokens + e-sign | App Builder + custom fields | Patterns adopted (tokens, soft fields) |
| **Odoo HR + Studio** | Via Studio / apps | Excellent Studio fields | Heavy runtime — not used |
| **IceHRM / Sentrifugo** | Limited letters | Weak schema builder | Not selected |

**Chosen approach:** Extend ATLAS HCM Document Studio with Frappe-style Jinja merge + OrangeHRM-style soft-delete form fields and signature status — additive on the existing FastAPI process.

## Schema (additive)

- `hr_form_definitions` — JSON `fields[]` with `active` / `deleted_at` (never hard-DROP)
- `hr_doc_templates` — optional WYSIWYG/Jinja body overrides
- `documents.kind` widened to VARCHAR(40); new kinds stored in existing `documents` table

## API (`/v1/hr-lifecycle/*`)

- templates, forms CRUD, field soft-delete, seed, preview, documents issue, signature status
- PDF still via existing Chromium/xhtml2pdf pipeline
- **Mistake with Fine:** `POST /v1/hr-lifecycle/documents/{id}/convert-to-loan` creates interest-free `loans` row (Bahrain Labour Law Art. 44 style — no interest; soft-warn if EMI > 10% of salary)

## UI (atlas-next)

- Warning / Salary revisions / Experience / Relieving / Disciplinary / Promotion / **Mistake & Fine** pages
- HR Form Builder (`/hr-forms`)

## Mistake with Fine — recovery algorithm

1. Issue letter with `fine_amount`, `recovery_method` ∈ {`lump_sum_payroll`, `cash`, `convert_to_loan`}
2. If `convert_to_loan`: require `tenure_months` (1–60) + `consent_acknowledged=true`
3. `plan_mistake_fine_recovery` → EMI via `calculate_emi(principal, rate=0, tenure)`
4. Auto on issue (or button **To Loan**) → `LoanRow` + amortization + PDF regenerate with loan voucher
