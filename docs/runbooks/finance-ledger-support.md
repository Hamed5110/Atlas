# Finance Ledger — Support Guide (ATLAS HCM)

**Audience:** Finance, HR, Admin, Support  
**Currency:** BHD  
**UI:** Finance Ledger (`/finance`)  
**API base:** `http://127.0.0.1:3389`

This guide explains how to use the **native double-entry Finance GL** for employee **ticket issue** and **loan** accounts, and how to read **trial balance** and **ledger reports**.

---

## 1. What it is

ATLAS posts balanced journal entries when you:

| Business event | Typical journal |
|----------------|-----------------|
| Ticket issue (allocation) | Dr Ticket Expense / Loan Receivable → Cr Cash |
| Standalone loan (no ticket) | Dr Loan Receivable → Cr Cash |
| Loan recovery payment | Dr Cash → Cr Loan Receivable |

Chart of accounts (seeded once per company):

| Code | Name | Type |
|------|------|------|
| 1000 | Cash / Bank | ASSET |
| 1100 | Employee Ticket Receivable | ASSET |
| 1200 | Employee Loan Receivable | ASSET |
| 2100 | Airfare Entitlement Liability | LIABILITY |
| 4000 | Airfare Ticket Expense | EXPENSE |
| 5000 | Loan Interest Income | REVENUE |

GL posts use a **savepoint**: if posting fails, the ticket/loan save still succeeds.

---

## 2. How to use (UI) — first time

1. Sign in as **admin**, **finance**, or **HR** at `http://127.0.0.1:3389`.
2. Open **Finance Ledger** in the left nav (`/finance`).
3. Confirm **Status** shows **Ready** (migration `0015_finance_gl` applied).
4. Click **Seed COA** once (creates the six accounts above).
5. Confirm the **Chart of accounts** table lists codes `1000`–`5000`.

If Status says migration is needed:

```powershell
cd "C:\HCM Airfare"
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Then restart the API (`start-service.ps1`) and seed again.

---

## 3. Day-to-day use (create ledger activity)

You do **not** enter journals by hand for normal work. Use existing screens:

### A) Ticket issue → expense + optional loan receivable

1. Go to **Airfare Allocation**.
2. Select employee, travel date, route, ticket amount.
3. Choose excess option if needed (**Make loan**, Self paid, Company paid, Entitlement amount).
4. Click **Issue**.
5. Open **Finance Ledger** → recent journal lines show `source_type = ticket_issue`.

### B) Loan recovery → cash vs loan receivable

1. Go to **Loans**.
2. Open a loan → post a **payment**.
3. Finance Ledger shows `source_type = loan_recovery` (Dr 1000 / Cr 1200).

### C) Standalone loan (no ticket)

1. **Loans** → create loan without a source ticket.
2. Ledger shows `source_type = loan_disbursement`.

---

## 4. How to show reports

### 4.1 Finance Ledger screen (this is the GL report)

On **Finance Ledger** (`/finance`), scroll to **Ledger report** (same page as Chart of accounts):

1. Optional: **Backfill journals** — posts GL from existing tickets/loans/payments (idempotent).
2. Filter **Account** (e.g. `1200`) and **As of** date.
3. Read Debit / Credit / Net (trial balance) and **Recent journal lines**.
4. Export (Focus ERP style — same idea as Focus report designer Print/Export):
   - **Export Excel** → `/v1/finance/ledger-report.xlsx` (sheets: Trial Balance + Journal Lines)
   - **Export PDF** → `/v1/finance/ledger-report.pdf` (printable landscape ledger)
   - CSV remains available at `/v1/finance/ledger-report.csv`

Logic (same as [python-accounting](https://github.com/ekmungai/python-accounting) docs): seed COA → **post** journals → then Trial Balance / ledger are non-zero. Empty zeros before posting is correct.

References: [Focus Softnet Financial Accounting](https://www.focussoftnet.com/financial-accounting-management-erp-software), Focus report export PDF/Excel ([Discover Focus Report Designer](https://www.discoverfocus.co.uk/knowledge-base/how-do-i-use-the-report-designer)), education channel [Focus-ERP Edu](https://www.youtube.com/@focus-erp-edu).

### 4.2 Operational reports (ticket / loan registers)

On **Reports** (`/reports`), use the existing datasets (not the GL COA, but operational detail):

| Report | What it shows |
|--------|----------------|
| Ticket Register | Every ticket with settlement detail |
| Loan Outstanding | Balances by employee / loan |
| Loan Statement | Installments and payments |
| Excess Recovery | Tickets where cost exceeded entitlement |
| Airfare Payable | Entitlement vs payable control |

Use **Finance Ledger** for accounting (COA / trial balance / journals).  
Use **Reports** for HR/ops registers and payable control sheets.

### 4.3 AI Insights

Open **AI Insights** and ask, for example:

- “Show trial balance for finance ledger”
- “What is account 1200 loan receivable?”
- “Explain ticket expense account 4000”

The agent knows the Finance GL module and `/v1/finance/*` APIs.

---

## 5. API — ledger reports (support / integration)

Authenticate first:

```http
POST /v1/auth/login
{"username":"admin","password":"<bootstrap password>"}
```

Use `Authorization: Bearer <access_token>`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/finance/status` | Ready? migration? |
| POST | `/v1/finance/seed` | Seed COA (`{}` or `{"company_id":"..."}`) |
| GET | `/v1/finance/accounts` | List chart of accounts |
| GET | `/v1/finance/trial-balance` | Trial balance (`?as_of=YYYY-MM-DD`) |
| GET | `/v1/finance/ledger-report` | Trial balance + journal lines |

Ledger report query params:

- `account_code` — e.g. `1200`
- `from_date` / `to_date` — `YYYY-MM-DD`
- `limit` — 1–1000 (default 200)
- `company_id` — optional UUID

Example:

```http
GET /v1/finance/ledger-report?account_code=1200&to_date=2026-09-07&limit=50
```

Response includes:

- `balanced`, `total_debit`, `total_credit`, `currency` (BHD)
- `accounts[]` — per-account debit/credit/net
- `entries[]` — journal lines (date, narration, source_type, debit, credit)

---

## 6. Verify and test (one command)

From the HCM repo:

```powershell
cd "C:\HCM Airfare"
$env:PYTHONPATH="C:\HCM Airfare\src"
.\.venv\Scripts\python.exe scripts\verify_finance_gl.py
```

This checks:

1. Unit tests `tests/unit/test_finance_ledger.py`
2. In-process API against MSSQL: OpenAPI finance paths, login, status, seed, accounts, trial balance, ledger report

**Verified (2026-09-07):** all checks **PASS** — status ready, COA seeded (6 accounts), trial balance balanced (BHD), ledger report OK.

Optional live server check (after restarting API so new routes load):

```powershell
.\.venv\Scripts\python.exe scripts\verify_finance_gl.py --live
```

If `--live` returns 404 on `/v1/finance/*`, recycle the API:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\HCM Airfare\start-service.ps1"
```

(`start-service.ps1` sets `PYTHONPATH=src` and applies Alembic.)

Offline unit tests only:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\unit\test_finance_ledger.py -q
```

---

## 7. Support checklist

| Symptom | Check |
|---------|--------|
| Status not Ready | `alembic upgrade head` → restart API |
| Empty chart | Click **Seed COA** |
| No journal lines | Issue a ticket or post a loan payment |
| Trial balance not balanced | Escalate — journals must always balance; capture `/v1/finance/ledger-report` JSON |
| Ticket saved but no GL line | Confirm migration + seed; GL failure is non-blocking (check API logs) |
| UI missing Finance Ledger | Rebuild/deploy `atlas-next` to `web_dist_next`, hard refresh |

---

## 8. Roles

Finance GL APIs/UI need one of: `admin`, `finance`, `hr`, `manager`, `auditor` (and matching SYSTEM roles).

---

## 9. Design note (for support)

Third-party libraries such as **python-accounting** were evaluated; they do not officially support **MSSQL**. ATLAS uses a **native MSSQL GL** with the same ideas (COA, balanced journals, trial balance) so it stays compatible with this application and AI Insights.
