from app.settings import Settings


def test_api_allowed_origins_environment_alias():
    configured = Settings(API_ALLOWED_ORIGINS=["https://attendance.example"])
    assert configured.allowed_origins == ["https://attendance.example"]
