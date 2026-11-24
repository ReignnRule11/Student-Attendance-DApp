from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.settings import settings
from app.database import check_database
from app.auth import router as auth_router
from app.organizations import router as organizations_router

app = FastAPI(
    title="Student Attendance API",
    version="0.2.0",
    description="Backend services for Student Attendance DApp. Blockchain remains the attendance authority.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-CSRF-Token"],
)

app.include_router(auth_router)
app.include_router(organizations_router)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "student-attendance-api"}


@app.get("/ready", tags=["health"])
async def readiness():
    database_ready = await check_database()
    if not database_ready:
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "checks": {"database": "unavailable"}},
        )
    return {"status": "ready", "checks": {"database": "ok"}}
