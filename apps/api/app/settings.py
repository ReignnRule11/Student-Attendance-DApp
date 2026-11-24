from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql://attendance:attendance@localhost:5432/attendance"
    allowed_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000"],
        validation_alias=AliasChoices("API_ALLOWED_ORIGINS", "ALLOWED_ORIGINS"),
    )
    environment: str = "development"
    siwe_domain: str = "localhost"
    siwe_uri: str = "http://localhost:3000"
    siwe_chain_id: int = 11155111
    org_bootstrap_secret: str = ""


settings = Settings()
