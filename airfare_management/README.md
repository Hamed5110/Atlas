# Airfare Management

Canonical Python 3.11 implementation of the ATLAS employee leave-travel platform. It
contains a PySide6 desktop client, FastAPI service, SQLAlchemy 2 persistence, MSSQL DDL,
Alembic migration, entitlement/loan/preferences services, and executable tests.

## Quick start

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Copy-Item .env.example .env
alembic upgrade head
airfare-api
```

Start the desktop client in another shell with `airfare-desktop`. API documentation is
available at `http://127.0.0.1:8000/docs`. Production deployments must inject secrets,
terminate TLS at a trusted reverse proxy, restrict CORS, and use a dedicated least-
privilege SQL login.

## Quality gates

```powershell
ruff format --check .
ruff check .
mypy
pytest --cov --cov-report=term-missing
```

The API uses structured problem responses with correlation IDs. Mutations require a
Bearer JWT and enforce roles. Database rows use soft deletion and integer versions;
clients send `If-Match` for optimistic concurrency.
