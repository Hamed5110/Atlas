# ADR 003: Canonical port migration to 3389

## Status

Accepted (2026-08-22)

## Context

Port conflict with other local services required consolidating on a single canonical HTTP port.

## Decision

**3389** is the only supported HTTP port for HCM Airfare:

- `AIRFARE_PORT=3389` default in `config.py` and `.env.example`
- Docker `EXPOSE 3389`, compose mapping `127.0.0.1:3389:3389`
- `start-api.ps1`, desktop client, Vite proxy, E2E `baseURL`, and Locust host all use `http://127.0.0.1:3389`
- No dual-port fallback

## Consequences

- Update reverse-proxy, firewall, and operator runbooks to use port **3389**.
- Health checks use `/health/live` on port 3389.
- Legacy bookmarks to the old port will fail until updated.
