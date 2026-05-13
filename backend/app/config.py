from __future__ import annotations
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    AT_USERNAME: str = "sandbox"
    AT_API_KEY: str = ""
    AT_SENDER_ID: str = "ROPTRACK"
    # When True, SMS calls are logged but not sent (dev mode before AT account is ready)
    AT_SIMULATE: bool = True

    WHATSAPP_API_URL: str = ""
    WHATSAPP_TOKEN: str = ""

    ADMIN_EMAIL: str = "admin@roptracker.ug"
    ADMIN_PASSWORD: str = "change-me-in-production"
    ADMIN_SECRET_KEY: str = ""

    # Alert thresholds
    AT_BALANCE_ALERT_THRESHOLD: float = 5000.0

    # SMTP for critical alert emails (leave blank to disable)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    ALERT_FROM_EMAIL: str = ""
    ALERT_TO_EMAIL: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
