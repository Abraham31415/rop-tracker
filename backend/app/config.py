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

    class Config:
        env_file = ".env"


settings = Settings()
