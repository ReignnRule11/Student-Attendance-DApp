from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.settings import settings
from app.database import check_database

app = FastAPI(
    title="Student Attendance API",
    version="0.1.0",
    description="Backend services for Student Attendance DApp. Blockchain remains the attendance authority.",
)

# Restrict origins in production via API_ALLOWED_ORIGINS. Wildcard is only a local-development default.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "student-attendance-api"}


@app.get("/ready", tags=["health"])
async def readiness():
    database_ready = await check_database()
    return {
        "status": "ready" if database_ready else "degraded",
        "checks": {"database": "ok" if database_ready else "unavailable"},
    }
