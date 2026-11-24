# Student Attendance Backend (Foundation)

FastAPI service foundation for the Student Attendance DApp.

## Run locally

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

- `GET /health`: process health only; does not require database connectivity.
- `GET /ready`: checks PostgreSQL connectivity and reports degraded readiness when unavailable.
- `GET /docs`: OpenAPI docs (development only; disable or protect in production as appropriate).

This foundation intentionally does not implement authentication, enrollment, attendance mutation, or blockchain indexing yet. Those are added in subsequent stages with database migrations, tenant-scoped authorization, wallet-signature authentication, and event verification. Do not expose this API publicly as production-ready until these controls are implemented.

