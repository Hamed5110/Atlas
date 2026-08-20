# HCM Airfare Management

Production-oriented Python 3.11+ employee leave-travel platform. The canonical project
listens on **port 3388** and combines a FastAPI service, native PySide6 desktop client,
SQLAlchemy 2 persistence, Alembic migrations, Microsoft SQL Server DDL, Excel interchange,
PDF reporting, JWT/RBAC, audit metadata, optimistic workflow versions, and automated tests.

## Start locally

```powershell
Set-Location -LiteralPath "C:\HCM Airfare"
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
Copy-Item .env.example .env
# Edit .env and set AIRFARE_DATABASE_URL to the local SQL Server database.
# URL-encode special characters in the SQL password (for example, @ becomes %40).
.\start-api.ps1
```

The runtime database is Microsoft SQL Server. `start-api.ps1` applies Alembic migrations
before starting the API; SQLite is used only by isolated in-memory tests. Local SQL
connections use ODBC Driver 18 with encryption and `TrustServerCertificate=yes`. If the
driver is missing, install it with:

```powershell
winget install --id Microsoft.ODBCDriver.18forSQLServer --exact
```

Health: `http://127.0.0.1:3388/health`  
OpenAPI (non-production): `http://127.0.0.1:3388/docs`

Open the web application in a browser:

```text
http://127.0.0.1:3388/
```

The web client is served by FastAPI on the same origin and requires no separate frontend
build or server. Sign in with the development bootstrap account, then use the navigation
for Dashboard, Employees, Opening Balances, Airfare Entitlement, Airfare Allocation
Engine, Tickets, Loans, Preferences, and Reports.

Start the desktop client in a second terminal:

```powershell
Set-Location -LiteralPath "C:\HCM Airfare"
.\start-desktop.ps1
```

The development bootstrap login is `admin` / `ChangeMeNow!2026` unless overridden in
`.env`. Change it before first production startup. Existing users are never overwritten.

## Import reference data from ATLAS

With both local database URLs configured, run the repeatable importer:

```powershell
Set-Location -LiteralPath "C:\HCM Airfare"
.\.venv\Scripts\python.exe .\scripts\import_from_atlas.py
```

The script opens `Atlasairfare010` with read-only application intent and writes only to
`HCM_Airfare_Management`. It reads the source credential from `ATLAS_DATABASE_URL`, or
from the existing ATLAS `.env` when running on the reference workstation. It prints
source/created/updated counts for employees, balances, rates, tickets, loans, and
preferences. Deterministic UUIDs make reruns idempotent. See
[`docs/atlas-import.md`](docs/atlas-import.md) for the field mapping, explicit omissions,
and applied UX/API/MSSQL research.

## Environment variables

Copy `.env.example` and set at minimum:

- `AIRFARE_DATABASE_URL`: SQLAlchemy MSSQL URL using ODBC Driver 18. Runtime startup does
  not fall back to SQLite.
- `AIRFARE_JWT_SECRET`: random secret of at least 32 characters.
- `AIRFARE_BOOTSTRAP_ADMIN_USERNAME` and `AIRFARE_BOOTSTRAP_ADMIN_PASSWORD`: initial
  administrator credentials.
- `AIRFARE_ACCESS_TOKEN_MINUTES` and `AIRFARE_REFRESH_TOKEN_DAYS`: access/refresh
  lifetime controls.
- `AIRFARE_REDIS_URL`, `AIRFARE_CELERY_BROKER_URL`, and
  `AIRFARE_CELERY_RESULT_BACKEND`: Redis databases used by production workers.
- `AIRFARE_ATTACHMENT_ROOT` and `AIRFARE_MAX_ATTACHMENT_BYTES`: attachment storage and
  upload limit.

For Docker Compose, also set `MSSQL_SA_PASSWORD`,
`MSSQL_SA_PASSWORD_URLENCODED`, and `REDIS_PASSWORD`. Never commit `.env`.

## Functional coverage

- Companies, employees, and organizational lookups with search and optimistic CRUD
- Transactional Excel employee import with dry-run, duplicate/FK validation, and styled
  Excel export
- Opening entitlement balances and scenario calculations, including leap-year/new-joiner
  boundaries, reset anchors, rate scopes, and cap enforcement
- Ticket approval workflow with guarded transitions, excess handling, and automatic loan
  conversion
- Reducing-balance EMI, amortization schedules, payment posting, deferment,
  restructuring, and atomic bulk settlement
- Global → repair center/pay group → user preference cascade with user override
  protection and five-minute session cache
- Employee self-service request submission, attachments, and status tracking
- Six operational report summaries plus letterheaded, timestamped PDF output
- Content-addressed attachment storage with size limits and SHA-256 metadata
- Bcrypt cost 12, short-lived JWT access tokens, rotating refresh tokens with reuse
  detection, password history, lockout, canonical RBAC roles, record scoping, correlation
  IDs, and append-only audit metadata with actor, session, and IP
- SQLAlchemy portable schema, Alembic upgrades, and enterprise MSSQL DDL under `sql/`
- Pure-JavaScript web CRUD/workflow screens and native Qt dashboard, preferences,
  reports, ESS, administration, conditional row formatting, and light/dark themes

## Production deployment

Set strong `AIRFARE_JWT_SECRET` and bootstrap credentials, use the SQL Server URL from
`.env.example`, run `alembic upgrade head`, and place port 3388 behind an authenticated TLS
reverse proxy. Restrict CORS, use a least-privilege database login, protect the attachment
volume, and centralize logs. Docker:

```powershell
docker compose up --build -d
Invoke-RestMethod http://127.0.0.1:3388/health
```

Compose starts SQL Server 2022, initializes `HCM_Airfare_Management`, applies Alembic,
starts the API on 3388, Redis, and a Celery worker. SQL data, backups, Redis, and
attachments use named volumes. The application containers are read-only except for the
attachment volume.

Create and verify backups from the web **Backup & Restore** screen (admin), or with `sqlcmd`:

```powershell
$env:AIRFARE_DB_USER = "backup_operator"
$env:AIRFARE_DB_PASSWORD = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText
.\start-backup.ps1 -BackupDirectory "D:\SQLBackups"
```

Logical JSON backups are portable across engines. Native `.bak` uses open-source `sqlcmd`
(mssql-tools) with `BACKUP DATABASE` + `RESTORE VERIFYONLY`, matching ATLAS admin UX and
tools such as [DBManager](https://github.com/momysnow/dbmanager).

Grant the backup identity only the required SQL Server backup permissions and protect the
backup directory with operating-system ACLs and off-host retention.

## Quality gates

```powershell
.\.venv\Scripts\ruff.exe format --check .
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\mypy.exe
.\.venv\Scripts\pytest.exe --cov --cov-report=term-missing
```

The enforced non-GUI coverage gate is 90%. GitHub Actions runs formatting, lint, strict
typing, tests, and the same coverage gate.

## Architecture and blueprint documents

Implementation and deployment details in this README are complemented by the blueprint,
architecture, data, security, testing, and operations documents under [`docs/`](docs/).

## Explicit integration boundaries

The system does not claim integrations that require customer infrastructure. Production
operators must connect an external malware scanner before promoting attachment
`scan_status` from `pending`, configure enterprise SSO if password login is not permitted,
and connect payroll/HRIS posting to the loan-payment API. Email/SMS delivery and object
storage are also deployment-specific. The core workflows remain fully usable without
those integrations.
