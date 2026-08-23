FROM python:3.11-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl gnupg unixodbc \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
      | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
      > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install --no-install-recommends -y msodbcsql18 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system airfare && useradd --system --gid airfare --home /app airfare
WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
COPY alembic.ini ./
COPY migrations ./migrations
RUN pip install --no-cache-dir .

USER airfare
EXPOSE 3389
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl --fail http://127.0.0.1:3389/health/live || exit 1
CMD ["sh", "-c", "alembic upgrade head && uvicorn airfare_management.api.main:app --host 0.0.0.0 --port 3389 --proxy-headers"]
