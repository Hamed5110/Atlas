# ATLAS Project Structure

## Active Application

- `server.js` - Active backend API for SQL Server.
- `atlas-hcm-next/` - Active dashboard frontend build, served directly from backend at `http://localhost:3355`.
- `.env` - Local SQL/API configuration.
- `start-atlas.ps1` - Starts the backend API.

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
