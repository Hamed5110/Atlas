# UI Inventory Audit

Date: 2026-07-09  
Scope: Step 3 audit only  
Stack: React + Next.js App Router + CSS modules + CSS custom properties + local/session storage + shared fetch layer in `lib/atlas-api.ts`

## 3.1 Route inventory

| Route | File | Purpose | Decision |
|---|---|---|---|
| `/` | `C:\Airfare_Allowance\atlas-hcm-next\app\page.tsx` | Legacy monolithic shell containing login, navigation, and all business modules | `MERGE` |
| `/v2` | `C:\Airfare_Allowance\atlas-hcm-next\app\v2\page.tsx` | New shell mount point running in parallel to legacy UI | `KEEP` |
| `/v2/theme/[theme]` | `C:\Airfare_Allowance\atlas-hcm-next\app\v2\theme\[theme]\page.tsx` | Theme preview route for five approved shell themes | `KEEP` |
| `/help/*` | public assets | Support guide and static help artifacts | `KEEP` |
| `/data/airports-world.json` | public dataset | Airport search source data | `KEEP` |

## 3.2 Screen and module inventory

| Screen / module | Current location | Current state | Decision | Reason |
|---|---|---|---|---|
| Sign in | legacy auth branch in `page.tsx`; `v2-sign-in-module.tsx` | live in legacy and live in `/v2` | `MERGE` | backend auth contract stays; shell UX can modernize |
| Overview | `activeView === "Overview"`; `v2-overview-module.tsx` | live in legacy and live in `/v2` | `MERGE` | module already has a real `/v2` slice |
| Employees | `activeView === "Employees"`; `v2-employees-module.tsx` | live in legacy and live in `/v2` | `MERGE` | live data already wired in `/v2`; keep contract, continue rebuilding UX |
| Opening Balance | `activeView === "Opening Balance"` | legacy only | `MERGE` | core business flow; preserve rules and rebuild layout later |
| Airfare | `activeView === "Airfare"`; `v2-airfare-module.tsx` | live in legacy and live in `/v2` | `MERGE` | first live `/v2` register exists; keep growing from there |
| Employee Self-Service | `activeView === "Employee Self-Service"` | legacy only | `MERGE` | important workflow, not migrated yet |
| Loans | `activeView === "Loans"` | legacy only | `MERGE` | critical workflow, not migrated yet |
| Year End | `activeView === "Year End"` | legacy only | `MERGE` | high-risk financial workflow; keep logic and redesign carefully |
| Reports | `activeView === "Reports"` | legacy only; `/v2` nav placeholder only | `MERGE` | reporting contract should stay, shell should improve |
| Companies | `activeView === "Companies"` | legacy only | `MERGE` | admin flow still needed, not yet migrated |
| Preferences | `activeView === "Preferences"` | legacy only; `/v2` nav placeholder only | `MERGE` | policy/theme engine already exists and must be retained |
| AI Insights | `activeView === "AI Insights"` | legacy only | `REPLACE` | presentation can change heavily while preserving data feeds |
| Security | `activeView === "Security"` | legacy only; `/v2` nav placeholder only | `MERGE` | preserve admin workflows, modernize forms/tables later |
| Support | `activeView === "Support"` | legacy only | `KEEP` | static/supportive content can be folded into new shell later |
| System Maintenance | `activeView === "System Maintenance"` | legacy only | `MERGE` | update/diagnostic utilities should move into final shell |

## 3.3 Component inventory

| Component / surface | Current location | Decision | Notes |
|---|---|---|---|
| Legacy app shell | `app/page.tsx` | `REPLACE` | too much responsibility in one file |
| `/v2` shell | `app/v2/v2-shell.tsx` | `KEEP` | approved parallel migration surface |
| `/v2` shell styling | `app/v2/v2-shell.module.css` | `KEEP` | current token-based base for the new system |
| Sidebar navigation | legacy inline + `/v2` shell nav | `MERGE` | keep behavior, continue fixing clickability and layout |
| Top bar | legacy inline + `/v2` shell topbar | `MERGE` | stabilize into one shared system shell |
| Theme switcher | legacy theme preferences + `/v2` theme picker | `MERGE` | preserve all user-selectable themes |
| Notification center | legacy + `/v2` bell panel | `MERGE` | keep interaction model, normalize placement |
| Employee register | legacy employees view + `v2-employees-module.tsx` | `MERGE` | live `/v2` version exists |
| Employee edit modal | legacy and `/v2` employee module | `MERGE` | modal workflow exists, continue polishing |
| Employee bulk delete flow | legacy and `/v2` employee module | `MERGE` | contract preserved |
| Allocation register | legacy airfare view + `v2-airfare-module.tsx` | `MERGE` | live `/v2` version exists |
| Allocation attachment viewer | legacy and `/v2` airfare module | `MERGE` | already using backend attachment path |
| Opening balance edit modal | legacy only | `MERGE` | business-critical, not yet moved |
| Preference delete modal | legacy only | `MERGE` | keep delete logic and redesign later |
| Airport search field | legacy only today | `MERGE` | keep ranking logic and data source |
| Fiscal year switcher | legacy shell | `MERGE` | preserve behavior, redesign placement |

## 3.4 KEEP / REPLACE / MERGE summary

### KEEP
- `/v2` mount point
- `/v2/theme/[theme]` preview route
- help assets and airport dataset
- support/static content where it already works

### REPLACE
- legacy monolithic shell composition
- AI Insights presentation layer
- remaining legacy top-level shell layout once `/v2` is fully verified

### MERGE
- all backend-connected business modules
- session restoration behavior
- theme preference persistence
- notifications, search, year switching, forms, modals, and delete/edit workflows

## 3.5 API contracts used by the UI

Shared API layer:
- `atlasLogin(username, password)`
- `atlasFetch<T>(path, token, sessionId)`
- `atlasMutation<T>(path, token, sessionId, method, body)`
- `atlasHealth()`
- API base resolves to `http://127.0.0.1:3355/api` when running local preview away from port `3355`

### Core auth and platform

| Endpoint | Method | Used by |
|---|---|---|
| `/auth/login` | `POST` | login |
| `/health` | `GET` | maintenance / health checks |
| `/public/companies/{companyCode}/logo` | `GET` | sign-in branding |
| `/companies/{companyId}/logo` | `GET` | authenticated branding |

### Employees

| Endpoint | Method | Used by |
|---|---|---|
| `/employees?scope=all` | `GET` | employees register in legacy and `/v2` |
| `/employees?scope=active` | `GET` | employee-scoped views |
| `/employees/{id}` | `PUT` | employee edit |
| `/employees/{id}` | `DELETE` | employee delete |
| `/employees/bulk-delete` | `POST` | bulk delete |
| `/employees/import-preview` | `POST` | import staging |

### Opening balances

| Endpoint | Method | Used by |
|---|---|---|
| `/opening-balances?year={year}` | `GET` | opening balance register |
| `/opening-loan-balances?year={year}` | `GET` | opening loan balance register |
| `/opening-balances` | `POST` | save/update opening balance |
| `/opening-balances/{employeeId}/{year}` | `DELETE` | delete opening balance |
| `/opening-balances/bulk-delete` | `POST` | bulk delete |
| `/opening-balances/import-preview` | `POST` | import staging |

### Airfare

| Endpoint | Method | Used by |
|---|---|---|
| `/allocations?year={year}` | `GET` | allocation register |
| `/allocations/attachments?ids=...` | `GET` | attachment preload |
| `/allocation-attachments/{id}/view` | `GET` | attachment view |
| allocation save/delete/eligibility endpoints | mixed | legacy airfare workflow |

### Employee Self-Service

| Endpoint | Method | Used by |
|---|---|---|
| `/employee-self-service/summary` | `GET` | ESS dashboard |
| `/employee-self-service/requests` | `GET/POST` | ESS requests |
| `/employee-self-service/requests/{id}/transition` | `POST` | approvals/transitions |

### Loans

| Endpoint | Method | Used by |
|---|---|---|
| `/loans/register` | `GET` | loan register |
| `/loans/summary` | `GET` | loan metrics |
| `/loans` | `POST` | create loan |
| `/loans/{id}` | `PUT/DELETE` | edit/delete loan |
| `/loans/{id}/settle` | `POST` | settlement |
| `/loans/preview-emis` | `POST` | EMI preview |
| `/loans/run-emis` | `POST` | EMI run |

### Year End / reports / admin

| Endpoint | Method | Used by |
|---|---|---|
| `/reports/year-summary/{year}` | `GET` | year-end metrics |
| `/reports/airfare-payable?...` | `GET` | payable reporting |
| `/year-end/preview/{year}` | `POST` | year-end preview evidence |
| `/year-end/close` | `POST` | final close |
| `/companies` | `GET/POST/PUT/DELETE` | companies admin |
| `/companies/cleanup-preview` | `GET` | cleanup preview |
| `/companies/empty` | `DELETE` | empty-company cleanup |
| `/admin/backups` | `GET` | backups |
| `/admin/backup` | `POST` | backup create |
| `/admin/restore` | `POST` | restore |
| `/users` | `GET/POST` | user admin |
| `/users/{id}` | `PUT` | user edit |

### Preferences / policy engine

| Endpoint | Method | Used by |
|---|---|---|
| `/airfare-policy-rates` | `GET/POST` | policy list and save |
| `/airfare-policy-rates/{id}/references` | `GET` | delete preview |
| `/airfare-policy-rates/{id}` | `DELETE` | delete policy |
| `/airfare-policy-rates/{id}/delete` | `POST` | alternate delete action |

## 3.6 Theme system audit

### Legacy theme system

| Concern | Current implementation |
|---|---|
| Theme DOM flags | `data-theme`, `data-accent`, `data-density` |
| Persistence | `localStorage["atlas.ui.preferences"]` |
| Session persistence | `localStorage["atlas.session"]` |
| Token base | `app/globals.css` custom properties |

### `/v2` theme system

| Concern | Current implementation |
|---|---|
| Theme DOM flag | `data-theme` on `.shell` |
| Theme persistence | `localStorage["atlas.v2.theme"]` |
| Theme selector | `v2-shell.tsx` select + save button |
| Styling source | `v2-shell.module.css` |
| Supported themes | `light-professional`, `dark-professional`, `high-contrast`, `emerald-command`, `slate-executive` |
| Default | `Light Professional` |

### `/v2` design token contract
- `--v2-bg-app`
- `--v2-surface`
- `--v2-surface-strong`
- `--v2-surface-muted`
- `--v2-text`
- `--v2-text-muted`
- `--v2-border`
- `--v2-border-strong`
- `--v2-accent`
- `--v2-accent-strong`
- `--v2-danger`
- `--v2-shadow`
- `--v2-shadow-raised`
- `--v2-ring`

## 3.7 Structural findings

1. The legacy product is still a single-route monolith with many view states in `app/page.tsx`.
2. `/v2` is the correct parallel migration surface and already hosts real modules, not just mock screens.
3. Real `/v2` modules currently available:
   - sign-in
   - overview
   - employees
   - airfare
4. Modules still missing from `/v2`:
   - opening balance
   - employee self-service
   - loans
   - year end
   - reports
   - companies
   - preferences
   - AI insights
   - security
   - support
   - system maintenance
5. Highest risk areas for migration remain:
   - navigation wiring
   - modal layering
   - dense financial forms
   - year switch propagation
   - preferences/delete flows

## STOP checkpoint

Awaiting user approval before Step 4.
