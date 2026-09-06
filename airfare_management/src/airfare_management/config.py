"""Validated process configuration."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="AIRFARE_", case_sensitive=False, extra="ignore"
    )

    environment: str = "development"
    database_url: str = "sqlite+pysqlite:///./airfare.db"
    jwt_secret: str = Field(default="development-only-secret-change-me-32", min_length=32)
    jwt_issuer: str = "airfare-management"
    access_token_minutes: int = Field(default=30, ge=5, le=1440)
    attachment_root: str = "./var/attachments"
    cors_origins: list[str] = Field(default_factory=list)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide validated settings.

    Returns:
        Immutable-by-convention cached settings.
    """
    return Settings()
