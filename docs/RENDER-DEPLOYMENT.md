# Backend deployment (Render + managed PostgreSQL)

This repository includes a Render Blueprint for the FastAPI service. It does **not** create a database or deploy itself: provision a managed PostgreSQL database first, then supply its connection string as a secret.

## Important browser-session constraint

The API uses credentialed HttpOnly cookies with `SameSite=Lax`. Host the frontend and API on the **same site** using custom domains (for example, `app.example.com` and `api.example.com`). A frontend on a different site from the API may not send the session cookie reliably. Do not work around this by exposing session tokens to JavaScript or weakening cookie protections.

## 1. Provision PostgreSQL

Create a managed PostgreSQL 16 database with a provider that supports persistent storage. Copy its TLS-enabled connection string. Keep it private; do not commit it or paste it into source files.

## 2. Create the Render service

In Render, create a Blueprint from this GitHub repository and select `render.yaml`. The service builds from `apps/api/Dockerfile` and uses `/ready` as its health check.

Set these environment variables in the Render dashboard:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Managed PostgreSQL connection string |
| `API_ALLOWED_ORIGINS` | JSON array containing the exact frontend origin, e.g. `["https://app.example.com"]` |
| `SIWE_DOMAIN` | Frontend hostname only, e.g. `app.example.com` |
| `SIWE_URI` | Exact frontend origin, e.g. `https://app.example.com` |
| `ORG_BOOTSTRAP_SECRET` | Long random one-time secret; generate/store privately |
| `SEPOLIA_RPC_URL` | Server-side Sepolia HTTPS RPC endpoint |
| `ATTENDANCE_CONTRACT_ADDRESS` | Already set in the Blueprint; verify it matches the deployed contract |

Never prefix `API_ALLOWED_ORIGINS` with a trailing slash. Do not expose `ORG_BOOTSTRAP_SECRET` or `SEPOLIA_RPC_URL` as `NEXT_PUBLIC_*` variables.

## 3. Apply database migrations exactly once

The API intentionally does not mutate the database schema on startup. From a trusted operator environment with `psql` installed, set `DATABASE_URL` to the production database connection string and run these commands from the repository root:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/001_secure_identity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/002_tenant_authorization.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/003_membership_management.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/004_auth_rate_limits.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/005_attendance_sessions.sql
```

Do not expose auth or organization routes until all five migrations have completed successfully. Back up the database before applying migrations and retain migration output.

## 4. Verify the deployment

- `GET https://api.example.com/health` should return process health.
- `GET https://api.example.com/ready` should return HTTP 200 only after PostgreSQL is reachable.
- Open `/docs` and confirm the expected API routes are present.
- Verify browser requests use the exact allowed origin and include credentials.
- Test wallet nonce, signature verification, `/auth/me`, logout, CSRF rejection, and tenant isolation with separate test wallets.
- Confirm session registration rejects wrong-chain, wrong-contract, unmined, reverted, duplicate, and mismatched `SessionCreated` transactions.

## Release limitations

A healthy API is not proof of a complete attendance workflow. The current backend registers and lists verified session-creation events; it does not issue QR signatures, submit student attendance, or index `AttendanceMarked` events. Those remain direct wallet/contract operations or future backend work. Complete the two-wallet Sepolia acceptance procedure before calling the product end-to-end ready.

The SIWE-style wallet challenge is custom EIP-191 and is not a full EIP-4361 implementation. Reverse-proxy client-IP trust and rate-limit behavior must also be validated in the deployed hosting topology.
