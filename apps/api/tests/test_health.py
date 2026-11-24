from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_is_process_health_only():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "student-attendance-api"}
