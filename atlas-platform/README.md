# ATLAS Platform 3.0

Clean monorepo rebuild of the ATLAS Airfare & Loan Manager.

## Structure

```
atlas-platform/
├── apps/
│   ├── api/          # TypeScript Express API (modular routes)
│   └── web/          # Next.js 15 dashboard (feature-based UI)
├── packages/
│   └── shared/       # Shared types + airfare engine
├── .env.example
└── start-atlas.ps1
```

## Features

- **Same MSSQL database** — connects to your existing `Atlasairfare010` (or configured DB)
- **Modular API** — auth, employees, opening balances, allocations, loans, policies, preferences
- **Modern UI** — dark command-center dashboard with sidebar navigation
- **TypeScript throughout** — shared types between API and web
- **Port 3360** — runs alongside the legacy app on 3355

## Quick start

```powershell
cd atlas-platform
copy ..\.env .env
# Edit .env: set PORT=3360 and DB credentials

npm install
npm run build
.\start-atlas.ps1
```

Open **http://localhost:3360**

## Development

```powershell
# Terminal 1 — API with hot reload
npm run dev --workspace @atlas/api

# Terminal 2 — Web dev server
npm run dev --workspace @atlas/web
```

## Tests

```powershell
npm test
```

## Architecture decisions

| Area | Choice |
|------|--------|
| API | Express + Zod validation + modular route files |
| DB | mssql connection pool, stored procedure first with SQL fallback |
| Web | Next.js App Router, static export served by API |
| Shared | `@atlas/shared` package for airfare formulas and types |
| Auth | JWT + session table (compatible with existing Users table) |

## Migration path

This platform is designed to coexist with the legacy `server.js` app:

1. Run both on different ports (3355 legacy, 3360 platform)
2. Point both at the same database
3. Gradually port remaining endpoints from legacy to `@atlas/api`
