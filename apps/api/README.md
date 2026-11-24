# Student Attendance Backend

FastAPI backend for the Student Attendance DApp.

## Run locally

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

## Database migrations

Apply migrations in numeric order using a trusted deployment/operator connection:

1. `migrations/001_secure_identity.sql`
2. `migrations/002_tenant_authorization.sql`
3. `migrations/003_membership_management.sql`
4. `migrations/004_auth_rate_limits.sql`

Application startup does not apply schema changes. Do not expose the organization bootstrap secret to browser clients.

## Authentication protocol

The wallet challenge uses EIP-191 personal-message signing with a custom SIWE-style message. It is **not a complete EIP-4361 SIWE implementation**: the API does not claim EIP-4361 parser or conformance compatibility. Challenge expiry, wallet/message binding, one-time consumption, and server-side sessions are enforced.

Nonce issuance is limited to 30 requests per source IP and 5 per wallet per 15-minute window. Verification is limited to 60 requests per source IP and 10 per wallet per 15-minute window. Limits are atomic and stored in PostgreSQL as SHA-256 subject digests. The API uses the ASGI peer address (`request.client.host`); deployments behind a reverse proxy must configure a trusted-proxy strategy so this value represents the actual client without trusting arbitrary forwarded headers.

## Endpoints

- `GET /health`: process health.
- `GET /ready`: PostgreSQL readiness.
- `POST /auth/nonce`, `POST /auth/verify`, `GET /auth/me`, `POST /auth/logout`.
- Organization bootstrap, workspace, admin, and membership endpoints are tenant-scoped and require the documented session/CSRF controls.

This backend foundation does not yet implement course, enrollment, attendance-session, QR, or blockchain-indexer APIs. Do not treat successful CI as production deployment or as live wallet/attendance acceptance.
