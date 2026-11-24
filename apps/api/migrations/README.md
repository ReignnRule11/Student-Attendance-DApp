# Database migrations

Apply SQL migrations in numeric order against the configured PostgreSQL database:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_secure_identity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/002_tenant_authorization.sql
```

Do not expose authentication or organization routes in a deployed environment until
both migrations have been applied. Migration execution is intentionally not performed
automatically by application startup. The second migration adds append-only organization
bootstrap audit events and their database trigger.
