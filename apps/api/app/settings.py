from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql://attendance:attendance@localhost:5432/attendance"
    allowed_origins: list[str] = ["http://localhost:3000"]
    environment: str = "development"
    siwe_domain: str = "localhost"
    siwe_uri: str = "http://localhost:3000"
    siwe_chain_id: int = 11155111


settings = Settings()
