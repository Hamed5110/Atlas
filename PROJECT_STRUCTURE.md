# ATLAS Project Structure

## Active Applications

### Legacy (production today)
- `server.js` - Backend API on port **3355**
- `atlas-hcm-next/` - Frontend build served by legacy API
- `start-atlas.ps1` - Starts legacy backend

### ATLAS Platform 3.0 (clean rebuild)
- `atlas-platform/` - Modern monorepo (TypeScript API + Next.js UI)
- Port **3360** — runs alongside legacy without conflict
- See [atlas-platform/README.md](atlas-platform/README.md)

```powershell
cd .\atlas-platform
.\start-atlas.ps1
```

### Canonical Python platform
- `airfare_management/` - Python 3.11+ Clean Architecture implementation
  - PySide6 desktop client + FastAPI + SQLAlchemy 2 / MSSQL
  - See [airfare_management/README.md](airfare_management/README.md)
  - Architecture decisions: [airfare_management/docs/architecture.md](airfare_management/docs/architecture.md)

## Organized Folders

- `database/` - SQL schema and database scripts.
- `docs/` - Word documentation and reference files.
- `deployment/` - IIS/network deployment helpers.
- `scripts/` - Maintenance scripts such as clearing old business data.
- `tests/` - Backend smoke tests.
- `logs/` - Backend runtime logs.

## Maintenance

To clear only business data while keeping users and login records:

```powershell
node .\scripts\clear-business-data.cjs
```

To start the active backend:

```powershell
.\start-atlas.ps1
```

Build the static frontend once (if needed):

```powershell
cd .\atlas-hcm-next
npm run build
```
