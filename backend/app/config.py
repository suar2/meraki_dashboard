from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.security import SensitiveDataFilter


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    meraki_base_url: AnyHttpUrl = Field(default="https://api.meraki.com/api/v1", alias="MERAKI_BASE_URL")
    app_env: Literal["development", "production"] = Field(default="development", alias="APP_ENV")
    backend_port: int = Field(default=8000, alias="BACKEND_PORT")
    frontend_port: int = Field(default=43123, alias="FRONTEND_PORT")
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(default="INFO", alias="LOG_LEVEL")
    topology_refresh_seconds: int = Field(default=60, alias="TOPOLOGY_REFRESH_SECONDS")
    meraki_client_lookback_seconds: int = Field(default=86400, alias="MERAKI_CLIENT_LOOKBACK_SECONDS")
    data_dir: str = Field(default="./backend/data", alias="DATA_DIR")
    request_timeout_seconds: int = Field(default=25, alias="REQUEST_TIMEOUT_SECONDS")
    max_retries: int = Field(default=3, alias="MAX_RETRIES")
    retry_backoff_seconds: int = Field(default=2, alias="RETRY_BACKOFF_SECONDS")
    secret_key: str = Field(default="change_this_to_a_random_long_string", alias="SECRET_KEY")
    cors_origins: str = Field(default="http://localhost:43123", alias="CORS_ORIGINS")
    cache_ttl_seconds: int = Field(default=60, alias="CACHE_TTL_SECONDS")

    @field_validator("secret_key", "app_env", "log_level", "cors_origins", "data_dir", mode="before")
    @classmethod
    def strip_env(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, value: str) -> str:
        if not value:
            raise ValueError("SECRET_KEY is required.")
        return value

    @field_validator("meraki_client_lookback_seconds", mode="before")
    @classmethod
    def clamp_client_lookback(cls, value: object) -> int:
        try:
            seconds = int(value) if value is not None else 86400
        except (TypeError, ValueError):
            seconds = 86400
        # Meraki Get Network Clients: minimum useful window 5 minutes, maximum 31 days.
        return max(300, min(seconds, 2_678_400))

    @model_validator(mode="after")
    def validate_production_secret(self) -> "Settings":
        if self.app_env == "production" and self.secret_key == "change_this_to_a_random_long_string":
            raise ValueError("SECRET_KEY must be changed from default in production.")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

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
    root = logging.getLogger()
    redactor = SensitiveDataFilter()
    if not any(isinstance(f, SensitiveDataFilter) for f in root.filters):
        root.addFilter(redactor)
    for handler in root.handlers:
        if not any(isinstance(f, SensitiveDataFilter) for f in handler.filters):
            handler.addFilter(redactor)
