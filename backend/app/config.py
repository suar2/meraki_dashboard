from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    meraki_api_key: str = Field(default="", alias="MERAKI_API_KEY")
    meraki_base_url: AnyHttpUrl = Field(default="https://api.meraki.com/api/v1", alias="MERAKI_BASE_URL")
    app_env: Literal["development", "production"] = Field(default="development", alias="APP_ENV")
    backend_port: int = Field(default=8000, alias="BACKEND_PORT")
    frontend_port: int = Field(default=3000, alias="FRONTEND_PORT")
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(default="INFO", alias="LOG_LEVEL")
    topology_refresh_seconds: int = Field(default=60, alias="TOPOLOGY_REFRESH_SECONDS")
    data_dir: str = Field(default="./backend/data", alias="DATA_DIR")
    request_timeout_seconds: int = Field(default=25, alias="REQUEST_TIMEOUT_SECONDS")
    max_retries: int = Field(default=3, alias="MAX_RETRIES")
    retry_backoff_seconds: int = Field(default=2, alias="RETRY_BACKOFF_SECONDS")
    secret_key: str = Field(alias="SECRET_KEY")
    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")
    cache_ttl_seconds: int = Field(default=60, alias="CACHE_TTL_SECONDS")

    @field_validator("meraki_api_key")
    @classmethod
    def validate_key(cls, value: str) -> str:
        if value == "your_meraki_api_key_here":
            raise ValueError("MERAKI_API_KEY cannot be placeholder text.")
        return value

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, value: str) -> str:
        if not value:
            raise ValueError("SECRET_KEY is required.")
        return value

    @model_validator(mode="after")
    def validate_production_secret(self) -> "Settings":
        if self.app_env == "production" and self.secret_key == "change_this_to_a_random_long_string":
            raise ValueError("SECRET_KEY must be changed from default in production.")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def masked_api_key(self) -> str:
        key = self.meraki_api_key
        if len(key) <= 8:
            return "****"
        return f"{key[:4]}...{key[-4:]}"

    def ensure_data_dir(self) -> Path:
        path = Path(self.data_dir).resolve()
        path.mkdir(parents=True, exist_ok=True)
        if not path.is_dir():
            raise ValueError(f"DATA_DIR is not a directory: {path}")
        test_file = path / ".write_test"
        try:
            test_file.write_text("ok", encoding="utf-8")
            test_file.unlink(missing_ok=True)
        except OSError as exc:
            raise ValueError(f"DATA_DIR is not writable: {path}") from exc
        return path


settings = Settings()


def configure_logging() -> None:
    logging.basicConfig(
        level=getattr(logging, settings.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
