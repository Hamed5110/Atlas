"""Validated process configuration."""

from functools import lru_cache
from typing import Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="AIRFARE_", case_sensitive=False, extra="ignore"
    )

    environment: str = "development"
    database_url: str = (
        "mssql+pyodbc://sa:YOUR_URL_ENCODED_PASSWORD@127.0.0.1/HCM_Airfare_Management"
        "?driver=ODBC+Driver+18+for+SQL+Server&Encrypt=yes&TrustServerCertificate=yes"
    )
    jwt_secret: str = Field(default="development-only-secret-change-me-32", min_length=32)
    jwt_issuer: str = "airfare-management"
    access_token_minutes: int = Field(default=30, ge=5, le=1440)
    refresh_token_days: int = Field(default=14, ge=1, le=90)
    preference_cache_seconds: int = Field(default=300, ge=30, le=3600)
    redis_url: str = "redis://127.0.0.1:6379/0"
    celery_broker_url: str = "redis://127.0.0.1:6379/1"
    celery_result_backend: str = "redis://127.0.0.1:6379/2"
    host: str = "127.0.0.1"
    port: int = Field(default=3389, ge=1, le=65535)
    api_base_url: str = "http://127.0.0.1:3389"
    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = Field(default="ChangeMeNow!2026", min_length=12)
    attachment_root: str = "./var/attachments"
    max_attachment_bytes: int = Field(default=25 * 1024 * 1024, ge=1024)
    backup_root: str = "./var/backups"
    backup_retention_days: int = Field(default=14, ge=0, le=3650)
    db_user: str | None = None
    db_password: str | None = None
    db_server: str = "127.0.0.1"
    cors_origins: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _reject_insecure_defaults(self) -> Self:
        """Refuse shipping defaults when running as production."""
        if self.environment == "production":
            if self.jwt_secret.startswith("development-only"):
                raise ValueError("AIRFARE_JWT_SECRET must be set in production")
            if self.bootstrap_admin_password == "ChangeMeNow!2026":
                raise ValueError("AIRFARE_BOOTSTRAP_ADMIN_PASSWORD must be changed")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide validated settings.

    Returns:
        Immutable-by-convention cached settings.
    """
    return Settings()
