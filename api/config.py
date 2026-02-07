from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings

ENV_FILE = Path(__file__).resolve().parent.parent / ".env.local"


class Settings(BaseSettings):
    github_app_client_id: str = Field(
        validation_alias=AliasChoices("github_app_client_id", "github_client_id"),
    )
    github_app_client_secret: str = Field(
        validation_alias=AliasChoices("github_app_client_secret", "github_client_secret"),
    )
    vercel_token: str = Field(
        validation_alias=AliasChoices("vercel_token", "vercel_api_token"),
    )
    frontend_url: str
    database_url: str
    session_secret: str
    dedalus_api_key: str

    model_config = {"env_file": str(ENV_FILE), "extra": "ignore"}


settings = Settings()
