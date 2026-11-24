# Database migrations

Apply SQL migrations in numeric order against the configured PostgreSQL database:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_secure_identity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/002_tenant_authorization.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/003_membership_management.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/004_auth_rate_limits.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/005_attendance_sessions.sql
```

Do not expose authentication, organization, or attendance-session routes in a deployed environment until all five migrations have been applied. Migration execution is intentionally not performed automatically by application startup. The migrations add identity, tenant authorization, append-only audit events, authentication rate limits, and chain-verified attendance session storage.
