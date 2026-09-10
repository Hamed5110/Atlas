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
    host: str = "0.0.0.0"
    port: int = Field(default=3389, ge=1, le=65535)
    api_base_url: str = "http://127.0.0.1:3389"
    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = Field(default="ChangeMeNow!2026", min_length=12)
    attachment_root: str = "./var/attachments"
    max_attachment_bytes: int = Field(default=25 * 1024 * 1024, ge=1024)
    document_root: str = "./var/documents"
    backup_root: str = "./var/backups"
    backup_retention_days: int = Field(default=14, ge=0, le=3650)
    db_user: str | None = None
    db_password: str | None = None
    db_server: str = "127.0.0.1"
    cors_origins: list[str] = Field(default_factory=list)
    crystal_bip_url: str = ""
    crystal_username: str = ""
    crystal_password: str = ""
    crystal_opendocument_base: str = ""
    # Local AI Data Agent (privacy-first)
    ai_research_enabled: bool = True
    # LLM provider: auto (Ollama → OpenAI-compat → DeepSeek) | ollama | anythingllm | deepseek | off
    ai_llm_provider: str = "auto"
    ai_ollama_enabled: bool = True
    ai_ollama_base_url: str = "http://127.0.0.1:11434"
    ai_ollama_model: str = "qwen2.5:3b-instruct"
    # OpenAI-compat: LM Studio :1234 / Jan :1337 / AnythingLLM :3001/api/v1/openai
    ai_openai_compat_enabled: bool = False
    ai_openai_compat_base_url: str = "http://127.0.0.1:1234"
    ai_openai_compat_model: str = "local-model"
    ai_openai_compat_api_key: str = "local"
    # Optional DeepSeek OpenAI-compatible API (not guaranteed free after trial)
    ai_deepseek_api_key: str = ""
    ai_deepseek_base_url: str = "https://api.deepseek.com"
    ai_deepseek_model: str = "deepseek-v4-flash"
    ai_deepseek_thinking: bool = True
    ai_deepseek_reasoning_effort: str = "medium"
    # WhatsApp / Evolution API v2 (Cloud-first interactive; Baileys for QR/lab media)
    evolution_enabled: bool = False
    evolution_base_url: str = "http://127.0.0.1:8080"
    evolution_api_key: str = ""
    evolution_webhook_secret: str = Field(default="dev-wa-webhook-secret-change-me", min_length=16)
    evolution_webhook_public_url: str = ""
    whatsapp_default_instance: str = "atlas-smoke-test"
    whatsapp_cta_jwt_minutes: int = Field(default=15, ge=5, le=60)
    whatsapp_nonce_hours: int = Field(default=48, ge=1, le=72)
    whatsapp_nonce_replay_hours: int = Field(default=72, ge=48, le=168)
    whatsapp_max_attachment_bytes: int = Field(default=5 * 1024 * 1024, ge=1024)
    whatsapp_portal_base_url: str = "http://127.0.0.1:3389"
    whatsapp_cta_private_key_pem: str = ""
    whatsapp_require_clamav: bool = False

    @model_validator(mode="after")
    def _reject_insecure_defaults(self) -> Self:
        """Refuse shipping defaults when running as production."""
        if self.environment == "production":
            if self.jwt_secret.startswith("development-only"):
                raise ValueError("AIRFARE_JWT_SECRET must be set in production")
            if self.bootstrap_admin_password == "ChangeMeNow!2026":
                raise ValueError("AIRFARE_BOOTSTRAP_ADMIN_PASSWORD must be changed")
            if self.evolution_enabled and not self.evolution_api_key:
                raise ValueError("AIRFARE_EVOLUTION_API_KEY must be set when Evolution is enabled")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide validated settings.

    Returns:
        Immutable-by-convention cached settings.
    """
    return Settings()
