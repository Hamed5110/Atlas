# Playwright E2E Tests

Browser tests for the Atlas Aluminum HCM Airfare web UI on port **3389**.

Decision record: [`docs/adr/0001-playwright-ci-before-tsql-engine.md`](../../docs/adr/0001-playwright-ci-before-tsql-engine.md).

## Setup

```powershell
cd tests/e2e
npm install
npx playwright install chromium
```

## Run

```powershell
# All tests (Playwright starts the API when needed)
npm test

# Against an already-running API
$env:PLAYWRIGHT_SKIP_WEBSERVER = "1"
npm test

# Update visual snapshots after intentional UI changes (Windows)
npm run test:update-snapshots
```

## CI

GitHub Actions job **Playwright E2E** (`needs: test-backend`):

1. Installs the Python package and Chromium  
2. Runs `alembic upgrade head` against SQLite  
3. Starts uvicorn via Playwright `webServer`  
4. Runs functional / a11y / responsive / login tests  

Visual specs (`ui/*.visual.spec.ts`) are **skipped when `CI=true`** because Windows baselines do not match Linux Chromium rendering.

## Auth

`global-setup.ts` logs in via `/v1/auth/login` and writes `auth.json`. Authenticated specs import `test` from `fixtures/auth.ts`, which injects JWT tokens into `sessionStorage` before each page load.

Login specs use an empty storage state and read `AIRFARE_BOOTSTRAP_ADMIN_PASSWORD` (default `StrongPassword!2026` in CI).
