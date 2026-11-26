FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y curl unixodbc \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system airfare && useradd --system --gid airfare --home /app airfare
WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

USER airfare
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl --fail http://127.0.0.1:8000/health || exit 1
CMD ["uvicorn", "airfare_management.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
